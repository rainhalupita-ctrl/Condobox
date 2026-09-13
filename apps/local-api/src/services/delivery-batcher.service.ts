import { whatsappService } from './whatsapp.service.js';

export interface QueuedDeliveryItem {
  packageId: string;
  phone: string;
  residentName: string;
  deliveredTo: string;
  unitInfo: string;
  carrier: string;
  deliveredAt: string;
  pickupCode?: string;
  qrToken?: string;
  condoId?: string;
}

interface DeliveryBatch {
  key: string;
  phone: string;
  residentName: string;
  deliveredTo: string;
  unitInfo: string;
  qrToken?: string;
  packages: Array<{
    packageId: string;
    carrier: string;
    pickupCode?: string;
    deliveredAt: string;
    qrToken?: string;
  }>;
  firstAddedAt: number;
  timer: NodeJS.Timeout | null;
}

export class DeliveryBatcherService {
  private batches: Map<string, DeliveryBatch> = new Map();

  // Janela padrão de debounce: 75 segundos (pode ser ajustada via env DELIVERY_DEBOUNCE_SECONDS)
  private debounceMs = process.env.DELIVERY_DEBOUNCE_SECONDS
    ? Number(process.env.DELIVERY_DEBOUNCE_SECONDS) * 1000
    : 75 * 1000;

  // Tempo máximo que uma encomenda pode esperar no lote antes do envio forçado: 3 minutos
  private maxWaitMs = 180 * 1000;

  /**
   * Permite ajustar a janela de debounce dinamicamente (para testes ou configuração)
   */
  public setDebounceMs(ms: number): void {
    this.debounceMs = ms;
  }

  /**
   * Adiciona uma entrega ao lote do morador.
   * Se já houver entregas recentes para o mesmo telefone, agrupa e reseta o timer.
   */
  public addDelivery(item: QueuedDeliveryItem): void {
    const cleanPhone = (item.phone || '').replace(/\D/g, '');
    if (!cleanPhone) {
      console.warn('⚠️ [DeliveryBatcher] Encomenda recebida sem telefone válido. Ignorando lote.');
      return;
    }

    const key = `${item.condoId || 'default'}_${cleanPhone}`;
    let batch = this.batches.get(key);

    if (batch) {
      // Evita duplicidade do mesmo pacote no lote
      const exists = batch.packages.some(p => p.packageId === item.packageId);
      if (!exists) {
        batch.packages.push({
          packageId: item.packageId,
          carrier: item.carrier,
          pickupCode: item.pickupCode,
          deliveredAt: item.deliveredAt,
          qrToken: item.qrToken
        });
        batch.deliveredTo = item.deliveredTo || batch.deliveredTo;
        batch.unitInfo = item.unitInfo || batch.unitInfo;
        console.log(`📦 [DeliveryBatcher] Adicionada encomenda ${item.carrier} ao lote existente de ${cleanPhone}. Total no lote: ${batch.packages.length}`);
      }

      // Se já passou do tempo máximo de espera, dispara imediatamente
      if (Date.now() - batch.firstAddedAt >= this.maxWaitMs) {
        console.log(`⏰ [DeliveryBatcher] Tempo máximo de espera atingido para ${cleanPhone}. Disparando lote.`);
        this.flushBatch(key);
        return;
      }

      // Reinicia o timer de debounce para aguardar se o porteiro vai bipar mais alguma
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
      batch.timer = setTimeout(() => {
        this.flushBatch(key);
      }, this.debounceMs);

    } else {
      // Inicia um novo lote
      batch = {
        key,
        phone: cleanPhone,
        residentName: item.residentName,
        deliveredTo: item.deliveredTo,
        unitInfo: item.unitInfo,
        qrToken: item.qrToken,
        packages: [{
          packageId: item.packageId,
          carrier: item.carrier,
          pickupCode: item.pickupCode,
          deliveredAt: item.deliveredAt,
          qrToken: item.qrToken
        }],
        firstAddedAt: Date.now(),
        timer: null
      };

      batch.timer = setTimeout(() => {
        this.flushBatch(key);
      }, this.debounceMs);

      this.batches.set(key, batch);
      console.log(`⏳ [DeliveryBatcher] Novo lote de retirada iniciado para ${item.residentName} (${cleanPhone}). Aguardando ${this.debounceMs / 1000}s para possíveis outras retiradas...`);
    }
  }

  /**
   * Dispara a notificação consolidada e remove o lote da memória.
   */
  public async flushBatch(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) return;

    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
    this.batches.delete(key);

    const count = batch.packages.length;
    if (count === 0) return;

    try {
      if (count === 1) {
        // Apenas 1 encomenda: envia a confirmação unitária padrão
        const single = batch.packages[0];
        console.log(`📤 [DeliveryBatcher] Enviando confirmação unitária para ${batch.residentName} (${batch.phone}) - ${single.carrier}...`);
        const res = await whatsappService.notifyPackageDelivered({
          phone: batch.phone,
          residentName: batch.residentName,
          deliveredTo: batch.deliveredTo,
          unitInfo: batch.unitInfo,
          carrier: single.carrier,
          deliveredAt: single.deliveredAt,
          pickupCode: single.pickupCode,
          qrToken: single.qrToken
        });
        if (res.success) {
          console.log(`✅ [DeliveryBatcher] Confirmação unitária enviada com sucesso para ${batch.phone}!`);
        } else {
          console.warn(`⚠️ [DeliveryBatcher] Falha no envio unitário: ${res.error}`);
        }
      } else {
        // 2 ou mais encomendas: envia a mensagem unificada com a lista consolidada
        console.log(`📤 [DeliveryBatcher] Enviando confirmação CONSOLIDADA de ${count} encomendas para ${batch.residentName} (${batch.phone})...`);
        const res = await whatsappService.notifyMultiplePackagesDelivered({
          phone: batch.phone,
          residentName: batch.residentName,
          deliveredTo: batch.deliveredTo,
          unitInfo: batch.unitInfo,
          packages: batch.packages.map(p => ({
            carrier: p.carrier,
            pickupCode: p.pickupCode,
            deliveredAt: p.deliveredAt
          }))
        });
        if (res.success) {
          console.log(`✅ [DeliveryBatcher] Mensagem consolidada (${count} encomendas) enviada com sucesso para ${batch.phone}!`);
        } else {
          console.warn(`⚠️ [DeliveryBatcher] Falha no envio consolidado: ${res.error}`);
        }
      }
    } catch (err: any) {
      console.error(`❌ [DeliveryBatcher] Erro ao disparar lote para ${batch.phone}:`, err?.message);
    }
  }

  /**
   * Força o envio imediato de qualquer lote pendente (usado no shutdown ou testes)
   */
  public async flushAll(): Promise<void> {
    const keys = Array.from(this.batches.keys());
    for (const key of keys) {
      await this.flushBatch(key);
    }
  }

  /**
   * Força o envio imediato do lote de um telefone/morador específico (ex: porteiro encerrou atendimento)
   */
  public async flushBatchForPhone(phone: string, condoId?: string): Promise<boolean> {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (!cleanPhone) return false;

    const targetKey = condoId ? `${condoId}_${cleanPhone}` : null;
    if (targetKey && this.batches.has(targetKey)) {
      console.log(`⚡ [DeliveryBatcher] Envio imediato solicitado para chave exata ${targetKey}`);
      await this.flushBatch(targetKey);
      return true;
    }

    // Busca por qualquer lote que termine com o telefone
    for (const key of Array.from(this.batches.keys())) {
      if (key.endsWith(`_${cleanPhone}`)) {
        console.log(`⚡ [DeliveryBatcher] Envio imediato solicitado para chave correspondente ${key}`);
        await this.flushBatch(key);
        return true;
      }
    }

    return false;
  }

  /**
   * Retorna o status atual dos lotes em espera (para diagnósticos)
   */
  public getPendingBatchesCount(): number {
    return this.batches.size;
  }
}

export const deliveryBatcherService = new DeliveryBatcherService();
