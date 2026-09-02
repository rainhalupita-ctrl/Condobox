import { supabaseService } from './supabase.service.js';
import { whatsappService } from './whatsapp.service.js';
import { env } from '../config/env.js';

/**
 * Worker que monitora pacotes no Supabase e dispara o WhatsApp
 * usando a Evolution API local conectada no computador da portaria:
 * 1. Chegada de Encomenda (INSERT / status: RECEIVED)
 * 2. Retirada de Encomenda (UPDATE / status: DELIVERED)
 */
export class WhatsAppQueueWorker {
  private isProcessing = false;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private processedArrivalIds = new Set<string>();
  private processedDeliveryIds = new Set<string>();

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
    } catch (err: any) {
      console.error('[WhatsApp Worker] Erro durante processamento da fila:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Notificação de Chegada de Encomenda
   */
  private async dispatchArrivalNotification(packageId: string, preloadedPkg?: any) {
    if (this.processedArrivalIds.has(packageId)) return;

    try {
      const client = supabaseService.getClient();
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
        this.processedArrivalIds.add(packageId);
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
        this.processedArrivalIds.add(packageId);
        
        // Atualiza no banco local e, por tabela, no Supabase
        const { databaseService } = await import('./database.service.js');
        databaseService.updatePackageStatus(packageId, 'NOTIFIED');
        
        // Também atualiza direto no Supabase para evitar race conditions com outros workers
        const { supabaseService } = await import('./supabase.service.js');
        if (supabaseService.isConfigured()) {
          await supabaseService.getClient()
            .from('packages')
            .update({ status: 'NOTIFIED' })
            .eq('id', packageId);
        }
      }
    } catch (err: any) {
      console.error(`❌ [WhatsApp Worker] Erro na notificação de chegada do pacote ${packageId}:`, err.message);
    }
  }

  /**
   * Notificação de Retirada de Encomenda (ENCOMENDA RETIRADA COM SUCESSO)
   */
  private async dispatchDeliveryNotification(packageId: string, preloadedPkg?: any) {
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
          .eq('id', packageId)
          .single();

        if (!data) return;
        pkg = data;
      }

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
        this.processedDeliveryIds.add(packageId);
        return;
      }

      console.log(`📤 [WhatsApp Worker] Disparando Confirmação de Retirada para ${residentName} (${phone})...`);

      const res = await whatsappService.notifyPackageDelivered({
        phone,
        residentName,
        unitInfo,
        deliveredTo,
        carrier: pkg.carrier || 'Encomenda',
        deliveredAt: deliveredAtFormatted
      });

      if (res.success) {
        console.log(`✅ [WhatsApp Worker] Confirmação de Retirada enviada com sucesso para ${phone}!`);
        this.processedDeliveryIds.add(packageId);
      } else {
        console.warn(`⚠️ [WhatsApp Worker] Falha ao enviar confirmação de retirada: ${res.error}`);
      }
    } catch (err: any) {
      console.error(`❌ [WhatsApp Worker] Erro ao enviar confirmação de retirada ${packageId}:`, err.message);
    }
  }
}

export const whatsAppQueueWorker = new WhatsAppQueueWorker();
