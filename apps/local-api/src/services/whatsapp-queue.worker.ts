import { supabaseService } from './supabase.service.js';
import { whatsappService } from './whatsapp.service.js';
import { env } from '../config/env.js';

/**
 * Worker que monitora novos pacotes no Supabase e dispara o WhatsApp
 * usando a Evolution API local conectada no computador da portaria.
 */
export class WhatsAppQueueWorker {
  private isProcessing = false;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private processedPackageIds = new Set<string>();

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('🔄 [WhatsApp Worker] Inicializando fila de notificações automáticas...');

    // 1. Polling a cada 4 segundos como garantia máxima de entrega
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, 4000);

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
              await this.dispatchNotificationForPackage(payload.new.id);
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

      // Busca pacotes recebidos recentemente que ainda não tiveram notificação enviada
      const { data: pendingPackages, error } = await client
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

      if (error) {
        console.error('[WhatsApp Worker] Erro ao buscar fila:', error);
        return;
      }

      for (const pkg of pendingPackages || []) {
        if (this.processedPackageIds.has(pkg.id)) continue;

        // Se o pacote foi criado há menos de 10 minutos e ainda não foi notificado
        const pkgAge = Date.now() - new Date(pkg.created_at).getTime();
        if (pkgAge < 10 * 60 * 1000) {
          await this.dispatchNotificationForPackage(pkg.id, pkg);
        } else {
          this.processedPackageIds.add(pkg.id);
        }
      }
    } catch (err: any) {
      console.error('[WhatsApp Worker] Erro durante processamento da fila:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatchNotificationForPackage(packageId: string, preloadedPkg?: any) {
    if (this.processedPackageIds.has(packageId)) return;

    try {
      const client = supabaseService.getClient();
      let pkg = preloadedPkg;

      if (!pkg) {
        const { data, error } = await client
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

        if (error || !data) {
          console.warn('[WhatsApp Worker] Pacote não encontrado:', packageId);
          return;
        }
        pkg = data;
      }

      // 1. Identificar telefone e nome do morador
      let phone = pkg.residents?.phone;
      let residentName = pkg.residents?.name || 'Morador(a)';
      const unit = pkg.units;
      const unitInfo = unit ? `${unit.block} - Apto ${unit.unit_number}` : 'Sua Unidade';

      // Se não tiver morador específico selecionado, pega o morador principal da unidade
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
        console.log(`ℹ️ [WhatsApp Worker] Pacote ${pkg.id} não possui telefone de morador associado.`);
        this.processedPackageIds.add(packageId);
        return;
      }

      console.log(`📤 [WhatsApp Worker] Disparando WhatsApp para ${residentName} (${phone}) - Apto ${unitInfo}...`);

      // 2. Dispara pelo WhatsApp Service (Evolution API local)
      const res = await whatsappService.notifyPackageArrival({
        phone,
        residentName,
        unitInfo,
        carrier: pkg.carrier || 'Encomenda',
        pickupCode: pkg.pickup_code,
        qrToken: pkg.qr_token,
        labelImageUrl: pkg.label_image_path ? `http://localhost:3001/images/${pkg.label_image_path}` : undefined
      });

      if (res.success) {
        console.log(`✅ [WhatsApp Worker] WhatsApp enviado com sucesso para ${phone} (Pacote ${pkg.id})!`);
        this.processedPackageIds.add(packageId);
      } else {
        console.warn(`⚠️ [WhatsApp Worker] Falha ao enviar WhatsApp: ${res.error}`);
      }
    } catch (err: any) {
      console.error(`❌ [WhatsApp Worker] Erro ao notificar pacote ${packageId}:`, err.message);
    }
  }
}

export const whatsAppQueueWorker = new WhatsAppQueueWorker();
