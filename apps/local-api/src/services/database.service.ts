import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { env, ABSOLUTE_STORAGE_DIR } from '../config/env.js';

export interface LocalUnit {
  id: string;
  condo_id: string;
  block: string;
  unit_number: string;
  created_at?: string;
  updated_at?: string;
}

export interface LocalResident {
  id: string;
  unit_id: string;
  name: string;
  phone: string;
  email?: string | null;
  is_primary?: number;
  active?: number;
  created_at?: string;
  updated_at?: string;
}

export interface LocalPackage {
  id: string;
  condo_id: string;
  unit_id: string;
  resident_id?: string | null;
  carrier: string;
  tracking_code?: string | null;
  recipient_name_ocr?: string | null;
  label_image_path?: string | null;
  signature_image_path?: string | null;
  delivered_to_name?: string | null;
  delivered_by_user_id?: string | null;
  pickup_code: string;
  qr_token: string;
  status: 'RECEIVED' | 'NOTIFIED' | 'DELIVERED';
  received_at: string;
  delivered_at?: string | null;
  notes?: string | null;
  sync_status: 'PENDING' | 'SYNCED' | 'FAILED';
  last_synced_at?: string | null;
  unit?: { id: string; block: string; unit_number: string } | null;
  resident?: { id: string; name: string; phone: string } | null;
}

export interface CreatePackageLocalInput {
  condoId?: string;
  unitId: string;
  residentId?: string | null;
  carrier: string;
  trackingCode?: string | null;
  recipientNameOcr?: string | null;
  labelImagePath?: string | null;
  receivedByUserId?: string | null;
  notes?: string | null;
}

export class DatabaseService {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    const roamingDesktopData = path.join(process.env.APPDATA || '', 'condobox-desktop', 'data');
    let dataDir = process.env.CONDOBOX_DATA_DIR;
    if (!dataDir) {
      if (fs.existsSync(path.join(roamingDesktopData, 'condobox.db'))) {
        dataDir = roamingDesktopData;
      } else {
        dataDir = path.resolve(ABSOLUTE_STORAGE_DIR || process.cwd(), '../../data');
      }
    }

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = path.join(dataDir, 'condobox.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS units (
        id TEXT PRIMARY KEY,
        condo_id TEXT NOT NULL,
        block TEXT NOT NULL,
        unit_number TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS residents (
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        is_primary INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS packages (
        id TEXT PRIMARY KEY,
        condo_id TEXT NOT NULL,
        unit_id TEXT,
        resident_id TEXT,
        carrier TEXT NOT NULL,
        tracking_code TEXT,
        recipient_name_ocr TEXT,
        label_image_path TEXT,
        signature_image_path TEXT,
        delivered_to_name TEXT,
        delivered_by_user_id TEXT,
        pickup_code TEXT NOT NULL,
        qr_token TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RECEIVED',
        received_at TEXT DEFAULT (datetime('now')),
        delivered_at TEXT,
        notes TEXT,
        sync_status TEXT DEFAULT 'PENDING',
        last_synced_at TEXT
      );

      CREATE TABLE IF NOT EXISTS notifications_log (
        id TEXT PRIMARY KEY,
        package_id TEXT NOT NULL,
        resident_id TEXT,
        recipient_phone TEXT NOT NULL,
        message_content TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_learned_patterns (
        pattern_key TEXT PRIMARY KEY,
        intent TEXT NOT NULL,
        confidence REAL NOT NULL,
        reasoning TEXT,
        hits INTEGER DEFAULT 1,
        source TEXT DEFAULT 'ai_learned',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
      CREATE INDEX IF NOT EXISTS idx_packages_pickup_code ON packages(pickup_code);
      CREATE INDEX IF NOT EXISTS idx_packages_qr_token ON packages(qr_token);
      CREATE INDEX IF NOT EXISTS idx_packages_sync ON packages(sync_status);
      CREATE INDEX IF NOT EXISTS idx_residents_phone ON residents(phone);
      CREATE INDEX IF NOT EXISTS idx_ai_patterns_intent ON ai_learned_patterns(intent);
    `);

    console.log(`📦 [Database Service] Banco SQLite inicializado com sucesso em: ${this.dbPath}`);
  }

  public getUnitsAndResidents(condoId?: string): { units: LocalUnit[]; residents: LocalResident[] } {
    let unitsStmt = this.db.prepare('SELECT * FROM units ORDER BY block ASC, unit_number ASC');
    let residentsStmt = this.db.prepare('SELECT * FROM residents WHERE active = 1 ORDER BY name ASC');

    if (condoId && condoId.trim() !== '') {
      unitsStmt = this.db.prepare('SELECT * FROM units WHERE condo_id = ? ORDER BY block ASC, unit_number ASC');
    }

    const units = (condoId ? unitsStmt.all(condoId) : unitsStmt.all()) as LocalUnit[];
    const residents = residentsStmt.all() as LocalResident[];

    return { units, residents };
  }

  public matchResidentFromOCR(params: {
    unitNumber?: string | null;
    block?: string | null;
    recipientName?: string | null;
  }) {
    const { units, residents } = this.getUnitsAndResidents();

    let matchedUnit: LocalUnit | null = null;
    if (params.unitNumber) {
      const cleanNum = params.unitNumber.replace(/\D/g, '');
      matchedUnit = units.find(u => {
        const uNum = u.unit_number.replace(/\D/g, '');
        const matchNum = uNum === cleanNum;
        if (params.block) {
          const matchBlock =
            u.block.toLowerCase().includes(params.block.toLowerCase()) ||
            params.block.toLowerCase().includes(u.block.toLowerCase());
          return matchNum && matchBlock;
        }
        return matchNum;
      }) || units.find(u => u.unit_number.replace(/\D/g, '') === cleanNum) || null;
    }

    let matchedResident: LocalResident | null = null;
    if (matchedUnit) {
      const unitResidents = residents.filter(r => r.unit_id === matchedUnit!.id);
      if (params.recipientName) {
        const nameQuery = params.recipientName.toLowerCase().trim();
        matchedResident = unitResidents.find(r => {
          const rName = r.name.toLowerCase();
          return (
            rName.includes(nameQuery) ||
            nameQuery.includes(rName) ||
            rName.split(' ')[0] === nameQuery.split(' ')[0]
          );
        }) || null;
      }
      if (!matchedResident && unitResidents.length > 0) {
        matchedResident = unitResidents.find(r => r.is_primary === 1) || unitResidents[0];
      }
    }

    return {
      unit: matchedUnit,
      resident: matchedResident
    };
  }

  public createPackage(input: CreatePackageLocalInput): LocalPackage {
    const id = uuidv4();
    // Gera código alfanumérico de 6 caracteres e token único
    const pickupCode = Array.from({length: 6}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.charAt(Math.floor(Math.random() * 36))).join('');
    const qrToken = `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const nowIso = new Date().toISOString();

    const insert = this.db.prepare(`
      INSERT INTO packages (
        id, condo_id, unit_id, resident_id, carrier, tracking_code,
        recipient_name_ocr, label_image_path, pickup_code, qr_token,
        status, received_at, notes, sync_status
      ) VALUES (
        @id, @condo_id, @unit_id, @resident_id, @carrier, @tracking_code,
        @recipient_name_ocr, @label_image_path, @pickup_code, @qr_token,
        'RECEIVED', @received_at, @notes, 'PENDING'
      )
    `);

    insert.run({
      id,
      condo_id: input.condoId || env.CONDO_ID,
      unit_id: input.unitId,
      resident_id: input.residentId || null,
      carrier: input.carrier || 'Outro',
      tracking_code: input.trackingCode || null,
      recipient_name_ocr: input.recipientNameOcr || null,
      label_image_path: input.labelImagePath || null,
      pickup_code: pickupCode,
      qr_token: qrToken,
      received_at: nowIso,
      notes: input.notes || null
    });

    return this.getPackageById(id)!;
  }

  public deliverPackage(params: {
    packageId: string;
    signatureImagePath: string;
    deliveredToName: string;
    deliveredByUserId?: string | null;
  }): LocalPackage | null {
    const nowIso = new Date().toISOString();
    const update = this.db.prepare(`
      UPDATE packages
      SET
        status = 'DELIVERED',
        signature_image_path = @signature_image_path,
        delivered_to_name = @delivered_to_name,
        delivered_by_user_id = @delivered_by_user_id,
        delivered_at = @delivered_at,
        sync_status = 'PENDING'
      WHERE id = @packageId
    `);

    update.run({
      packageId: params.packageId,
      signature_image_path: params.signatureImagePath,
      delivered_to_name: params.deliveredToName,
      delivered_by_user_id: params.deliveredByUserId || null,
      delivered_at: nowIso
    });

    return this.getPackageById(params.packageId);
  }

  public getPackageById(id: string): any {
    const row = this.db
      .prepare(`
        SELECT p.*,
               u.block as unit_block, u.unit_number as unit_number,
               r.name as resident_name, r.phone as resident_phone
        FROM packages p
        LEFT JOIN units u ON p.unit_id = u.id
        LEFT JOIN residents r ON p.resident_id = r.id
        WHERE p.id = ?
      `)
      .get(id) as any;

    if (!row) return null;

    return {
      ...row,
      unit: row.unit_id ? { id: row.unit_id, block: row.unit_block, unit_number: row.unit_number } : null,
      resident: row.resident_id ? { id: row.resident_id, name: row.resident_name, phone: row.resident_phone } : null
    };
  }

  public getPackageByQrTokenOrCode(tokenOrCode: string): any {
    const row = this.db
      .prepare(`
        SELECT p.*,
               u.block as unit_block, u.unit_number as unit_number,
               r.name as resident_name, r.phone as resident_phone
        FROM packages p
        LEFT JOIN units u ON p.unit_id = u.id
        LEFT JOIN residents r ON p.resident_id = r.id
        WHERE p.qr_token = ? OR p.pickup_code = ?
        ORDER BY p.received_at DESC
        LIMIT 1
      `)
      .get(tokenOrCode, tokenOrCode) as any;

    if (!row) return null;

    return {
      ...row,
      unit: row.unit_id ? { id: row.unit_id, block: row.unit_block, unit_number: row.unit_number } : null,
      resident: row.resident_id ? { id: row.resident_id, name: row.resident_name, phone: row.resident_phone } : null
    };
  }

  public listRecentPackages(limit = 50): any[] {
    const rows = this.db
      .prepare(`
        SELECT p.*,
               u.block as unit_block, u.unit_number as unit_number,
               r.name as resident_name, r.phone as resident_phone
        FROM packages p
        LEFT JOIN units u ON p.unit_id = u.id
        LEFT JOIN residents r ON p.resident_id = r.id
        ORDER BY p.received_at DESC
        LIMIT ?
      `)
      .all(limit) as any[];

    return rows.map(row => ({
      ...row,
      unit: row.unit_id ? { id: row.unit_id, block: row.unit_block, unit_number: row.unit_number } : null,
      resident: row.resident_id ? { id: row.resident_id, name: row.resident_name, phone: row.resident_phone } : null
    }));
  }

  public async getPendingPackagesForPhone(phone: string, mentionedCode?: string | null): Promise<any[]> {
    const clean = phone.replace(/\D/g, '');
    const last8 = clean.slice(-8);

    let rows: any[] = [];

    // 1. Busca por código informado diretamente
    if (mentionedCode) {
      const query = `
        SELECT p.*, r.name as resident_name, r.phone as resident_phone
        FROM packages p
        LEFT JOIN residents r ON p.resident_id = r.id
        WHERE p.status != 'DELIVERED'
          AND (p.pickup_code = ? OR upper(p.pickup_code) = upper(?))
        LIMIT 1
      `;
      const single = this.db.prepare(query).get(mentionedCode, mentionedCode) as any;
      if (single) rows = [single];
    }

    // 2. Busca local no SQLite por telefone do morador se não encontrou por código
    if (rows.length === 0 && last8) {
      const candidates = this.db.prepare(`
        SELECT p.*, r.name as resident_name, r.phone as resident_phone
        FROM packages p
        LEFT JOIN residents r ON p.resident_id = r.id
        WHERE p.status != 'DELIVERED'
        ORDER BY p.received_at DESC
      `).all() as any[];

      for (const cand of candidates) {
        if (!cand.resident_phone) continue;
        const cleanCand = cand.resident_phone.replace(/\D/g, '');
        const candLast8 = cleanCand.slice(-8);
        if (candLast8 && (candLast8 === last8 || cleanCand.endsWith(last8) || clean.endsWith(candLast8))) {
          rows.push(cand);
        }
      }
    }

    // 3. Fallback na Nuvem (Supabase) se não encontrar no SQLite local
    if (rows.length === 0 && last8) {
      try {
        const { supabaseService } = await import('./supabase.service.js');
        if (supabaseService.isConfigured()) {
          const client = supabaseService.getClient();
          const { data: cloudPkgs } = await client
            .from('packages')
            .select('*, resident:residents(*)')
            .neq('status', 'DELIVERED')
            .order('created_at', { ascending: false })
            .limit(30);

          if (cloudPkgs && cloudPkgs.length > 0) {
            for (const cPkg of cloudPkgs) {
              if (mentionedCode && (cPkg.pickup_code === mentionedCode || cPkg.pickup_code?.toUpperCase() === mentionedCode.toUpperCase())) {
                rows.push(cPkg);
                break;
              }
              const rPhone = cPkg.resident?.phone;
              if (rPhone && last8) {
                const cleanCloud = rPhone.replace(/\D/g, '');
                const cloudLast8 = cleanCloud.slice(-8);
                if (cloudLast8 && (cloudLast8 === last8 || cleanCloud.endsWith(last8) || clean.endsWith(cloudLast8))) {
                  rows.push(cPkg);
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.warn('[DatabaseService] Erro ao buscar pacotes no Supabase:', err.message);
      }
    }

    if (rows.length === 0) return [];

    // Deduplica por ID
    const uniqueMap = new Map<string, any>();
    for (const r of rows) {
      if (!uniqueMap.has(r.id)) uniqueMap.set(r.id, r);
    }
    const allMatching = Array.from(uniqueMap.values());

    const isDelivered = (p: any): boolean => {
      return p.status === 'DELIVERED' ||
             Boolean(p.delivered_at) ||
             Boolean(p.notes?.includes('DELIVERY_NOTIFIED'));
    };

    return allMatching.filter(p => !isDelivered(p));
  }

  public async acknowledgePackageByPhone(phone: string, mentionedCode?: string | null): Promise<{ pkg?: any; pkgs?: any[]; alreadyAcknowledged?: boolean } | null> {
    const clean = phone.replace(/\D/g, '');
    const pendingDelivery = await this.getPendingPackagesForPhone(phone, mentionedCode);

    if (pendingDelivery.length === 0) {
      console.log(`ℹ️ [DatabaseService] Nenhuma encomenda pendente encontrada para ${clean}.`);
      return null;
    }

    const isAcknowledged = (p: any): boolean => {
      if (!p.notes) return false;
      const n = p.notes.toUpperCase();
      return n.includes('CIENTE:') ||
             n.includes('CIÊNCIA CONFIRMADA') ||
             n.includes('CIENCIA CONFIRMADA');
    };

    const unacknowledged = pendingDelivery.filter(p => !isAcknowledged(p));
    let targetPkgs: any[] = [];

    // Se o morador digitou um código específico:
    if (mentionedCode) {
      const matched = pendingDelivery.find(p => p.pickup_code === mentionedCode || p.pickup_code?.toUpperCase() === mentionedCode.toUpperCase());
      if (!matched) {
        console.log(`ℹ️ [DatabaseService] Código informado (${mentionedCode}) não corresponde a nenhuma encomenda de ${clean}. Não confirmando.`);
        return null;
      }

      if (isAcknowledged(matched)) {
        console.log(`ℹ️ [DatabaseService] Encomenda (${matched.pickup_code}) já havia sido confirmada anteriormente por ${clean}.`);
        return { pkg: matched, pkgs: [matched], alreadyAcknowledged: true };
      }

      targetPkgs = [matched];
    } else {
      // Se não digitou código, verifica se há novas encomendas pendentes de ciência
      if (unacknowledged.length === 0) {
        console.log(`ℹ️ [DatabaseService] Morador (${clean}) já havia confirmado ciência de todas as ${pendingDelivery.length} encomenda(s). Retornando encomendas ativas para reenvio.`);
        return { pkg: pendingDelivery[0], pkgs: pendingDelivery, alreadyAcknowledged: true };
      }

      targetPkgs = unacknowledged;
    }

    const nowIso = new Date().toISOString();

    for (const row of targetPkgs) {
      const updatedNotes = row.notes?.includes('CIENTE:') ? row.notes : (row.notes ? `${row.notes};CIENTE:${nowIso}` : `CIENTE:${nowIso}`);
      row.notes = updatedNotes;

      // Atualiza SQLite local se existir no banco local
      try {
        this.db.prepare(`
          UPDATE packages
          SET status = CASE WHEN status = 'RECEIVED' THEN 'NOTIFIED' ELSE status END,
              notes = ?,
              sync_status = 'PENDING'
          WHERE id = ?
        `).run(updatedNotes, row.id);
      } catch {}

      // Sincroniza em background com Supabase com lock atômico
      try {
        const { supabaseService } = await import('./supabase.service.js');
        if (supabaseService.isConfigured()) {
          await supabaseService.getClient()
            .from('packages')
            .update({
              notes: updatedNotes,
              status: row.status === 'RECEIVED' ? 'NOTIFIED' : row.status
            })
            .eq('id', row.id);
        }
      } catch (err: any) {
        console.warn('[DatabaseService] Erro ao sincronizar ciência no Supabase:', err.message);
      }
    }

    const finalPkgs = targetPkgs.map(row => {
      const local = this.getPackageById(row.id);
      if (local) return local;
      return {
        id: row.id,
        pickup_code: row.pickup_code,
        qr_token: row.qr_token || row.pickup_code,
        carrier: row.carrier,
        recipient_name_ocr: row.recipient_name_ocr || row.resident?.name,
        notes: row.notes,
        status: 'NOTIFIED',
        resident: row.resident
      };
    });

    return {
      pkg: finalPkgs[0],
      pkgs: finalPkgs,
      alreadyAcknowledged: false
    };
  }

  public async contestPackageByPhone(
    phone: string,
    reason: string,
    mentionedCode?: string | null
  ): Promise<{ pkg?: any; pkgs?: any[] } | null> {
    const clean = phone.replace(/\D/g, '');
    const pendingDelivery = await this.getPendingPackagesForPhone(phone, mentionedCode);

    if (pendingDelivery.length === 0) {
      console.log(`ℹ️ [DatabaseService] Nenhuma encomenda pendente encontrada para contestar para ${clean}.`);
      return null;
    }

    let targetPkgs: any[] = [];
    if (mentionedCode) {
      const matched = pendingDelivery.find(
        p => p.pickup_code === mentionedCode || p.pickup_code?.toUpperCase() === mentionedCode.toUpperCase()
      );
      if (matched) {
        targetPkgs = [matched];
      } else {
        targetPkgs = [pendingDelivery[0]];
      }
    } else {
      targetPkgs = pendingDelivery;
    }

    const nowIso = new Date().toISOString();
    const cleanReason = (reason || 'Morador informou que não tem ciência ou não reconhece a encomenda').trim().slice(0, 160);

    for (const row of targetPkgs) {
      const updatedNotes = row.notes
        ? `${row.notes};CONTESTADO:${nowIso}: ${cleanReason}`
        : `CONTESTADO:${nowIso}: ${cleanReason}`;
      row.notes = updatedNotes;

      // 1. Atualiza SQLite local
      try {
        this.db
          .prepare(`
            UPDATE packages
            SET notes = ?,
                sync_status = 'PENDING'
            WHERE id = ?
          `)
          .run(updatedNotes, row.id);
      } catch (e: any) {
        console.warn(`[DatabaseService] Erro ao gravar contestação no SQLite:`, e.message);
      }

      // 2. Sincroniza com Supabase e dispara broadcast de alerta em tempo real
      try {
        const { supabaseService } = await import('./supabase.service.js');
        if (supabaseService.isConfigured()) {
          const client = supabaseService.getClient();
          await client
            .from('packages')
            .update({ notes: updatedNotes })
            .eq('id', row.id);

          const condoId = row.condo_id || env.CONDO_ID;
          const channel = client.channel(`condo-alerts-${condoId}`);
          channel.subscribe(async (status: string) => {
            if (status === 'SUBSCRIBED') {
              await channel.send({
                type: 'broadcast',
                event: 'package-contested',
                payload: {
                  packageId: row.id,
                  carrier: row.carrier,
                  pickupCode: row.pickup_code,
                  residentName: row.resident?.name || row.recipient_name_ocr,
                  reason: cleanReason,
                  timestamp: nowIso
                }
              }).catch(() => {});
              setTimeout(() => client.removeChannel(channel), 3000);
            }
          });
        }
      } catch (err: any) {
        console.warn('[DatabaseService] Erro ao sincronizar contestação no Supabase:', err.message);
      }
    }

    const finalPkgs = targetPkgs.map(row => {
      const local = this.getPackageById(row.id);
      if (local) return local;
      return row;
    });

    return {
      pkg: finalPkgs[0],
      pkgs: finalPkgs
    };
  }

  public getPendingSyncPackages(): LocalPackage[] {
    return this.db
      .prepare(`SELECT * FROM packages WHERE sync_status = 'PENDING' ORDER BY received_at ASC LIMIT 50`)
      .all() as LocalPackage[];
  }

  public markPackageSynced(id: string) {
    this.db
      .prepare(`UPDATE packages SET sync_status = 'SYNCED', last_synced_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  public upsertUnitsAndResidents(units: any[], residents: any[]) {
    const insertUnit = this.db.prepare(`
      INSERT INTO units (id, condo_id, block, unit_number, created_at, updated_at)
      VALUES (@id, @condo_id, @block, @unit_number, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        block = excluded.block,
        unit_number = excluded.unit_number,
        updated_at = excluded.updated_at
    `);

    const insertResident = this.db.prepare(`
      INSERT INTO residents (id, unit_id, name, phone, email, is_primary, active, created_at, updated_at)
      VALUES (@id, @unit_id, @name, @phone, @email, @is_primary, @active, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        email = excluded.email,
        is_primary = excluded.is_primary,
        active = excluded.active,
        updated_at = excluded.updated_at
    `);

    const transaction = this.db.transaction(() => {
      for (const u of units) {
        insertUnit.run({
          id: u.id,
          condo_id: u.condo_id || env.CONDO_ID,
          block: u.block || '',
          unit_number: u.unit_number || '',
          created_at: u.created_at || new Date().toISOString(),
          updated_at: u.updated_at || new Date().toISOString()
        });
      }
      for (const r of residents) {
        insertResident.run({
          id: r.id,
          unit_id: r.unit_id,
          name: r.name,
          phone: r.phone || '',
          email: r.email || null,
          is_primary: r.is_primary ? 1 : 0,
          active: r.active === false ? 0 : 1,
          created_at: r.created_at || new Date().toISOString(),
          updated_at: r.updated_at || new Date().toISOString()
        });
      }
    });

      transaction();
    console.log(`🔄 [Database Service] Atualizados ${units.length} unidades e ${residents.length} moradores do Supabase.`);
  }

  public getResidentById(residentId: string): LocalResident | null {
    return (this.db.prepare('SELECT * FROM residents WHERE id = ?').get(residentId) as LocalResident) || null;
  }

  public getResidentsByUnit(unitId: string): LocalResident[] {
    return this.db.prepare('SELECT * FROM residents WHERE unit_id = ? AND active = 1 ORDER BY is_primary DESC').all(unitId) as LocalResident[];
  }

  public getUnitById(unitId: string): LocalUnit | null {
    return (this.db.prepare('SELECT * FROM units WHERE id = ?').get(unitId) as LocalUnit) || null;
  }

  public getAllPackages(): LocalPackage[] {
    return this.db.prepare('SELECT * FROM packages ORDER BY received_at DESC').all() as LocalPackage[];
  }

  public getNotificationsLogByPackageId(packageId: string): any[] {
    try {
      return this.db.prepare('SELECT * FROM notifications_log WHERE package_id = ? ORDER BY sent_at DESC').all(packageId) as any[];
    } catch {
      return [];
    }
  }

  public logNotification(params: {
    packageId: string;
    residentId?: string | null;
    channel: string;
    recipient: string;
    status: string;
    sentAt?: string;
  }): void {
    try {
      this.db.prepare(`
        INSERT INTO notifications_log (
          id, package_id, resident_id, channel, recipient, status, sent_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?
        )
      `).run(
        uuidv4(),
        params.packageId,
        params.residentId || null,
        params.channel || 'WHATSAPP',
        params.recipient,
        params.status || 'SENT',
        params.sentAt || new Date().toISOString()
      );
    } catch (err: any) {
      console.warn('[Database Service] Erro ao gravar notifications_log:', err.message);
    }
  }

  public updatePackageStatus(packageId: string, status: 'RECEIVED' | 'NOTIFIED' | 'DELIVERED' | 'RETURNED'): void {
    this.db.prepare('UPDATE packages SET status = ? WHERE id = ?').run(status, packageId);
  }

  /**
   * Exclui definitivamente uma encomenda e seus registros vinculados no SQLite
   */
  public deletePackage(id: string): boolean {
    try {
      // Remove logs vinculados primeiro (caso foreign_keys não esteja ativado)
      this.db.prepare('DELETE FROM notifications_log WHERE package_id = ?').run(id);
      const res = this.db.prepare('DELETE FROM packages WHERE id = ?').run(id);
      return res.changes > 0;
    } catch (err: any) {
      console.error('[DatabaseService] Erro ao excluir pacote:', err.message);
      return false;
    }
  }

  /**
   * Marca uma encomenda como DEVOLVIDA/CANCELADA mantendo o registro para auditoria
   */
  public returnPackage(id: string, reason?: string): boolean {
    try {
      const noteAppend = reason ? `[DEVOLVIDA AO ENTREGADOR]: ${reason}` : '[DEVOLVIDA AO ENTREGADOR]';
      const res = this.db.prepare(`
        UPDATE packages
        SET status = 'RETURNED',
            notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || ' | ' || ? END
        WHERE id = ?
      `).run(noteAppend, noteAppend, id);
      return res.changes > 0;
    } catch (err: any) {
      console.error('[DatabaseService] Erro ao devolver pacote:', err.message);
      return false;
    }
  }

  public getLearnedPattern(patternKey: string) {
    try {
      return this.db.prepare('SELECT * FROM ai_learned_patterns WHERE pattern_key = ?').get(patternKey) as {
        pattern_key: string;
        intent: string;
        confidence: number;
        reasoning: string;
        hits: number;
        source: string;
      } | undefined;
    } catch {
      return undefined;
    }
  }

  public saveLearnedPattern(
    patternKey: string,
    intent: string,
    confidence: number,
    reasoning: string,
    source: string = 'ai_learned'
  ): void {
    try {
      this.db.prepare(`
        INSERT INTO ai_learned_patterns (pattern_key, intent, confidence, reasoning, hits, source, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, datetime('now'))
        ON CONFLICT(pattern_key) DO UPDATE SET
          hits = hits + 1,
          intent = excluded.intent,
          confidence = MAX(confidence, excluded.confidence),
          reasoning = excluded.reasoning,
          updated_at = datetime('now')
      `).run(patternKey, intent, confidence, reasoning, source);
    } catch (err: any) {
      console.warn(`[DatabaseService] Erro ao salvar padrão aprendido: ${err.message}`);
    }
  }

  public incrementPatternHits(patternKey: string): void {
    try {
      this.db.prepare(`
        UPDATE ai_learned_patterns
        SET hits = hits + 1, updated_at = datetime('now')
        WHERE pattern_key = ?
      `).run(patternKey);
    } catch {}
  }

  public getAllLearnedPatterns() {
    try {
      return this.db.prepare('SELECT * FROM ai_learned_patterns').all() as Array<{
        pattern_key: string;
        intent: string;
        confidence: number;
        reasoning: string;
        hits: number;
        source: string;
      }>;
    } catch {
      return [];
    }
  }
}

export const databaseService = new DatabaseService();
