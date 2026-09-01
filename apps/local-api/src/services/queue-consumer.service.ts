import { supabaseService } from './supabase.service.js';
import { databaseService } from './database.service.js';
import { whatsAppEngineService } from './whatsapp-engine.service.js';
import { env } from '../config/env.js';

/**
 * QueueConsumerService — Cérebro do Sistema de Fila
 * 
 * Escuta via Supabase Realtime as inserções em `fila_encomendas` e `fila_mensagens`.
 * Quando um registro chega:
 *  1. Processa e salva no SQLite local (banco permanente)
 *  2. Executa o disparo do WhatsApp via Baileys
 *  3. Deleta o registro do Supabase imediatamente (mantém a nuvem limpa)
 * 
 * O Supabase é um broker temporário — nunca armazena encomendas permanentemente.
 */
export class QueueConsumerService {
  private isRunning = false;
  private encomendaChannel: any = null;
  private mensagemChannel: any = null;
  private pollingInterval: NodeJS.Timeout | null = null;

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (!supabaseService.isConfigured()) {
      console.warn('⚠️ [QueueConsumer] Supabase não configurado — fila desativada.');
      return;
    }

    console.log('🚀 [QueueConsumer] Iniciando consumidor de fila (Supabase → SQLite → WhatsApp)...');

    // 1. Listener Realtime para chegadas instantâneas
    this.setupRealtimeListeners();

    // 2. Polling de segurança a cada 10s (garante que nenhum item fique preso)
    this.pollingInterval = setInterval(() => {
      this.pollPendingQueue().catch(err =>
        console.warn('[QueueConsumer] Erro no polling:', err?.message)
      );
    }, 10000);

    // 3. Processa o que estiver na fila ao iniciar (itens que chegaram offline)
    setTimeout(() => {
      this.pollPendingQueue().catch(() => {});
    }, 3000);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.encomendaChannel) {
      supabaseService.getClient().removeChannel(this.encomendaChannel);
      this.encomendaChannel = null;
    }
    if (this.mensagemChannel) {
      supabaseService.getClient().removeChannel(this.mensagemChannel);
      this.mensagemChannel = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REALTIME LISTENERS
  // ─────────────────────────────────────────────────────────────────────────

  private setupRealtimeListeners(): void {
    try {
      const client = supabaseService.getClient();

      // Listener para fila_encomendas (chegada de nova encomenda pelo PWA mobile)
      this.encomendaChannel = client
        .channel('queue-consumer-encomendas')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'fila_encomendas' },
          async (payload) => {
            const item = payload.new as any;
            console.log(`⚡ [QueueConsumer] Nova encomenda na fila: ${item?.id}`);
            if (item?.id) {
              await this.processFilaEncomenda(item);
            }
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ [QueueConsumer] Realtime ativo: fila_encomendas');
          }
        });

      // Listener para fila_mensagens (disparos WhatsApp avulsos)
      this.mensagemChannel = client
        .channel('queue-consumer-mensagens')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'fila_mensagens' },
          async (payload) => {
            const item = payload.new as any;
            console.log(`⚡ [QueueConsumer] Nova mensagem na fila: ${item?.id}`);
            if (item?.id) {
              await this.processFilaMensagem(item);
            }
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ [QueueConsumer] Realtime ativo: fila_mensagens');
          }
        });

    } catch (err: any) {
      console.error('[QueueConsumer] Erro ao configurar Realtime:', err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POLLING DE SEGURANÇA (fallback se o Realtime falhar)
  // ─────────────────────────────────────────────────────────────────────────

  private async pollPendingQueue(): Promise<void> {
    if (!supabaseService.isConfigured()) return;

    try {
      const client = supabaseService.getClient();

      // Busca encomendas pendentes (as mais antigas primeiro)
      const { data: encomendas, error: e1 } = await client
        .from('fila_encomendas')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(20);

      if (!e1 && encomendas && encomendas.length > 0) {
        console.log(`📦 [QueueConsumer] Polling: ${encomendas.length} encomenda(s) na fila`);
        for (const item of encomendas) {
          await this.processFilaEncomenda(item);
        }
      }

      // Busca mensagens avulsas pendentes
      const { data: mensagens, error: e2 } = await client
        .from('fila_mensagens')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(20);

      if (!e2 && mensagens && mensagens.length > 0) {
        console.log(`💬 [QueueConsumer] Polling: ${mensagens.length} mensagem(ns) na fila`);
        for (const item of mensagens) {
          await this.processFilaMensagem(item);
        }
      }
    } catch (err: any) {
      console.warn('[QueueConsumer] Erro no polling:', err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROCESSAMENTO DE ENCOMENDA
  // ─────────────────────────────────────────────────────────────────────────

  private async processFilaEncomenda(item: any): Promise<void> {
    const { id, unit_id, resident_id, carrier, tracking_code, recipient_name_ocr,
            label_image_path, phone, send_whatsapp, notes, condo_id } = item;

    console.log(`📦 [QueueConsumer] Processando encomenda da fila: ${id} | Unidade: ${unit_id}`);

    try {
      // 1. Salvar no SQLite local (banco permanente da portaria)
      const pkg = databaseService.createPackage({
        condoId: condo_id || env.CONDO_ID,
        unitId: unit_id,
        residentId: resident_id || null,
        carrier: carrier || 'Transportadora',
        trackingCode: tracking_code || null,
        recipientNameOcr: recipient_name_ocr || null,
        labelImagePath: label_image_path || null,
        notes: notes || null,
      });

      console.log(`✅ [QueueConsumer] Encomenda salva no SQLite: ${pkg.id} (código: ${pkg.pickup_code})`);

      // 2. Disparar WhatsApp se solicitado
      if (send_whatsapp !== false) {
        const whatsappPhone = phone || await this.getResidentPhone(resident_id, unit_id);
        if (whatsappPhone && whatsAppEngineService.isConnected()) {
          const unit = databaseService.getUnitById(unit_id);
          const unitInfo = unit ? `Apto ${unit.unit_number} - ${unit.block}` : 'sua unidade';
          const residentName = recipient_name_ocr || 'Morador(a)';

          const message = this.buildArrivalMessage(pkg.pickup_code, carrier, unitInfo, residentName);
          const waResult = await whatsAppEngineService.sendTextMessage(whatsappPhone, message);

          if (waResult.success) {
            databaseService.updatePackageStatus(pkg.id, 'NOTIFIED');
            console.log(`📱 [QueueConsumer] WhatsApp enviado com sucesso para ${whatsappPhone}`);
          } else {
            console.warn(`⚠️ [QueueConsumer] WhatsApp falhou: ${waResult.error}`);
          }
        } else if (!whatsAppEngineService.isConnected()) {
          console.warn('⚠️ [QueueConsumer] WhatsApp desconectado — encomenda salva mas sem notificação');
        }
      }

      // 3. Deletar da fila do Supabase (manter a nuvem limpa)
      const { error: deleteErr } = await supabaseService.getClient()
        .from('fila_encomendas')
        .delete()
        .eq('id', id);

      if (deleteErr) {
        console.warn(`⚠️ [QueueConsumer] Falha ao deletar da fila: ${deleteErr.message}`);
      } else {
        console.log(`🗑️ [QueueConsumer] Item removido da fila Supabase: ${id}`);
      }

    } catch (err: any) {
      console.error(`❌ [QueueConsumer] Erro ao processar encomenda ${id}:`, err.message);
      // Não deletar da fila em caso de erro — o polling vai tentar novamente
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PROCESSAMENTO DE MENSAGEM AVULSA
  // ─────────────────────────────────────────────────────────────────────────

  private async processFilaMensagem(item: any): Promise<void> {
    const { id, phone, message, tipo } = item;

    console.log(`💬 [QueueConsumer] Processando mensagem ${tipo}: ${id} → ${phone}`);

    try {
      if (whatsAppEngineService.isConnected()) {
        const result = await whatsAppEngineService.sendTextMessage(phone, message);
        if (result.success) {
          console.log(`📱 [QueueConsumer] Mensagem ${tipo} enviada para ${phone}`);
        } else {
          console.warn(`⚠️ [QueueConsumer] Falha no envio: ${result.error}`);
        }
      } else {
        console.warn('⚠️ [QueueConsumer] WhatsApp offline — mensagem descartada após 3 tentativas futuras');
      }

      // Deleta da fila independente do resultado (evita spam)
      await supabaseService.getClient()
        .from('fila_mensagens')
        .delete()
        .eq('id', id);

    } catch (err: any) {
      console.error(`❌ [QueueConsumer] Erro ao processar mensagem ${id}:`, err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async getResidentPhone(residentId?: string | null, unitId?: string): Promise<string | null> {
    if (residentId) {
      const resident = databaseService.getResidentById(residentId);
      if (resident?.phone) return resident.phone;
    }
    if (unitId) {
      const residents = databaseService.getResidentsByUnit(unitId);
      const primary = residents.find(r => r.is_primary) || residents[0];
      return primary?.phone || null;
    }
    return null;
  }

  private buildArrivalMessage(pickupCode: string, carrier: string, unitInfo: string, residentName: string): string {
    return [
      `📦 *Nova Encomenda na Portaria!*`,
      ``,
      `Olá, *${residentName}*! 👋`,
      ``,
      `Chegou uma encomenda para *${unitInfo}*.`,
      ``,
      `🏷️ *Transportadora:* ${carrier}`,
      `🔑 *Código de Retirada:* \`${pickupCode}\``,
      ``,
      `Compareça à portaria com um documento de identificação.`,
      ``,
      `_CondoBox — Sistema de Gestão Condominial_ 🏢`
    ].join('\n');
  }
}

export const queueConsumerService = new QueueConsumerService();
