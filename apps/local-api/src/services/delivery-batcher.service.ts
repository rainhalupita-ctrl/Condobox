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
   * Normaliza telefone para formato numérico limpo (com 55 se tiver DDD)
   */
  public normalizePhone(phone: string): string {
    let clean = (phone || '').replace(/\D/g, '');
    if (!clean) return '';
    if (!clean.startsWith('55') && (clean.length === 10 || clean.length === 11)) {
      clean = `55${clean}`;
    }
    return clean;
  }

  /**
   * Verifica se dois números de telefone correspondem (com/sem 55, com/sem DDD)
   */
  public isPhoneMatch(p1: string, p2: string): boolean {
    const c1 = (p1 || '').replace(/\D/g, '');
    const c2 = (p2 || '').replace(/\D/g, '');
    if (!c1 || !c2) return false;
    if (c1 === c2) return true;
    if (c1.endsWith(c2) || c2.endsWith(c1)) return true;
    // Compara os últimos 8 dígitos (número do celular/fixo sem DDD/DDI)
    if (c1.length >= 8 && c2.length >= 8) {
      if (c1.slice(-8) === c2.slice(-8)) return true;
    }
    return false;
  }

  /**
   * Adiciona uma entrega ao lote do morador.
   * Se hasMorePending for falso (encomenda única ou última do morador), dispara IMEDIATAMENTE.
   * Se hasMorePending for verdadeiro, aguarda se o porteiro vai retirar mais alguma.
   */
  public async addDelivery(item: QueuedDeliveryItem, hasMorePending: boolean = false): Promise<void> {
    const cleanPhone = this.normalizePhone(item.phone);
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
        console.log(`📦 [DeliveryBatcher] Adicionada encomenda ${item.carrier} ao lote de ${cleanPhone}. Total no lote: ${batch.packages.length}`);
      }

      // Se o morador NÃO possui mais nenhuma encomenda pendente (retirou todas), dispara IMEDIATAMENTE!
      if (!hasMorePending || (Date.now() - batch.firstAddedAt >= this.maxWaitMs)) {
        console.log(`🚀 [DeliveryBatcher] Disparando lote IMEDIATAMENTE para ${batch.residentName} (${cleanPhone}) - Motivo: ${!hasMorePending ? 'Todas as encomendas foram retiradas' : 'Tempo máximo atingido'}`);
        await this.flushBatch(key);
        return;
      }

      // Se ainda possui mais encomendas pendentes, reinicia o timer de debounce
      if (batch.timer) {
        clearTimeout(batch.timer);
      }
      batch.timer = setTimeout(() => {
        this.flushBatch(key);
      }, this.debounceMs);
      console.log(`⏳ [DeliveryBatcher] Aguardando próximas retiradas de ${batch.residentName} (${cleanPhone})...`);

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

      this.batches.set(key, batch);

      // Se NÃO tem mais nenhuma encomenda pendente (era a única encomenda):
      if (!hasMorePending) {
        console.log(`⚡ [DeliveryBatcher] Encomenda ÚNICA para ${item.residentName} (${cleanPhone}). Enviando WhatsApp IMEDIATAMENTE...`);
        await this.flushBatch(key);
        return;
      }

      // Se possui 2 ou mais pendentes, aguarda se o porteiro vai retirar as outras
      batch.timer = setTimeout(() => {
        this.flushBatch(key);
      }, this.debounceMs);

      console.log(`⏳ [DeliveryBatcher] Novo lote de retirada com mais encomendas pendentes para ${item.residentName} (${cleanPhone}). Aguardando porteiro retirar demais ou finalizar...`);
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

    console.log(`⚡ [DeliveryBatcher] Solicitado envio imediato (flush) para telefone: ${phone} (condoId: ${condoId || 'qualquer'})`);

    const targetKey = condoId ? `${condoId}_${this.normalizePhone(phone)}` : null;
    if (targetKey && this.batches.has(targetKey)) {
      console.log(`⚡ [DeliveryBatcher] Envio imediato disparado para chave exata ${targetKey}`);
      await this.flushBatch(targetKey);
      return true;
    }

    // Busca por qualquer lote ativo que coincida com o telefone do morador
    for (const [key, batch] of Array.from(this.batches.entries())) {
      if (this.isPhoneMatch(batch.phone, cleanPhone)) {
        console.log(`⚡ [DeliveryBatcher] Envio imediato disparado para lote do morador ${batch.residentName} (${batch.phone}) na chave: ${key}`);
        await this.flushBatch(key);
        return true;
      }
    }

    console.log(`ℹ️ [DeliveryBatcher] Nenhum lote pendente em memória para o telefone ${phone}. Pode já ter sido enviado imediatamente.`);
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
