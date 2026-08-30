import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabaseService } from '../services/supabase.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { env } from '../config/env.js';

const createPackageSchema = z.object({
  unitId: z.string().uuid().or(z.string().min(1)),
  residentId: z.string().uuid().optional().nullable(),
  carrier: z.string().default('Outro'),
  trackingCode: z.string().optional().nullable(),
  recipientNameOcr: z.string().optional().nullable(),
  labelImagePath: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  sendWhatsApp: z.boolean().default(true),
  // Dados auxiliares para notificação se residentId não estiver associado
  residentPhone: z.string().optional().nullable(),
  residentName: z.string().optional().nullable(),
  unitInfo: z.string().optional().nullable()
});

export async function packageRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/packages
   * Registra a encomenda e envia notificação no WhatsApp
   */
  fastify.post('/api/packages', async (request, reply) => {
    try {
      const body = createPackageSchema.parse(request.body);

      // 1. Grava no banco de dados Supabase
      const newPackage = await supabaseService.createPackage({
        unitId: body.unitId,
        residentId: body.residentId,
        carrier: body.carrier,
        trackingCode: body.trackingCode,
        recipientNameOcr: body.recipientNameOcr,
        labelImagePath: body.labelImagePath,
        notes: body.notes
      });

      let whatsappSent = false;
      let whatsappError = null;

      // 2. Se marcado para enviar WhatsApp e temos os dados de contato
      if (body.sendWhatsApp) {
        let phone = body.residentPhone;
        let name = body.residentName || 'Morador';
        let unitText = body.unitInfo || 'sua unidade';

        // Se o residentId foi passado mas não veio o telefone direto, busca do banco
        if (!phone && body.residentId && supabaseService.isConfigured()) {
          const { data: res } = await supabaseService.getClient()
            .from('residents')
            .select('name, phone')
            .eq('id', body.residentId)
            .single();
          if (res) {
            phone = res.phone;
            name = res.name;
          }
        }

        // Se ainda não tem telefone, tenta pegar do morador principal da unidade
        if (!phone && body.unitId && supabaseService.isConfigured()) {
          const { data: unitResidents } = await supabaseService.getClient()
            .from('residents')
            .select('name, phone, is_primary')
            .eq('unit_id', body.unitId);
          if (unitResidents && unitResidents.length > 0) {
            const primary = unitResidents.find(r => r.is_primary) || unitResidents[0];
            phone = primary.phone;
            if (!body.residentName) name = primary.name;
          }
        }

        if (phone) {
          const labelUrl = body.labelImagePath
            ? `${env.LOCAL_BASE_URL}/images/${body.labelImagePath}`
            : undefined;

          const notifyRes = await whatsappService.notifyPackageArrival({
            phone,
            residentName: name,
            unitInfo: unitText,
            carrier: body.carrier,
            pickupCode: newPackage.pickup_code,
            qrToken: newPackage.qr_token || newPackage.pickup_code,
            labelImageUrl: labelUrl
          });

          whatsappSent = notifyRes.success;
          whatsappError = notifyRes.error;

          // Se enviou com sucesso, atualiza o status para NOTIFIED
          if (notifyRes.success && supabaseService.isConfigured()) {
            await supabaseService.getClient()
              .from('packages')
              .update({ status: 'NOTIFIED' })
              .eq('id', newPackage.id);
            newPackage.status = 'NOTIFIED';
          }

          // Grava log da notificação
          await supabaseService.logNotification({
            packageId: newPackage.id,
            residentId: body.residentId,
            phone,
            message: `Notificação de chegada - Código: ${newPackage.pickup_code}`,
            status: notifyRes.success ? 'SENT' : 'FAILED',
            error: notifyRes.error
          });
        }
      }

      return reply.status(201).send({
        success: true,
        package: newPackage,
        whatsapp: {
          sent: whatsappSent,
          error: whatsappError
        }
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(400).send({
        error: 'Erro ao registrar encomenda',
        details: err.errors || err.message
      });
    }
  });

  /**
   * POST /api/packages/:id/notify
   * Verifica se a notificação já foi enviada e, caso não tenha sido (ou com force=true), envia no WhatsApp
   */
  fastify.post('/api/packages/:id/notify', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { force } = (request.body as { force?: boolean }) || {};

    if (!supabaseService.isConfigured()) {
      return reply.status(500).send({ error: 'Supabase não configurado' });
    }

    const client = supabaseService.getClient();

    // 1. Busca a encomenda completa com morador e unidade
    const { data: pkg, error: pkgErr } = await client
      .from('packages')
      .select('*, unit:units(*), resident:residents(*)')
      .eq('id', id)
      .single();

    if (pkgErr || !pkg) {
      return reply.status(404).send({ error: 'Encomenda não encontrada' });
    }

    // 2. Verifica se já foi notificada anteriormente através dos logs
    const { data: logs } = await client
      .from('notification_logs')
      .select('*')
      .eq('package_id', id)
      .eq('status', 'SENT')
      .order('created_at', { ascending: false });

    const alreadySent = (logs && logs.length > 0) || pkg.status === 'NOTIFIED';

    // Se já foi enviada e não foi requisitado envio forçado, retorna aviso
    if (alreadySent && !force) {
      return reply.send({
        success: true,
        alreadySent: true,
        message: 'A mensagem no WhatsApp já havia sido enviada anteriormente para esta encomenda.',
        lastSentAt: logs?.[0]?.created_at || pkg.received_at,
        package: pkg
      });
    }

    // 3. Determina o telefone e dados de envio
    let phone = pkg.resident?.phone;
    let name = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador';
    const unitText = pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'sua unidade';

    // Se não tiver telefone direto no morador vinculado, busca o morador principal da unidade
    if (!phone && pkg.unit_id) {
      const { data: unitResidents } = await client
        .from('residents')
        .select('*')
        .eq('unit_id', pkg.unit_id);

      if (unitResidents && unitResidents.length > 0) {
        const primary = unitResidents.find(r => r.is_primary) || unitResidents[0];
        phone = primary.phone;
        name = primary.name;
      }
    }

    if (!phone) {
      return reply.status(400).send({
        success: false,
        error: 'Nenhum número de telefone/WhatsApp cadastrado para este morador ou unidade.'
      });
    }

    const labelUrl = pkg.label_image_path
      ? `${env.LOCAL_BASE_URL}/images/${pkg.label_image_path}`
      : undefined;

    // 4. Dispara a notificação via WhatsApp
    const notifyRes = await whatsappService.notifyPackageArrival({
      phone,
      residentName: name,
      unitInfo: unitText,
      carrier: pkg.carrier,
      pickupCode: pkg.pickup_code,
      qrToken: pkg.qr_token || pkg.pickup_code,
      labelImageUrl: labelUrl
    });

    // 5. Registra o log no banco
    await supabaseService.logNotification({
      packageId: pkg.id,
      residentId: pkg.resident_id,
      phone,
      message: `Disparo manual/pendente - Código: ${pkg.pickup_code}`,
      status: notifyRes.success ? 'SENT' : 'FAILED',
      error: notifyRes.error
    });

    // 6. Atualiza o status da encomenda se tiver sucesso
    if (notifyRes.success) {
      if (pkg.status !== 'DELIVERED') {
        await client
          .from('packages')
          .update({ status: 'NOTIFIED' })
          .eq('id', pkg.id);
      }

      return reply.send({
        success: true,
        sent: true,
        alreadySent: false,
        message: `Mensagem enviada com sucesso para ${name} (${phone})!`,
        messageId: notifyRes.messageId
      });
    } else {
      return reply.status(500).send({
        success: false,
        error: notifyRes.error || 'Falha ao enviar mensagem no WhatsApp pela Evolution API.'
      });
    }
  });

  /**
   * POST /api/packages/notify-pending
   * Varre todas as encomendas que ainda NÃO foram notificadas e dispara as mensagens
   */
  fastify.post('/api/packages/notify-pending', async (request, reply) => {
    if (!supabaseService.isConfigured()) {
      return reply.status(500).send({ error: 'Supabase não configurado' });
    }

    const client = supabaseService.getClient();

    // 1. Busca todas as encomendas não entregues com status RECEIVED
    const { data: pendingPackages, error } = await client
      .from('packages')
      .select('*, unit:units(*), resident:residents(*)')
      .in('status', ['RECEIVED'])
      .order('received_at', { ascending: false });

    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    const results: any[] = [];
    let sentCount = 0;
    let failedCount = 0;
    let alreadySentCount = 0;

    for (const pkg of pendingPackages || []) {
      // Checa se tem log prévio de envio
      const { data: logs } = await client
        .from('notification_logs')
        .select('id')
        .eq('package_id', pkg.id)
        .eq('status', 'SENT');

      if (logs && logs.length > 0) {
        // Já foi enviado anteriormente, apenas ajusta status
        await client.from('packages').update({ status: 'NOTIFIED' }).eq('id', pkg.id);
        alreadySentCount++;
        results.push({ packageId: pkg.id, status: 'ALREADY_SENT' });
        continue;
      }

      let phone = pkg.resident?.phone;
      let name = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador';
      const unitText = pkg.unit ? `${pkg.unit.block} - Apto ${pkg.unit.unit_number}` : 'sua unidade';

      if (!phone && pkg.unit_id) {
        const { data: unitResidents } = await client
          .from('residents')
          .select('*')
          .eq('unit_id', pkg.unit_id);
        if (unitResidents && unitResidents.length > 0) {
          const primary = unitResidents.find(r => r.is_primary) || unitResidents[0];
          phone = primary.phone;
          name = primary.name;
        }
      }

      if (!phone) {
        failedCount++;
        results.push({ packageId: pkg.id, status: 'NO_PHONE', error: 'Sem telefone cadastrado' });
        continue;
      }

      const labelUrl = pkg.label_image_path
        ? `${env.LOCAL_BASE_URL}/images/${pkg.label_image_path}`
        : undefined;

      const notifyRes = await whatsappService.notifyPackageArrival({
        phone,
        residentName: name,
        unitInfo: unitText,
        carrier: pkg.carrier,
        pickupCode: pkg.pickup_code,
        qrToken: pkg.qr_token || pkg.pickup_code,
        labelImageUrl: labelUrl
      });

      await supabaseService.logNotification({
        packageId: pkg.id,
        residentId: pkg.resident_id,
        phone,
        message: `Disparo em lote pendente - Código: ${pkg.pickup_code}`,
        status: notifyRes.success ? 'SENT' : 'FAILED',
        error: notifyRes.error
      });

      if (notifyRes.success) {
        await client.from('packages').update({ status: 'NOTIFIED' }).eq('id', pkg.id);
        sentCount++;
        results.push({ packageId: pkg.id, status: 'SENT', phone, recipient: name });
      } else {
        failedCount++;
        results.push({ packageId: pkg.id, status: 'FAILED', error: notifyRes.error });
      }
    }

    return reply.send({
      success: true,
      totalChecked: (pendingPackages || []).length,
      sentCount,
      alreadySentCount,
      failedCount,
      results
    });
  });

  /**
   * GET /api/packages/search
   * Busca rápida para autocomplete ou checagem na portaria
   */
  fastify.get('/api/packages/search', async (request, reply) => {
    const { q, status } = request.query as { q?: string; status?: string };
    
    if (!supabaseService.isConfigured()) {
      return reply.send({ packages: [] });
    }

    let query = supabaseService.getClient()
      .from('packages')
      .select('*, unit:units(*), resident:residents(*)')
      .order('received_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }
    if (q) {
      query = query.or(`pickup_code.ilike.%${q}%,recipient_name_ocr.ilike.%${q}%,tracking_code.ilike.%${q}%`);
    }

    const { data, error } = await query.limit(50);
    if (error) {
      return reply.status(500).send({ error: error.message });
    }

    return reply.send({ packages: data });
  });
}
