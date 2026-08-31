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

    } catch (err: any) {
      this.isOnline = false;
      // Silencioso para não poluir logs em caso de internet offline na portaria
    } finally {
      this.isSyncing = false;
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
        }
      } catch (e) {
        // Tenta novamente na próxima rodada
      }
    }
  }

  private async pullUnitsAndResidents(): Promise<void> {
    try {
      const client = supabaseService.getClient();

      let unitQuery = client
        .from('units')
        .select('id, condo_id, block, unit_number, created_at, updated_at');

      if (env.CONDO_ID) {
        unitQuery = unitQuery.eq('condo_id', env.CONDO_ID);
      }

      const { data: units } = await unitQuery;

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
