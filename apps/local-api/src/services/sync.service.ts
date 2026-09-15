import { databaseService } from './database.service.js';
import { supabaseService } from './supabase.service.js';
import { env } from '../config/env.js';

export class SyncService {
  private isSyncing = false;
  private intervalId: NodeJS.Timeout | null = null;
  private isOnline = false;

  public start(intervalMs = 30000) {
    if (this.intervalId) return;

    console.log('🔄 [Sync Service] Inicializando serviço de sincronização híbrida (SQLite <-> Supabase)...');
    
    // Executa sincronização inicial após 5s
    setTimeout(() => {
      this.syncAll();
    }, 5000);

    // Agenda sincronização contínua a cada intervalo (padrão: 30s)
    this.intervalId = setInterval(() => {
      this.syncAll();
    }, intervalMs);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public getStatus(): { isOnline: boolean; isSyncing: boolean } {
    return {
      isOnline: this.isOnline,
      isSyncing: this.isSyncing
    };
  }

  public async syncAll(): Promise<void> {
    if (this.isSyncing || !supabaseService.isConfigured()) return;
    this.isSyncing = true;

    try {
      // 1. Testar conectividade com o Supabase
      const client = supabaseService.getClient();
      const { data: testUnits, error: testErr } = await client
        .from('units')
        .select('id')
        .limit(1);

      if (testErr) {
        this.isOnline = false;
        return;
      }

      this.isOnline = true;

      // 2. Push: Enviar pacotes pendentes gravados localmente no SQLite
      await this.pushPendingPackages();

      // 3. Pull: Baixar unidades e moradores atualizados da nuvem
      await this.pullUnitsAndResidents();

      // 4. Reconcile: Sincronizar exclusões e mudanças de status de encomendas da nuvem para o SQLite local
      await this.reconcilePackages();

    } catch (err: any) {
      this.isOnline = false;
      // Silencioso para não poluir logs em caso de internet offline na portaria
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Reconciliação Bidirecional:
   * Verifica pacotes locais ativos (RECEIVED ou NOTIFIED).
   * - Se o pacote foi excluído na nuvem (Supabase), apaga-o do SQLite local.
   * - Se o pacote mudou de status na nuvem (DELIVERED ou RETURNED), atualiza no SQLite local.
   */
  public async reconcilePackages(): Promise<void> {
    try {
      const allLocal = databaseService.getAllPackages();
      // Pacotes que ainda constam como aguardando retirada no SQLite local
      const activeLocal = allLocal.filter(p => p.status === 'RECEIVED' || p.status === 'NOTIFIED');
      if (activeLocal.length === 0) return;

      const client = supabaseService.getClient();
      const localIds = activeLocal.map(p => p.id);

      const chunkSize = 50;
      for (let i = 0; i < localIds.length; i += chunkSize) {
        const chunk = localIds.slice(i, i + chunkSize);
        const { data: cloudPkgs, error } = await client
          .from('packages')
          .select('id, status, notes, delivered_at, delivered_to_name')
          .in('id', chunk);

        if (error) {
          console.warn('[SyncService] Erro ao consultar nuvem para reconciliação:', error.message);
          continue;
        }

        const cloudMap = new Map((cloudPkgs || []).map(cp => [cp.id, cp]));

        for (const localId of chunk) {
          const localPkg = activeLocal.find(p => p.id === localId);
          if (!localPkg) continue;

          const cloudPkg = cloudMap.get(localId);

          if (!cloudPkg) {
            // Encomenda não existe mais no Supabase.
            // Se já foi sincronizada ou foi cadastrada há mais de 10 min, foi excluída na nuvem!
            const ageMs = Date.now() - new Date(localPkg.received_at).getTime();
            if (localPkg.sync_status === 'SYNCED' || ageMs > 10 * 60 * 1000) {
              console.log(`🧹 [SyncService] Encomenda excluída na nuvem removida do banco local: ${localPkg.pickup_code} (${localPkg.carrier})`);
              databaseService.deletePackage(localId);
            }
          } else {
            // Se existe na nuvem, checa se o status mudou (ex: retirada ou devolvida via web)
            if (cloudPkg.status !== localPkg.status) {
              console.log(`🔄 [SyncService] Sincronizando status da encomenda ${localPkg.pickup_code}: local ${localPkg.status} -> nuvem ${cloudPkg.status}`);
              databaseService.updatePackageStatus(localId, cloudPkg.status);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[SyncService] Exceção durante reconciliação de pacotes:', err.message);
    }
  }

  private async pushPendingPackages(): Promise<void> {
    const pending = databaseService.getPendingSyncPackages();
    if (pending.length === 0) return;

    const client = supabaseService.getClient();

    for (const pkg of pending) {
      try {
        const { error } = await client
          .from('packages')
          .upsert({
            id: pkg.id,
            condo_id: pkg.condo_id || env.CONDO_ID,
            unit_id: pkg.unit_id,
            resident_id: pkg.resident_id || null,
            carrier: pkg.carrier,
            tracking_code: pkg.tracking_code || null,
            recipient_name_ocr: pkg.recipient_name_ocr || null,
            label_image_path: pkg.label_image_path || null,
            signature_image_path: pkg.signature_image_path || null,
            delivered_to_name: pkg.delivered_to_name || null,
            delivered_by_user_id: pkg.delivered_by_user_id || null,
            pickup_code: pkg.pickup_code,
            qr_token: pkg.qr_token,
            status: pkg.status,
            received_at: pkg.received_at,
            delivered_at: pkg.delivered_at || null,
            notes: pkg.notes || null
          });

        if (!error) {
          databaseService.markPackageSynced(pkg.id);
        } else {
          console.error('[SyncService] Falha ao sincronizar pacote:', pkg.id, error.message);
        }
      } catch (e: any) {
        console.error('[SyncService] Exceção ao sincronizar pacote:', pkg.id, e.message);
      }
    }
  }

  private async pullUnitsAndResidents(): Promise<void> {
    try {
      const client = supabaseService.getClient();

      const { data: units } = await client
        .from('units')
        .select('id, condo_id, block, unit_number, created_at, updated_at');

      const { data: residents } = await client
        .from('residents')
        .select('id, unit_id, name, phone, email, is_primary, active, created_at, updated_at')
        .eq('active', true);

      if (units && units.length > 0) {
        databaseService.upsertUnitsAndResidents(units, residents || []);
      }
    } catch {}
  }
}

export const syncService = new SyncService();
