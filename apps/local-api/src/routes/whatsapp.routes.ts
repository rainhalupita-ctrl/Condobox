import { FastifyInstance } from 'fastify';
import { whatsappService } from '../services/whatsapp.service.js';
import { env } from '../config/env.js';

export async function whatsappRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/whatsapp/status
   * Retorna o status de conexão da instância
   */
  fastify.get('/api/whatsapp/status', async (request, reply) => {
    const status = await whatsappService.checkInstanceStatus();
    return reply.send({
      apiUrl: env.EVOLUTION_API_URL,
      instance: env.EVOLUTION_INSTANCE_NAME,
      ...status
    });
  });

  /**
   * POST /api/whatsapp/connect
   * Inicializa a instância na Evolution API e retorna o QR Code para pareamento
   */
  fastify.post('/api/whatsapp/connect', async (request, reply) => {
    try {
      const url = `${env.EVOLUTION_API_URL}/instance/create`;
      
      // 1. Tenta criar a instância caso não exista
      const createRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.EVOLUTION_API_KEY
        },
        body: JSON.stringify({
          instanceName: env.EVOLUTION_INSTANCE_NAME,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS'
        })
      });

      // 2. Busca o QR Code de conexão
      const qrUrl = `${env.EVOLUTION_API_URL}/instance/connect/${env.EVOLUTION_INSTANCE_NAME}`;
      const qrRes = await fetch(qrUrl, {
        method: 'GET',
        headers: {
          'apikey': env.EVOLUTION_API_KEY
        }
      });

      const qrData = (await qrRes.json()) as any;

      return reply.send({
        success: true,
        qrcode: qrData?.base64 || qrData?.code || null,
        pairingCode: qrData?.pairingCode || null,
        instance: env.EVOLUTION_INSTANCE_NAME
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: 'Evolution API indisponível na porta 8080.',
        details: err.message
      });
    }
  });

  /**
   * POST /api/whatsapp/test
   * Envia mensagem de teste
   */
  /**
   * POST /api/whatsapp/webhook
   * Recebe mensagens enviadas pelos moradores (ex: "Estou ciente da encomenda 1234")
   */
  fastify.post('/api/whatsapp/webhook', async (request, reply) => {
    try {
      const body = (request.body as any) || {};
      const { event, data } = body;

      if (event && !event.toLowerCase().includes('message')) {
        return reply.send({ received: true });
      }

      const key = data?.key || {};
      if (key.fromMe) {
        // Ignora mensagens enviadas pelo próprio bot
        return reply.send({ received: true });
      }

      const remoteJid = key.remoteJid || '';
      if (!remoteJid || remoteJid.includes('@g.us')) {
        // Ignora grupos
        return reply.send({ received: true });
      }

      const cleanPhone = remoteJid.replace(/@s\.whatsapp\.net|@c\.us|\D/g, '');
      const lastDigits = cleanPhone.slice(-8);

      const msg = data?.message || {};
      const textResponse = (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        ''
      ).trim();

      if (!textResponse) {
        return reply.send({ received: true });
      }

      console.log(`📩 [WhatsApp Webhook] Mensagem recebida de ${cleanPhone}: "${textResponse}"`);

      const normalized = textResponse.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const isCiente =
        normalized.includes('ciente') ||
        normalized.includes('ok') ||
        normalized.includes('sim') ||
        normalized.includes('recebido') ||
        normalized.includes('obrigado') ||
        normalized.includes('valeu');

      // Tenta extrair código de 4 dígitos se informado na mensagem
      const codeMatch = textResponse.match(/\b\d{4}\b/);
      const mentionedCode = codeMatch ? codeMatch[0] : null;

      const { supabaseService } = await import('../services/supabase.service.js');
      if (!supabaseService.isConfigured()) return reply.send({ received: true });

      const client = supabaseService.getClient();

      // 1. Busca moradores correspondentes a este telefone
      const { data: allResidents } = await client
        .from('residents')
        .select('id, name, phone, unit:units(block, unit_number)')
        .order('created_at', { ascending: false });

      const matchedResidents = (allResidents || []).filter(r => {
        if (!r.phone) return false;
        const pClean = r.phone.replace(/\D/g, '');
        return pClean.endsWith(lastDigits) || lastDigits.endsWith(pClean.slice(-8));
      });

      const residentIds = matchedResidents.map(r => r.id);

      // 2. Busca pacote ativo mais recente
      let pkgQuery = client
        .from('packages')
        .select('*, unit:units(block, unit_number), resident:residents(name, phone)')
        .neq('status', 'DELIVERED')
        .order('received_at', { ascending: false });

      if (mentionedCode) {
        pkgQuery = pkgQuery.eq('pickup_code', mentionedCode);
      } else if (residentIds.length > 0) {
        pkgQuery = pkgQuery.in('resident_id', residentIds);
      }

      const { data: packages } = await pkgQuery.limit(1);
      const pkg = packages && packages.length > 0 ? packages[0] : null;

      if (!pkg) {
        return reply.send({ received: true, matched: false });
      }

      // 3. Atualiza pacote para CIENTE no Supabase
      const nowIso = new Date().toISOString();
      const updatedNotes = pkg.notes ? `${pkg.notes};CIENTE:${nowIso}` : `CIENTE:${nowIso}`;

      await client
        .from('packages')
        .update({
          notes: updatedNotes,
          status: pkg.status === 'RECEIVED' ? 'NOTIFIED' : pkg.status
        })
        .eq('id', pkg.id);

      // 4. Responde no WhatsApp confirmando o recebimento da ciência
      const residentName = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador';
      const unitText = pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'sua unidade';
      const webBaseUrl = whatsappService.getPublicWebUrl();
      const pickupUrl = `${webBaseUrl}/p/${pkg.qr_token || pkg.pickup_code}`;

      const replyText = `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
        `Olá, *${residentName}*!\n\n` +
        `Registramos sua confirmação para a encomenda da *${pkg.carrier}* (*${unitText}*).\n\n` +
        `🏢 A portaria já sabe que você está ciente da chegada!\n\n` +
        `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n` +
        `📱 *Link do QR Code:* ${pickupUrl}\n\n` +
        `_Apresente o QR Code ou informe o código na portaria ao retirar._\n\n` +
        `🏢 Portaria do Condomínio`;

      await whatsappService.sendMessage({
        phone: cleanPhone,
        message: replyText
      });

      console.log(`✅ [WhatsApp Webhook] Ciência confirmada para ${residentName} (${cleanPhone}) - Pacote ${pkg.pickup_code}`);
      return reply.send({ success: true, packageId: pkg.id });
    } catch (err: any) {
      console.error('[WhatsApp Webhook] Erro ao processar:', err.message);
      return reply.send({ received: true, error: err.message });
    }
  });
}
