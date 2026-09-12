import { supabaseService } from './supabase.service.js';
import { whatsappService } from './whatsapp.service.js';
import { env } from '../config/env.js';

interface QueuedArrivalItem {
  packageId: string;
  preloadedPkg?: any;
  resolve?: (val: any) => void;
  reject?: (err: any) => void;
}

/**
 * Worker que monitora pacotes no Supabase e dispara o WhatsApp
 * usando a Evolution API / Baileys local conectada no computador da portaria:
 * 1. Chegada de Encomenda (INSERT / status: RECEIVED)
 * 2. Retirada de Encomenda (UPDATE / status: DELIVERED)
 */
export class WhatsAppQueueWorker {
  private isProcessing = false;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private processedArrivalIds = new Set<string>();
  private processedDeliveryIds = new Set<string>();
  private arrivalAttempts = new Map<string, number>();
  private arrivalQueue: QueuedArrivalItem[] = [];
  private isProcessingArrivalQueue = false;

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('🔄 [WhatsApp Worker] Inicializando fila de notificações automáticas (Chegada + Retirada)...');

    // 0. Garante que o Webhook esteja ativo na Evolution API para receber respostas dos moradores
    whatsappService.ensureWebhookConfigured().catch(() => {});

    // 1. Polling a cada 3 segundos como garantia máxima de entrega
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, 3000);

    // 2. Realtime listener via Supabase WebSocket
    this.setupRealtimeListener();

    // 3. Executa a primeira verificação imediatamente
    this.processQueue();
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private setupRealtimeListener() {
    try {
      if (!supabaseService.isConfigured()) return;

      const client = supabaseService.getClient();
      client
        .channel('packages-whatsapp-queue')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'packages' },
          async (payload) => {
            console.log('⚡ [WhatsApp Worker] Novo pacote recebido via Realtime:', payload.new?.id);
            if (payload.new?.id) {
              await this.dispatchArrivalNotification(payload.new.id);
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'packages' },
          async (payload) => {
            if (payload.new?.status === 'DELIVERED') {
              console.log('⚡ [WhatsApp Worker] Encomenda retirada via Realtime:', payload.new?.id);
              if (payload.new?.id) {
                await this.dispatchDeliveryNotification(payload.new.id);
              }
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications_log' },
          async (payload) => {
            if (payload.new?.status === 'PENDING') {
              console.log('⚡ [WhatsApp Worker] Nova mensagem pendente em notifications_log:', payload.new?.id);
              this.processQueue();
            }
          }
        )
        .subscribe((status) => {
          console.log(`📡 [WhatsApp Worker] Realtime canal: ${status}`);
        });
    } catch (err) {
      console.warn('[WhatsApp Worker] Falha ao registrar listener Realtime, operando via polling:', err);
    }
  }

  async processQueue() {
    if (this.isProcessing || !supabaseService.isConfigured()) return;
    this.isProcessing = true;

    try {
      const client = supabaseService.getClient();

      // 1. Fila de Chegada (RECEIVED)
      const { data: pendingArrivals } = await client
        .from('packages')
        .select(`
          id,
          carrier,
          pickup_code,
          qr_token,
          label_image_path,
          status,
          created_at,
          unit_id,
          resident_id,
          units (
            block,
            unit_number
          ),
          residents (
            name,
            phone
          )
        `)
        .eq('status', 'RECEIVED')
        .order('created_at', { ascending: false })
        .limit(10);

      for (const pkg of pendingArrivals || []) {
        if (this.processedArrivalIds.has(pkg.id)) continue;
        const pkgAge = Date.now() - new Date(pkg.created_at).getTime();
        if (pkgAge < 15 * 60 * 1000) {
          await this.dispatchArrivalNotification(pkg.id, pkg);
        } else {
          this.processedArrivalIds.add(pkg.id);
        }
      }

      // 2. Fila de Retirada (DELIVERED)
      const { data: recentDeliveries } = await client
        .from('packages')
        .select(`
          id,
          carrier,
          status,
          delivered_at,
          delivered_to_name,
          unit_id,
          resident_id,
          units (
            block,
            unit_number
          ),
          residents (
            name,
            phone
          )
        `)
        .eq('status', 'DELIVERED')
        .order('delivered_at', { ascending: false })
        .limit(10);

      for (const pkg of recentDeliveries || []) {
        if (this.processedDeliveryIds.has(pkg.id)) continue;
        const deliveryAge = Date.now() - new Date(pkg.delivered_at || '').getTime();
        if (deliveryAge < 15 * 60 * 1000) {
          await this.dispatchDeliveryNotification(pkg.id, pkg);
        } else {
          this.processedDeliveryIds.add(pkg.id);
        }
      }

      // 3. Fila de Notificações / Confirmações Pendentes (notifications_log)
      const { data: pendingLogs } = await client
        .from('notifications_log')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(10);

      for (const logItem of pendingLogs || []) {
        if (logItem.recipient_phone && logItem.message_content) {
          try {
            // Lock atômico: só processa se ainda estiver com status PENDING no Supabase
            const { data: claimed } = await client
              .from('notifications_log')
              .update({ status: 'PROCESSING' })
              .eq('id', logItem.id)
              .eq('status', 'PENDING')
              .select('id');

            if (!claimed || claimed.length === 0) {
              // Outro PC já assumiu o processamento deste item
              continue;
            }

            const res = await whatsappService.sendMessage({
              phone: logItem.recipient_phone,
              message: logItem.message_content
            });
            if (res.success) {
              console.log('✅ [WhatsApp Worker] Notificação de log enviada com sucesso para:', logItem.recipient_phone);
              await client.from('notifications_log').update({
                status: 'SENT',
                sent_at: new Date().toISOString(),
                external_message_id: res.messageId || 'queue-worker'
              }).eq('id', logItem.id);
            } else {
              console.warn('⚠️ [WhatsApp Worker] Falha ao enviar notificação de log:', res.error);
              await client.from('notifications_log').update({
                status: 'FAILED',
                error_message: res.error || 'Falha no envio'
              }).eq('id', logItem.id);
            }
          } catch (e: any) {
            console.error('[WhatsApp Worker] Erro ao processar log pendente:', e.message);
          }
        }
      }
    } catch (err: any) {
      console.error('[WhatsApp Worker] Erro durante processamento da fila:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  public markArrivalProcessed(packageId: string) {
    this.processedArrivalIds.add(packageId);
  }

  public markDeliveryProcessed(packageId: string) {
    this.processedDeliveryIds.add(packageId);
  }

  /**
   * Enfileira notificação de chegada de encomenda para disparo sequencial humanizado.
   * Se o porteiro escanear múltiplos pacotes em sequência, eles entram na fila e são
   * processados de um em um, com presença de digitação ativa e intervalos anti-spam entre moradores.
   */
  public async dispatchArrivalNotification(packageId: string, preloadedPkg?: any): Promise<any> {
    if (this.processedArrivalIds.has(packageId)) return;
    if (this.arrivalQueue.some(item => item.packageId === packageId)) return;

    return new Promise((resolve, reject) => {
      this.arrivalQueue.push({ packageId, preloadedPkg, resolve, reject });
      console.log(`📥 [WhatsApp Worker] Encomenda ${packageId} na fila de envio. Total aguardando: ${this.arrivalQueue.length}`);
      this.processArrivalQueue().catch(reject);
    });
  }

  private async processArrivalQueue(): Promise<void> {
    if (this.isProcessingArrivalQueue) return;
    this.isProcessingArrivalQueue = true;

    try {
      while (this.arrivalQueue.length > 0) {
        const item = this.arrivalQueue.shift()!;
        try {
          const res = await this.executeArrivalDispatch(item.packageId, item.preloadedPkg);
          if (item.resolve) item.resolve(res);
        } catch (err: any) {
          if (item.reject) item.reject(err);
        }

        // Se ainda restarem pacotes na fila aguardando para outros moradores:
        // Aguarda uma pausa natural entre um morador e o próximo (ex: 2.5s a 4.0s)
        if (this.arrivalQueue.length > 0) {
          const pauseMs = Math.floor(Math.random() * 1500) + 2500;
          console.log(`⏳ [WhatsApp Worker] Envio concluído. Aguardando ${(pauseMs / 1000).toFixed(1)}s antes de iniciar para o próximo morador da fila (${this.arrivalQueue.length} restantes)...`);
          await new Promise(r => setTimeout(r, pauseMs));
        }
      }
    } finally {
      this.isProcessingArrivalQueue = false;
    }
  }

  /**
   * Executa o disparo de chegada individual com lock atômico no Supabase
   */
  private async executeArrivalDispatch(packageId: string, preloadedPkg?: any) {
    if (this.processedArrivalIds.has(packageId)) return;

    try {
      const client = supabaseService.getClient();

      // 🔒 LOCK ATÔMICO NO SUPABASE:
      // Se múltiplos terminais (PCs ou celulares) estiverem conectados simultaneamente,
      // apenas o primeiro a reivindicar de 'RECEIVED' -> 'NOTIFIED' terá sucesso.
      // Os demais recebem 0 linhas afetadas e abortam imediatamente sem disparar duplicata!
      if (supabaseService.isConfigured()) {
        const { data: claimed, error: claimErr } = await client
          .from('packages')
          .update({ status: 'NOTIFIED' })
          .eq('id', packageId)
          .eq('status', 'RECEIVED')
          .select('id');

        if (claimErr || !claimed || claimed.length === 0) {
          console.log(`🔒 [WhatsApp Worker] Pacote ${packageId} já foi reivindicado/notificado por outro terminal. Ignorando.`);
          this.processedArrivalIds.add(packageId);
          return;
        }
      }

      this.processedArrivalIds.add(packageId);

      // Sincroniza status no banco local SQLite
      try {
        const { databaseService } = await import('./database.service.js');
        databaseService.updatePackageStatus(packageId, 'NOTIFIED');
      } catch {}

      let pkg = preloadedPkg;

      if (!pkg) {
        const { data } = await client
          .from('packages')
          .select(`
            id,
            carrier,
            pickup_code,
            qr_token,
            label_image_path,
            status,
            unit_id,
            resident_id,
            units (
              block,
              unit_number
            ),
            residents (
              name,
              phone
            )
          `)
          .eq('id', packageId)
          .single();

        if (!data) return;
        pkg = data;
      }

      let phone = pkg.residents?.phone;
      let residentName = pkg.residents?.name || 'Morador(a)';
      const unit = pkg.units;
      const unitInfo = unit ? `${unit.block} - Apto ${unit.unit_number}` : 'Sua Unidade';

      if (!phone && pkg.unit_id) {
        const { data: unitResidents } = await client
          .from('residents')
          .select('name, phone, is_primary')
          .eq('unit_id', pkg.unit_id)
          .eq('active', true);

        if (unitResidents && unitResidents.length > 0) {
          const primary = unitResidents.find(r => r.is_primary) || unitResidents[0];
          phone = primary.phone;
          residentName = primary.name;
        }
      }

      if (!phone) {
        return;
      }

      console.log(`📤 [WhatsApp Worker] Disparando Chegada para ${residentName} (${phone}) - ${unitInfo}...`);

      const res = await whatsappService.notifyPackageArrival({
        phone,
        residentName,
        unitInfo,
        carrier: pkg.carrier || 'Encomenda',
        pickupCode: pkg.pickup_code,
        qrToken: pkg.qr_token,
        labelImageUrl: pkg.label_image_path
          ? (pkg.label_image_path.startsWith('http')
              ? pkg.label_image_path
              : `${whatsappService.getPublicWebUrl().replace(/\/$/, '')}/images/${pkg.label_image_path}`)
          : undefined
      });

      if (res.success) {
        console.log(`✅ [WhatsApp Worker] Notificação de Chegada enviada para ${phone}!`);
      } else {
        const count = (this.arrivalAttempts.get(packageId) || 0) + 1;
        this.arrivalAttempts.set(packageId, count);
        if (count >= 3) {
          console.warn(`⚠️ [WhatsApp Worker] Notificação de Chegada para ${packageId} interrompida após 3 tentativas.`);
        }
      }
    } catch (err: any) {
      console.error(`❌ [WhatsApp Worker] Erro na notificação de chegada do pacote ${packageId}:`, err.message);
    }
  }

  /**
   * Notificação de Retirada de Encomenda (ENCOMENDA RETIRADA COM SUCESSO)
   */
  public async dispatchDeliveryNotification(packageId: string, preloadedPkg?: any) {
    if (this.processedDeliveryIds.has(packageId)) return;

    try {
      const client = supabaseService.getClient();
      let pkg = preloadedPkg;

      if (!pkg) {
        const { data } = await client
          .from('packages')
          .select(`
            id,
            carrier,
            status,
            notes,
            delivered_at,
            delivered_to_name,
            unit_id,
            resident_id,
            pickup_code,
            qr_token,
            units (
              block,
              unit_number
            ),
            residents (
              name,
              phone
            )
          `)
          .eq('id', packageId)
          .single();

        if (!data) return;
        pkg = data;
      }

      // Se já possui marcação de envio de retirada nas notas, não envia de novo
      if (pkg.notes?.includes('DELIVERY_NOTIFIED')) {
        this.processedDeliveryIds.add(packageId);
        return;
      }

      // 🔒 LOCK ATÔMICO NO SUPABASE:
      // Garante que apenas UM PC/terminal reivindique o envio de retirada
      if (supabaseService.isConfigured()) {
        const nowIso = new Date().toISOString();
        const existingNotes = pkg.notes ? `${pkg.notes};DELIVERY_NOTIFIED:${nowIso}` : `DELIVERY_NOTIFIED:${nowIso}`;
        const { data: claimed, error: claimErr } = await client
          .from('packages')
          .update({ notes: existingNotes })
          .eq('id', packageId)
          .or('notes.is.null,notes.not.ilike.%DELIVERY_NOTIFIED%')
          .select('id');

        if (claimErr || !claimed || claimed.length === 0) {
          console.log(`🔒 [WhatsApp Worker] Pacote ${packageId} já teve confirmação de retirada enviada/reivindicada por outro terminal. Ignorando.`);
          this.processedDeliveryIds.add(packageId);
          return;
        }
      }

      this.processedDeliveryIds.add(packageId);

      let phone = pkg.residents?.phone;
      let residentName = pkg.residents?.name || 'Morador(a)';
      const unit = pkg.units;
      const unitInfo = unit ? `${unit.block} - Apto ${unit.unit_number}` : 'Sua Unidade';
      const deliveredTo = pkg.delivered_to_name || residentName;
      const deliveredAtFormatted = pkg.delivered_at
        ? new Date(pkg.delivered_at).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        : new Date().toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

      if (!phone && pkg.unit_id) {
        const { data: unitResidents } = await client
          .from('residents')
          .select('name, phone, is_primary')
          .eq('unit_id', pkg.unit_id)
          .eq('active', true);

        if (unitResidents && unitResidents.length > 0) {
          const primary = unitResidents.find(r => r.is_primary) || unitResidents[0];
          phone = primary.phone;
          residentName = primary.name;
        }
      }

      if (!phone) {
        return;
      }

      console.log(`📤 [WhatsApp Worker] Disparando Confirmação de Retirada para ${residentName} (${phone})...`);

      const res = await whatsappService.notifyPackageDelivered({
        phone,
        residentName,
        unitInfo,
        deliveredTo,
        carrier: pkg.carrier || 'Encomenda',
        deliveredAt: deliveredAtFormatted,
        pickupCode: pkg.pickup_code,
        qrToken: pkg.qr_token
      });

      if (res.success) {
        console.log(`✅ [WhatsApp Worker] Confirmação de Retirada enviada com sucesso para ${phone}!`);
      } else {
        console.warn(`⚠️ [WhatsApp Worker] Falha ao enviar confirmação de retirada: ${res.error}`);
      }
    } catch (err: any) {
      console.error(`❌ [WhatsApp Worker] Erro ao enviar confirmação de retirada ${packageId}:`, err.message);
    }
  }
}

export const whatsAppQueueWorker = new WhatsAppQueueWorker();
