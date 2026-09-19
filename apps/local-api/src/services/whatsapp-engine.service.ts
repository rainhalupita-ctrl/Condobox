import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WAMessage,
  proto,
  WASocket,
  Browsers,
  makeCacheableSignalKeyStore,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import { GoogleGenerativeAI } from '@google/generative-ai';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import os from 'os';
import { env, ABSOLUTE_STORAGE_DIR } from '../config/env.js';
import { supabaseService } from './supabase.service.js';
import { databaseService } from './database.service.js';
import { aiIntentService } from './ai-intent.service.js';

export interface WhatsAppStatus {
  status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED';
  connected: boolean;
  phone?: string | null;
  qrcode?: string | null;
  pairingCode?: string | null;
}

export class WhatsAppEngineService {
  private socket: WASocket | null = null;
  private sessionDir: string;
  private currentStatus: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' = 'DISCONNECTED';
  private qrCodeBase64: string | null = null;
  private connectedPhone: string | null = null;
  private isInitializing = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lidCache: Map<string, string> = new Map();
  private jidToPhoneMap: Map<string, string> = new Map();
  private recentNotificationByPhone: Map<string, any> = new Map();
  private recentNotificationByJid: Map<string, any> = new Map();
  private processedMessageIds: Set<string> = new Set();
  private acknowledgmentCooldown: Map<string, number> = new Map();
  private recentSentMessagesRaw: Map<string, any> = new Map();
  private watchdogInterval: NodeJS.Timeout | null = null;
  private recentSentNotifications: Map<string, {
    packageId?: string;
    phone: string;
    residentName: string;
    carrier: string;
    pickupCode: string;
    qrToken?: string;
    timestamp: number;
  }> = new Map();

  constructor() {
    const roamingDesktopData = path.join(process.env.APPDATA || '', 'condobox-desktop', 'data');
    let baseDataDir = process.env.CONDOBOX_DATA_DIR;
    if (!baseDataDir) {
      if (fs.existsSync(path.join(roamingDesktopData, 'whatsapp_session', 'creds.json'))) {
        baseDataDir = roamingDesktopData;
      } else {
        baseDataDir = path.resolve(process.cwd(), 'data');
      }
    }
    this.sessionDir = path.resolve(baseDataDir, 'whatsapp_session');
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
    console.log(`📱 [WhatsApp Engine] Diretório de sessão configurado em: ${this.sessionDir}`);
    this.preloadLidMappings();
  }

  private preloadLidMappings(): void {
    const dirs = [
      this.sessionDir,
      path.join(process.env.APPDATA || '', 'condobox-desktop', 'data', 'whatsapp_session'),
      path.resolve(process.cwd(), 'data', 'whatsapp_session')
    ];

    for (const dir of dirs) {
      try {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          for (const f of files) {
            if (f.startsWith('lid-mapping-') && f.endsWith('.json')) {
              try {
                const content = fs.readFileSync(path.join(dir, f), 'utf-8').trim().replace(/"/g, '');
                if (f.endsWith('_reverse.json')) {
                  const lid = f.replace('lid-mapping-', '').replace('_reverse.json', '');
                  const phone = content.replace(/\D/g, '');
                  if (lid && phone) this.lidCache.set(lid, phone);
                } else {
                  const phone = f.replace('lid-mapping-', '').replace('.json', '').replace(/\D/g, '');
                  const lid = content.replace(/\D/g, '');
                  if (lid && phone) this.lidCache.set(lid, phone);
                }
              } catch {}
            }
          }
        }
      } catch {}
    }

    // Carrega também mapeamentos persistidos no SQLite
    try {
      const rows = databaseService.db?.prepare('SELECT lid, phone FROM lid_mappings').all() as any[];
      if (rows) {
        for (const r of rows) {
          if (r.lid && r.phone) {
            this.lidCache.set(r.lid, r.phone);
          }
        }
      }
    } catch {}

    console.log(`📱 [WhatsApp Engine] Cache de LIDs carregado com ${this.lidCache.size} mapeamentos.`);
  }

  public recordLidMapping(lid: string, phone: string): void {
    const cleanLid = lid.replace(/\D/g, '');
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanLid || !cleanPhone) return;

    this.lidCache.set(cleanLid, cleanPhone);
    this.jidToPhoneMap.set(cleanLid, cleanPhone);

    // Persiste no SQLite
    try {
      databaseService.saveLidMapping(cleanLid, cleanPhone);
    } catch {}

    const dirs = [
      this.sessionDir,
      path.join(process.env.APPDATA || '', 'condobox-desktop', 'data', 'whatsapp_session'),
      path.resolve(process.cwd(), 'data', 'whatsapp_session')
    ];

    for (const dir of dirs) {
      try {
        if (fs.existsSync(dir)) {
          const revFile = path.join(dir, `lid-mapping-${cleanLid}_reverse.json`);
          const fwdFile = path.join(dir, `lid-mapping-${cleanPhone}.json`);
          if (!fs.existsSync(revFile)) {
            fs.writeFileSync(revFile, JSON.stringify(cleanPhone), 'utf-8');
          }
          if (!fs.existsSync(fwdFile)) {
            fs.writeFileSync(fwdFile, JSON.stringify(cleanLid), 'utf-8');
          }
        }
      } catch {}
    }
  }


  public getPublicWebUrl(): string {
    if (env.WEB_APP_URL && !env.WEB_APP_URL.includes('localhost') && !env.WEB_APP_URL.includes('127.0.0.1')) {
      return env.WEB_APP_URL.replace(/\/$/, '');
    }

    try {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('172.') && !net.address.startsWith('169.254')) {
            return `http://${net.address}:3001`;
          }
        }
      }
    } catch {}

    return (env.WEB_APP_URL || 'http://localhost:3001').replace(/\/$/, '');
  }

  public getStatus(): WhatsAppStatus {
    if (this.currentStatus === 'DISCONNECTED' && !this.qrCodeBase64 && !this.isInitializing && !this.socket) {
      this.initialize().catch(() => {});
    }

    return {
      status: this.currentStatus,
      connected: this.currentStatus === 'CONNECTED',
      phone: this.connectedPhone,
      qrcode: this.qrCodeBase64
    };
  }

  public isConnected(): boolean {
    return this.currentStatus === 'CONNECTED' && this.socket !== null;
  }

  public async initialize(): Promise<void> {
    if (this.isInitializing || (this.socket && this.currentStatus === 'CONNECTED')) {
      return;
    }

    this.isInitializing = true;
    this.currentStatus = 'CONNECTING';
    this.reconnectAttempts = 0;

    try {
      // 1. Auto-recuperação (Self-Healing): se creds.json estiver corrompido, vazio ou sem chaves, limpa a sessão
      const credsFile = path.join(this.sessionDir, 'creds.json');
      if (fs.existsSync(credsFile)) {
        try {
          const raw = fs.readFileSync(credsFile, 'utf-8');
          const parsed = JSON.parse(raw);
          if (!parsed || !parsed.noiseKey || !parsed.signedIdentityKey) {
            console.warn('⚠️ [WhatsApp Engine] creds.json corrompido ou incompleto detectado. Resetando sessão para novo pareamento...');
            this.cleanSessionDir();
          }
        } catch (parseErr) {
          console.warn('⚠️ [WhatsApp Engine] Erro ao analisar creds.json (JSON inválido). Resetando sessão...');
          this.cleanSessionDir();
        }
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      if (state.creds?.me?.id && state.creds?.registered !== false) {
        const meId = state.creds.me.id;
        this.connectedPhone = meId.split(':')[0] || meId.split('@')[0];
        if (this.connectedPhone) {
          this.syncConnectedPhoneToCondo(this.connectedPhone);
        }
      } else {
        this.connectedPhone = null;
      }

      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] as [number, number, number] }));

      const sockLogger = pino({ level: 'warn' });

      const msgRetryCounterMap = new Map<string, any>();
      const msgRetryCounterCache = {
        get: <T>(key: string): T | undefined => msgRetryCounterMap.get(key) as T | undefined,
        set: <T>(key: string, value: T): void => { msgRetryCounterMap.set(key, value); },
        del: (key: string): void => { msgRetryCounterMap.delete(key); },
        flushAll: (): void => { msgRetryCounterMap.clear(); },
      };

      this.socket = makeWASocket({
        version,
        logger: sockLogger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, sockLogger),
        },
        browser: Browsers.macOS('Desktop'),
        markOnlineOnConnect: true,
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        msgRetryCounterCache,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        enableAutoSessionRecreation: true,
        getMessage: async (key) => {
          if (key?.id && this.recentSentMessagesRaw.has(key.id)) {
            return this.recentSentMessagesRaw.get(key.id);
          }
          return undefined;
        }
      });

      this.socket.ev.on('creds.update', saveCreds);

      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeBase64 = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
            this.currentStatus = 'DISCONNECTED';
            console.log('📲 [WhatsApp Engine] Novo QR Code gerado para pareamento da Portaria.');
            this.broadcastStatus();
          } catch (err: any) {
            console.error('[WhatsApp Engine] Erro ao gerar QR Code base64:', err.message);
          }
        }

        if (connection === 'close') {
          this.stopSocketWatchdog();
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.currentStatus = 'DISCONNECTED';
          this.connectedPhone = null;

          console.log(`⚠️ [WhatsApp Engine] Conexão encerrada. Motivo: ${statusCode}. Reconectar: ${shouldReconnect}`);
          this.broadcastStatus();

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('🔒 [WhatsApp Engine] Sessão deslogada pelo WhatsApp. Limpando credenciais locais e gerando novo QR Code...');
            this.cleanSessionDir();
            this.qrCodeBase64 = null;
            this.reconnectAttempts = 0;
            this.broadcastStatus();
            // Reinicia imediatamente com sessão limpa para emitir novo QR Code para pareamento
            setTimeout(() => {
              this.initialize().catch(() => {});
            }, 800);
          } else if (shouldReconnect) {
            this.scheduleReconnect();
          }
        } else if (connection === 'open') {
          this.currentStatus = 'CONNECTED';
          this.qrCodeBase64 = null;
          this.reconnectAttempts = 0;

          const userJid = this.socket?.user?.id || '';
          this.connectedPhone = userJid.split(':')[0] || userJid.split('@')[0] || 'Conectado';

          console.log(`✅ [WhatsApp Engine] Conexão ativa com sucesso! Número: ${this.connectedPhone}`);
          if (this.connectedPhone && this.connectedPhone !== 'Conectado') {
            this.syncConnectedPhoneToCondo(this.connectedPhone);
          }
          this.startSocketWatchdog();
          this.broadcastStatus();
        }
      });

      // Listener de respostas dos moradores (Confirmação de Ciência automática)
      this.socket.ev.on('messages.upsert', async (m) => {
        this.logToFile(`messages.upsert recebido: type=${m.type}, count=${m.messages?.length || 0}`);
        for (const msg of m.messages) {
          await this.handleIncomingMessage(msg);
        }
      });

      // Listener de reações dos moradores (ex: 👍 na notificação de chegada)
      this.socket.ev.on('messages.reaction', async (reactions) => {
        this.logToFile(`messages.reaction recebido: count=${reactions?.length || 0}`);
        for (const r of reactions) {
          await this.handleIncomingReaction(r);
        }
      });
    } catch (err: any) {
      console.error('❌ [WhatsApp Engine] Erro ao inicializar socket Baileys:', err.message);
      this.currentStatus = 'DISCONNECTED';
      this.scheduleReconnect();
    } finally {
      this.isInitializing = false;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('⚠️ [WhatsApp Engine] Limite de tentativas de reconexão atingido.');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(5000 * this.reconnectAttempts, 30000);
    console.log(`⏳ [WhatsApp Engine] Tentando reconectar em ${delay / 1000}s (Tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.initialize();
    }, delay);
  }

  private cleanSessionDir(): void {
    try {
      if (fs.existsSync(this.sessionDir)) {
        try {
          fs.rmSync(this.sessionDir, { recursive: true, force: true });
        } catch (rmErr: any) {
          console.warn('[WhatsApp Engine] rmSync direto falhou, limpando itens individualmente:', rmErr.message);
          const files = fs.readdirSync(this.sessionDir);
          for (const file of files) {
            try {
              const fullPath = path.join(this.sessionDir, file);
              fs.rmSync(fullPath, { recursive: true, force: true });
            } catch {}
          }
        }
      }
      if (!fs.existsSync(this.sessionDir)) {
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
      console.log('🧹 [WhatsApp Engine] Diretório de sessão limpo com sucesso.');
    } catch (err: any) {
      console.error('[WhatsApp Engine] Erro ao limpar diretório de sessão:', err.message);
    }
  }

  private startSocketWatchdog(): void {
    this.stopSocketWatchdog();
    this.watchdogInterval = setInterval(async () => {
      try {
        if (!this.socket || this.currentStatus !== 'CONNECTED') return;

        // 1. Verifica estado do WebSocket nativo
        const ws = (this.socket as any).ws;
        if (ws && typeof ws.readyState === 'number' && ws.readyState !== 1) { // 1 = OPEN
          this.logToFile(`⚠️ [Watchdog] WebSocket em estado não-aberto (${ws.readyState}). Reconectando...`);
          this.scheduleReconnect();
          return;
        }

        // 2. Ping de presença leve para evitar conexões zumbis
        try {
          await Promise.race([
            this.socket.sendPresenceUpdate('available'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Watchdog Ping Timeout')), 6000))
          ]);
        } catch (pingErr: any) {
          this.logToFile(`⚠️ [Watchdog] Socket zumbi detectado (${pingErr?.message}). Reconectando...`);
          this.scheduleReconnect();
        }
      } catch {}
    }, 25000);
  }

  private stopSocketWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  public async logout(): Promise<void> {
    this.stopSocketWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 999;
    this.isInitializing = false;

    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners('connection.update');
        this.socket.ev.removeAllListeners('creds.update');
        this.socket.ev.removeAllListeners('messages.upsert');
        this.socket.ev.removeAllListeners('messages.reaction');

        // Logout com timeout para não travar a requisição caso a conexão já esteja fechada
        await Promise.race([
          this.socket.logout().catch(() => {}),
          new Promise((r) => setTimeout(r, 1500))
        ]);

        try {
          this.socket.end(new Error('Logout manual'));
        } catch {}
      } catch (err: any) {
        console.warn('[WhatsApp Engine] Aviso ao finalizar socket:', err.message);
      }
      this.socket = null;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    this.cleanSessionDir();
    this.currentStatus = 'DISCONNECTED';
    this.connectedPhone = null;
    this.qrCodeBase64 = null;
    this.reconnectAttempts = 0;
    this.broadcastStatus();
    console.log('🔓 [WhatsApp Engine] Sessão encerrada e limpa.');

    // Reinicia imediatamente para emitir um novo QR Code pronto para pareamento
    setTimeout(() => {
      this.initialize().catch((err: any) => {
        console.error('[WhatsApp Engine] Erro ao gerar novo QR Code após logout:', err?.message);
      });
    }, 600);
  }

  private bridgeChannel: any = null;

  public setupRealtimeBridge(): void {
    if (!supabaseService.isConfigured()) return;

    try {
      const client = supabaseService.getClient();
      this.bridgeChannel = client.channel('whatsapp_bridge', {
        config: { broadcast: { self: false } }
      });

      this.bridgeChannel
        .on('broadcast', { event: 'request_status' }, () => {
          console.log('📡 [WhatsApp Bridge] Frontend solicitou status via Realtime.');
          this.broadcastStatus();
        })
        .on('broadcast', { event: 'request_connect' }, async () => {
          console.log('📡 [WhatsApp Bridge] Frontend solicitou conexão via Realtime.');
          await this.initialize().catch(() => {});
          this.broadcastStatus();
        })
        .on('broadcast', { event: 'request_logout' }, async () => {
          console.log('📡 [WhatsApp Bridge] Frontend solicitou logout via Realtime.');
          await this.logout().catch(() => {});
        })
        .on('broadcast', { event: 'send_message' }, async ({ payload }: any) => {
          console.log('📡 [WhatsApp Bridge] Solicitação de envio recebida via Realtime:', payload);
          const targetPhone = payload?.phone || payload?.number;
          const targetText = payload?.message || payload?.text;
          if (targetPhone && targetText) {
            try {
              const res = await this.sendTextMessage(targetPhone, targetText);
              console.log('✅ [WhatsApp Bridge] Mensagem enviada com sucesso:', res);
              if (payload?.logId && res.success && supabaseService.isConfigured()) {
                await supabaseService.getClient()
                  .from('notifications_log')
                  .update({
                    status: 'SENT',
                    sent_at: new Date().toISOString(),
                    external_message_id: res.messageId || 'realtime-bridge'
                  })
                  .eq('id', payload.logId);
              }
            } catch (err: any) {
              console.error('❌ [WhatsApp Bridge] Erro ao enviar mensagem via Realtime:', err?.message);
            }
          }
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ [WhatsApp Bridge] Ponte Supabase Realtime conectada.');
            this.broadcastStatus();
          }
        });
    } catch (err: any) {
      console.warn('[WhatsApp Bridge] Erro ao iniciar ponte Realtime:', err?.message);
    }
  }

  public broadcastStatus(): void {
    if (!this.bridgeChannel) return;
    try {
      const st = this.getStatus();
      this.bridgeChannel.send({
        type: 'broadcast',
        event: 'status_sync',
        payload: st
      }).catch(() => {});
    } catch {}
  }

  public syncConnectedPhoneToCondo(phone: string): void {
    const clean = phone.replace(/\D/g, '');
    if (!clean || clean.length < 8) return;
    if (supabaseService.isConfigured()) {
      const client = supabaseService.getClient();
      client
        .from('condos')
        .update({ phone: clean })
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .then(
          () => {
            console.log(`🏢 [WhatsApp Engine] Telefone da portaria sincronizado no condomínio: +${clean}`);
          },
          (err: any) => {
            console.warn('[WhatsApp Engine] Erro ao sincronizar telefone no condomínio:', err?.message);
          }
        );
    }
  }

  public async resolveJid(phone: string): Promise<string> {
    let clean = phone.replace(/\D/g, '');
    if (!clean.startsWith('55') && clean.length >= 10) {
      clean = `55${clean}`;
    }

    if (!this.socket) {
      return `${clean}@s.whatsapp.net`;
    }

    try {
      // 1. Tenta consulta direta no WhatsApp
      const check1 = await this.socket.onWhatsApp(clean);
      if (check1 && check1.length > 0 && check1[0]?.exists && check1[0]?.jid) {
        return check1[0].jid;
      }

      // 2. Para números brasileiros com 13 dígitos (55 + DDD + 9 + 8 dígitos): tenta sem o 9
      if (clean.startsWith('55') && clean.length === 13) {
        const ddd = clean.slice(2, 4);
        const withoutNine = `55${ddd}${clean.slice(5)}`;
        const check2 = await this.socket.onWhatsApp(withoutNine);
        if (check2 && check2.length > 0 && check2[0]?.exists && check2[0]?.jid) {
          return check2[0].jid;
        }
      }

      // 3. Para números brasileiros com 12 dígitos (55 + DDD + 8 dígitos): tenta com o 9
      if (clean.startsWith('55') && clean.length === 12) {
        const ddd = clean.slice(2, 4);
        const withNine = `55${ddd}9${clean.slice(4)}`;
        const check3 = await this.socket.onWhatsApp(withNine);
        if (check3 && check3.length > 0 && check3[0]?.exists && check3[0]?.jid) {
          return check3[0].jid;
        }
      }
    } catch (err: any) {
      console.warn('[WhatsApp Engine] Erro ao consultar onWhatsApp (usando fallback padrão):', err.message);
    }

    return `${clean}@s.whatsapp.net`;
  }

  public async sendTextMessage(phone: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.socket || this.currentStatus !== 'CONNECTED') {
      return { success: false, error: 'WhatsApp não está conectado no CondoBox.' };
    }

    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const jid = await this.resolveJid(phone);
      console.log(`📱 [WhatsApp Engine] Enviando mensagem de texto para JID: ${jid} (telefone: ${phone})`);
      this.jidToPhoneMap.set(jid, cleanPhone);
      this.jidToPhoneMap.set(cleanPhone, cleanPhone);

      const sent = await this.socket.sendMessage(jid, { text });
      const msgId = sent?.key?.id || 'ok';
      if (sent?.key?.id && sent.message) {
        this.recentSentMessagesRaw.set(sent.key.id, sent.message);
        if (this.recentSentMessagesRaw.size > 500) {
          const firstKey = this.recentSentMessagesRaw.keys().next().value;
          if (firstKey) this.recentSentMessagesRaw.delete(firstKey);
        }
      }
      if (sent?.key?.remoteJid) {
        this.jidToPhoneMap.set(sent.key.remoteJid, cleanPhone);
        if (sent.key.remoteJid.includes('@lid')) {
          this.recordLidMapping(sent.key.remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        }
      }
      return { success: true, messageId: msgId };
    } catch (err: any) {
      console.error('[WhatsApp Engine] Erro ao enviar mensagem de texto:', err.message);
      return { success: false, error: err.message };
    }
  }

  public async sendImageMessage(
    phone: string,
    imageSource: string | Buffer,
    caption?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.socket || this.currentStatus !== 'CONNECTED') {
      return { success: false, error: 'WhatsApp não está conectado no CondoBox.' };
    }

    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const jid = await this.resolveJid(phone);
      console.log(`🖼️ [WhatsApp Engine] Enviando imagem para JID: ${jid} (telefone: ${phone})`);
      this.jidToPhoneMap.set(jid, cleanPhone);
      this.jidToPhoneMap.set(cleanPhone, cleanPhone);

      let imageBuffer: Buffer | null = null;

      if (Buffer.isBuffer(imageSource)) {
        imageBuffer = imageSource;
      } else if (typeof imageSource === 'string') {
        const trimmed = imageSource.trim();

        // 1. Data URL (Base64 gerado pelo frontend da portaria ou fallback)
        if (trimmed.startsWith('data:')) {
          try {
            const base64Data = trimmed.split(',')[1] || trimmed;
            imageBuffer = Buffer.from(base64Data, 'base64');
            console.log(`⚡ [WhatsApp Engine] Imagem decodificada a partir de Base64 Data URL (${imageBuffer.length} bytes)`);
          } catch (e: any) {
            console.warn('[WhatsApp Engine] Falha ao decodificar Base64:', e.message);
          }
        }

        // 2. URL Remota ou Local (HTTP / HTTPS)
        if (!imageBuffer && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
          // 2.1 Verifica se a URL contém um caminho de imagem que já está no disco local
          if (trimmed.includes('/images/')) {
            try {
              const urlPath = trimmed.split('/images/')[1];
              if (urlPath) {
                const cleanRel = decodeURIComponent(urlPath.split('?')[0]);
                const localCandidates = [
                  path.resolve(ABSOLUTE_STORAGE_DIR, cleanRel),
                  path.resolve(ABSOLUTE_STORAGE_DIR, 'labels', cleanRel.replace(/^labels\//, '')),
                  path.resolve(process.cwd(), 'data', 'packages', cleanRel)
                ];
                const found = localCandidates.find(p => {
                  try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
                });
                if (found) {
                  imageBuffer = fs.readFileSync(found);
                  console.log(`⚡ [WhatsApp Engine] Imagem resolvida diretamente do disco local: ${found}`);
                }
              }
            } catch {}
          }

          // 2.2 Se não está em disco local, baixa via HTTP com validação estrita de status e content-type
          if (!imageBuffer) {
            try {
              const res = await fetch(trimmed, { signal: AbortSignal.timeout(10000) });
              if (res.ok) {
                const cType = res.headers.get('content-type') || '';
                // Evita páginas HTML de erro 404 da Vercel ou login
                if (cType.includes('image') || cType.includes('octet-stream') || !cType.includes('text/html')) {
                  const arrayBuf = await res.arrayBuffer();
                  imageBuffer = Buffer.from(arrayBuf);
                  console.log(`🌐 [WhatsApp Engine] Imagem baixada com sucesso via HTTP (${imageBuffer.length} bytes): ${trimmed}`);
                } else {
                  console.warn(`[WhatsApp Engine] URL retornou formato inesperado (${cType}): ${trimmed}`);
                }
              } else {
                console.warn(`[WhatsApp Engine] HTTP ${res.status} ao carregar imagem: ${trimmed}`);
              }
            } catch (fetchErr: any) {
              console.warn(`[WhatsApp Engine] Falha de rede ao baixar imagem (${trimmed}):`, fetchErr.message);
            }
          }
        }

        // 3. Caminho no disco local (caminho relativo ou absoluto da portaria)
        if (!imageBuffer) {
          const cleanRel = trimmed.replace(/^\/?images\//, '');
          const fileCandidates = [
            trimmed,
            path.resolve(trimmed),
            path.resolve(ABSOLUTE_STORAGE_DIR, cleanRel),
            path.resolve(ABSOLUTE_STORAGE_DIR, 'labels', cleanRel.replace(/^labels\//, '')),
            path.resolve(process.cwd(), cleanRel),
            path.resolve(process.cwd(), 'data', 'packages', cleanRel)
          ];
          const foundPath = fileCandidates.find(p => {
            try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
          });
          if (foundPath) {
            try {
              imageBuffer = fs.readFileSync(foundPath);
              console.log(`⚡ [WhatsApp Engine] Imagem lida com sucesso do arquivo local: ${foundPath}`);
            } catch (err: any) {
              console.warn(`[WhatsApp Engine] Erro ao ler imagem do disco (${foundPath}):`, err.message);
            }
          }
        }

        // 4. Fallback no Supabase Storage caso o arquivo esteja na nuvem e não em disco
        if (!imageBuffer && supabaseService.isConfigured()) {
          try {
            const cleanSub = trimmed.replace(/^\/?images\//, '').replace(/^labels\//, '');
            const { data: pubData } = supabaseService.getClient().storage.from('labels').getPublicUrl(cleanSub);
            if (pubData?.publicUrl) {
              const res = await fetch(pubData.publicUrl, { signal: AbortSignal.timeout(8000) });
              if (res.ok) {
                imageBuffer = Buffer.from(await res.arrayBuffer());
                console.log(`☁️ [WhatsApp Engine] Imagem recuperada do Supabase Storage: ${pubData.publicUrl}`);
              }
            }
          } catch (supErr: any) {
            console.warn('[WhatsApp Engine] Falha no fallback Supabase Storage:', supErr.message);
          }
        }
      }

      if (!imageBuffer || imageBuffer.length === 0) {
        console.warn(`⚠️ [WhatsApp Engine] Foto da etiqueta inacessível para ${phone} (origem: ${typeof imageSource === 'string' ? imageSource.slice(0, 100) : 'Buffer'}). Enviando fallback de texto.`);
        if (caption) return this.sendTextMessage(phone, caption);
        return { success: false, error: 'Imagem não pôde ser carregada' };
      }

      const sent = await this.socket.sendMessage(jid, {
        image: imageBuffer,
        caption: caption || '',
        mimetype: 'image/jpeg'
      });

      const msgId = sent?.key?.id || 'ok';
      if (sent?.key?.id && sent.message) {
        this.recentSentMessagesRaw.set(sent.key.id, sent.message);
        if (this.recentSentMessagesRaw.size > 500) {
          const firstKey = this.recentSentMessagesRaw.keys().next().value;
          if (firstKey) this.recentSentMessagesRaw.delete(firstKey);
        }
      }
      if (sent?.key?.remoteJid) {
        this.jidToPhoneMap.set(sent.key.remoteJid, cleanPhone);
        if (sent.key.remoteJid.includes('@lid')) {
          this.recordLidMapping(sent.key.remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        }
      }

      return { success: true, messageId: msgId };
    } catch (err: any) {
      console.warn('[WhatsApp Engine] Falha no envio de imagem para ' + phone + ', enviando apenas texto:', err.message);
      if (caption) {
        return this.sendTextMessage(phone, caption);
      }
      return { success: false, error: err.message };
    }
  }

  public async notifyPackageArrival(params: {
    phone: string;
    residentName: string;
    unitInfo: string;
    carrier: string;
    pickupCode: string;
    qrToken?: string;
    labelImageUrl?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const webBaseUrl = this.getPublicWebUrl();
    const token = params.qrToken || params.pickupCode;
    const pickupUrl = `${webBaseUrl}/p/${token}`;

    let adFooter = '';
    try {
      const { licenseService } = await import('./license.service.js');
      const { adsService } = await import('./ads.service.js');
      const sub = await licenseService.getSubscription();

      if (sub.plan?.has_ads || sub.plan_id === 'BASIC') {
        const ad = await adsService.getActiveAd();
        if (ad && ad.whatsapp_footer_text) {
          adFooter = `\n\n───────────────\n${ad.whatsapp_footer_text}`;
        }
      }
    } catch {}

    const text =
      `📦 *NOVA ENCOMENDA CHEGOU NA PORTARIA!*\n\n` +
      `Olá, *${params.residentName}*! 👋\n\n` +
      `Uma encomenda da *${params.carrier}* acabou de ser recebida na portaria para sua unidade (*${params.unitInfo}*).\n\n` +
      `📸 *Foto da etiqueta anexada acima.*\n\n` +
      `💬 *Por favor, responda esta mensagem informando quem irá retirar:*\n` +
      `• *Se for você mesmo:* responda *"Eu mesmo"* ou *"OK"*.\n` +
      `• *Se for algum terceiro retirar (familiar, amigo, vizinho ou prestador):* informe quem vai buscar (ex: *"Quem vai buscar é minha esposa Maria"* ou *"Pode entregar para o Carlos"*).\n\n` +
      `Assim que você responder, seu Código e QR Code de Retirada serão liberados automaticamente! 🔑\n\n` +
      `🏢 Portaria do Condomínio${adFooter}`;

    // Simulação humanizada de digitação ("digitando...")
    try {
      if (this.socket && this.currentStatus === 'CONNECTED') {
        const jid = await this.resolveJid(params.phone);
        await this.socket.sendPresenceUpdate('composing', jid);
        const typingDelay = Math.floor(Math.random() * 1200) + 2000; // 2.0s a 3.2s
        await new Promise(r => setTimeout(r, typingDelay));
        await this.socket.sendPresenceUpdate('paused', jid);
      }
    } catch {}

    let res: { success: boolean; messageId?: string; error?: string };
    if (params.labelImageUrl) {
      res = await this.sendImageMessage(params.phone, params.labelImageUrl, text);
    } else {
      res = await this.sendTextMessage(params.phone, text);
    }

    if (res.success && res.messageId) {
      const notifData = {
        phone: params.phone,
        residentName: params.residentName,
        carrier: params.carrier,
        pickupCode: params.pickupCode,
        qrToken: params.qrToken,
        timestamp: Date.now()
      };
      this.recentSentNotifications.set(res.messageId, notifData);

      // Armazena em todas as variações de número de telefone (com/sem 55, com/sem 9)
      const phoneVariations = new Set<string>();
      const rawDigits = params.phone.replace(/\D/g, '');
      if (rawDigits) {
        phoneVariations.add(rawDigits);
        if (rawDigits.startsWith('55')) {
          const without55 = rawDigits.slice(2);
          phoneVariations.add(without55);
          if (without55.length === 11 && without55[2] === '9') {
            phoneVariations.add(`55${without55.slice(0, 2)}${without55.slice(3)}`);
            phoneVariations.add(`${without55.slice(0, 2)}${without55.slice(3)}`);
          } else if (without55.length === 10) {
            phoneVariations.add(`55${without55.slice(0, 2)}9${without55.slice(2)}`);
            phoneVariations.add(`${without55.slice(0, 2)}9${without55.slice(2)}`);
          }
        } else {
          phoneVariations.add(`55${rawDigits}`);
          if (rawDigits.length === 11 && rawDigits[2] === '9') {
            phoneVariations.add(`55${rawDigits.slice(0, 2)}${rawDigits.slice(3)}`);
            phoneVariations.add(`${rawDigits.slice(0, 2)}${rawDigits.slice(3)}`);
          } else if (rawDigits.length === 10) {
            phoneVariations.add(`55${rawDigits.slice(0, 2)}9${rawDigits.slice(2)}`);
            phoneVariations.add(`${rawDigits.slice(0, 2)}9${rawDigits.slice(2)}`);
          }
        }
      }

      for (const pVar of phoneVariations) {
        this.recentNotificationByPhone.set(pVar, notifData);
        // Vincula também o JID de LID conhecido para este morador
        for (const [lid, ph] of this.lidCache.entries()) {
          if (phoneVariations.has(ph)) {
            this.recentNotificationByJid.set(`${lid}@lid`, notifData);
          }
        }
      }

      let targetJid: string | null = null;
      try {
        targetJid = await this.resolveJid(params.phone);
        this.recentNotificationByJid.set(targetJid, notifData);
      } catch {}

      // Persiste no banco de dados SQLite para sobreviver a qualquer reinicialização
      if (res.messageId) {
        try {
          databaseService.saveSentNotification({
            msgId: res.messageId,
            phone: params.phone,
            remoteJid: targetJid || undefined,
            residentName: params.residentName,
            carrier: params.carrier,
            pickupCode: params.pickupCode,
            qrToken: params.qrToken,
            createdAt: notifData.timestamp
          });
        } catch {}
      }

      if (this.recentSentNotifications.size > 500) {
        const first = this.recentSentNotifications.keys().next().value;
        if (first) this.recentSentNotifications.delete(first);
      }
    }

    return res;
  }

  public async notifyPackageDelivered(params: {
    phone: string;
    residentName: string;
    deliveredTo: string;
    unitInfo: string;
    carrier: string;
    deliveredAt: string;
    pickupCode?: string;
    qrToken?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const text =
      `✅ *ENCOMENDA RETIRADA COM SUCESSO*\n\n` +
      `Olá, *${params.residentName}*!\n\n` +
      `A encomenda (*${params.carrier}*) da unidade *${params.unitInfo}* foi retirada na portaria.\n\n` +
      `👤 *Retirado por:* ${params.deliveredTo}\n` +
      `🕒 *Data/Hora:* ${params.deliveredAt}\n` +
      `✍️ *Assinatura digital arquivada no sistema da portaria.*\n\n` +
      `⚠️ *Não foi você quem retirou?*\n` +
      `Se você não recebeu esta encomenda, você pode clicar no link enviado na mensagem anterior para contestar e entrar em contato com a portaria.\n\n` +
      `🏢 Portaria do Condomínio`;

    // Simulação humanizada de digitação ("digitando...")
    try {
      if (this.socket && this.currentStatus === 'CONNECTED') {
        const jid = await this.resolveJid(params.phone);
        await this.socket.sendPresenceUpdate('composing', jid);
        const typingDelay = Math.floor(Math.random() * 800) + 1500; // 1.5s a 2.3s
        await new Promise(r => setTimeout(r, typingDelay));
        await this.socket.sendPresenceUpdate('paused', jid);
      }
    } catch {}

    return this.sendTextMessage(params.phone, text);
  }

  public async notifyMultiplePackagesDelivered(params: {
    phone: string;
    residentName: string;
    deliveredTo: string;
    unitInfo: string;
    packages: Array<{
      carrier: string;
      pickupCode?: string;
      deliveredAt: string;
    }>;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const totalCount = params.packages.length;
    let packagesListText = '';

    params.packages.forEach((pkg, idx) => {
      const codeStr = pkg.pickupCode ? ` _(Cód: ${pkg.pickupCode})_` : '';
      packagesListText += `📦 *${idx + 1}. ${pkg.carrier || 'Encomenda'}*${codeStr}\n`;
    });

    const text =
      `✅ *RETIRADA DE ENCOMENDAS CONFIRMADA*\n\n` +
      `Olá, *${params.residentName}*!\n\n` +
      `Confirmamos a retirada de suas *${totalCount} encomendas* da unidade *${params.unitInfo}* na portaria:\n\n` +
      `${packagesListText}\n` +
      `👤 *Retirado por:* ${params.deliveredTo}\n` +
      `🕒 *Data/Hora:* ${params.packages[params.packages.length - 1]?.deliveredAt || new Date().toLocaleString('pt-BR')}\n` +
      `✍️ *Assinaturas digitais arquivadas com segurança no sistema da portaria.*\n\n` +
      `⚠️ *Não foi você quem retirou?*\n` +
      `Se você não retirou estas encomendas, entre em contato imediatamente com a portaria do condomínio.\n\n` +
      `🏢 Portaria do Condomínio`;

    // Simulação humanizada de digitação
    try {
      if (this.socket && this.currentStatus === 'CONNECTED') {
        const jid = await this.resolveJid(params.phone);
        await this.socket.sendPresenceUpdate('composing', jid);
        const typingDelay = Math.floor(Math.random() * 1000) + 1800; // 1.8s a 2.8s
        await new Promise(r => setTimeout(r, typingDelay));
        await this.socket.sendPresenceUpdate('paused', jid);
      }
    } catch {}

    return this.sendTextMessage(params.phone, text);
  }

  public async notifyPackageReminder(params: {
    phone: string;
    residentName: string;
    unitInfo: string;
    carrier: string;
    pickupCode: string;
    receivedAt: string;
    qrToken?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const webBaseUrl = this.getPublicWebUrl();
    const token = params.qrToken || params.pickupCode;
    const pickupUrl = `${webBaseUrl}/p/${token}`;

    const text =
      `⏰ *LEMBRETE: ENCOMENDA AGUARDANDO RETIRADA*\n\n` +
      `Olá, *${params.residentName}*! 👋\n\n` +
      `Sua encomenda de *${params.carrier}* (recebida em ${params.receivedAt}) continua disponível para retirada na portaria para *${params.unitInfo}*.\n\n` +
      `💬 *Para liberarmos o código e o link de retirada, por favor, responda a esta mensagem informando:*\n` +
      `1️⃣ Você já está ciente da chegada do pacote?\n` +
      `2️⃣ Quem irá retirar? (Você mesmo ou um terceiro autorizado? Caso seja um terceiro, favor informar o nome completo).\n\n` +
      `Assim que responder, enviaremos os dados de acesso para a retirada. 🔑\n\n` +
      `🏢 Portaria do Condomínio`;

    return this.sendTextMessage(params.phone, text);
  }

  private logToFile(logMessage: string): void {
    try {
      const logPath = path.join(this.sessionDir, '..', 'whatsapp_flow.log');
      const time = new Date().toISOString();
      fs.appendFileSync(logPath, `[${time}] ${logMessage}\n`);
      console.log(`[WhatsApp Engine] ${logMessage}`);
    } catch {}
  }

  private resolvePhoneFromRemoteJid(remoteJid: string, remoteJidAlt?: string): string {
    // 0. Se o Baileys forneceu remoteJidAlt (ex: 557381953741@s.whatsapp.net), usa imediatamente
    if (remoteJidAlt) {
      const altPhone = remoteJidAlt.replace(/@s\.whatsapp\.net|@c\.us|@lid|\D/g, '');
      if (altPhone && altPhone.length >= 10) {
        if (remoteJid.includes('@lid')) {
          const cleanLid = remoteJid.replace(/@lid|\D/g, '');
          this.lidCache.set(cleanLid, altPhone);
          this.recordLidMapping(cleanLid, altPhone);
          this.logToFile(`🎯 LID ${cleanLid} resolvido instantaneamente via remoteJidAlt: ${altPhone}`);
        }
        return altPhone;
      }
    }

    if (remoteJid.includes('@lid')) {
      const cleanLid = remoteJid.replace(/@lid|\D/g, '');

      // 1. Resposta instantânea da memória (0.001ms)
      if (this.lidCache.has(cleanLid)) {
        return this.lidCache.get(cleanLid)!;
      }
      if (this.jidToPhoneMap.has(remoteJid)) {
        const phone = this.jidToPhoneMap.get(remoteJid)!;
        this.lidCache.set(cleanLid, phone);
        return phone;
      }
      if (this.jidToPhoneMap.has(cleanLid)) {
        const phone = this.jidToPhoneMap.get(cleanLid)!;
        this.lidCache.set(cleanLid, phone);
        return phone;
      }

      // 2. Consulta ao banco de dados SQLite persistente (sobrevive a restarts)
      try {
        const dbPhone = databaseService.getPhoneForLid(cleanLid);
        if (dbPhone) {
          this.lidCache.set(cleanLid, dbPhone);
          this.logToFile(`🎯 LID ${cleanLid} resolvido para telefone: ${dbPhone} via SQLite lid_mappings`);
          return dbPhone;
        }
      } catch {}

      // 3. Consulta ao signalRepository interno do Baileys
      try {
        const pn = (this.socket as any)?.signalRepository?.lidMapping?.getPNForLID?.(remoteJid);
        if (pn) {
          const cleanPn = String(pn).replace(/@s\.whatsapp\.net|@c\.us|@lid|\D/g, '');
          if (cleanPn && cleanPn.length >= 10) {
            this.lidCache.set(cleanLid, cleanPn);
            this.recordLidMapping(cleanLid, cleanPn);
            this.logToFile(`🎯 LID ${cleanLid} resolvido para telefone: ${cleanPn} via signalRepository`);
            return cleanPn;
          }
        }
      } catch {}

      // 4. Leitura direta O(1) do arquivo reverso sem varredura pesada de diretório
      const dirs = [
        this.sessionDir,
        path.join(process.env.APPDATA || '', 'condobox-desktop', 'data', 'whatsapp_session'),
        path.resolve(process.cwd(), 'data', 'whatsapp_session')
      ];

      for (const dir of dirs) {
        try {
          const revFile = path.join(dir, `lid-mapping-${cleanLid}_reverse.json`);
          if (fs.existsSync(revFile)) {
            const content = fs.readFileSync(revFile, 'utf-8').trim().replace(/\D/g, '');
            if (content) {
              this.lidCache.set(cleanLid, content);
              this.recordLidMapping(cleanLid, content);
              this.logToFile(`🎯 LID ${cleanLid} resolvido para telefone: ${content} via disco`);
              return content;
            }
          }
        } catch {}
      }

      // 5. Verificação direta nos arquivos Baileys: se algum telefone recente mapeia para este cleanLid
      const candidatePhones = new Set<string>();
      for (const notif of this.recentNotificationByPhone.values()) {
        if (notif.phone) candidatePhones.add(notif.phone.replace(/\D/g, ''));
      }
      for (const notif of this.recentSentNotifications.values()) {
        if (notif.phone) candidatePhones.add(notif.phone.replace(/\D/g, ''));
      }

      for (const phone of candidatePhones) {
        for (const dir of dirs) {
          try {
            const f = path.join(dir, `lid-mapping-${phone}.json`);
            if (fs.existsSync(f)) {
              const lidVal = fs.readFileSync(f, 'utf-8').trim().replace(/\D/g, '');
              if (lidVal === cleanLid) {
                this.lidCache.set(cleanLid, phone);
                this.recordLidMapping(cleanLid, phone);
                this.logToFile(`🎯 LID ${cleanLid} resolvido para telefone: ${phone} via lid-mapping direto`);
                return phone;
              }
            }
          } catch {}
        }
      }

      // 6. Fallback via notificação recente enviada por JID no SQLite
      try {
        const notif = databaseService.getLatestSentNotificationForJid(remoteJid);
        if (notif?.phone) {
          const phone = notif.phone.replace(/\D/g, '');
          this.lidCache.set(cleanLid, phone);
          this.recordLidMapping(cleanLid, phone);
          this.logToFile(`🎯 LID ${cleanLid} resolvido para telefone: ${phone} via SQLite whatsapp_sent_notifications (JID)`);
          return phone;
        }
      } catch {}

      // 7. Fallback via notificação recente enviada por JID em memória
      if (this.recentNotificationByJid.has(remoteJid)) {
        const notif = this.recentNotificationByJid.get(remoteJid)!;
        const phone = notif.phone.replace(/\D/g, '');
        this.lidCache.set(cleanLid, phone);
        this.recordLidMapping(cleanLid, phone);
        this.logToFile(`🎯 LID ${cleanLid} resolvido para telefone: ${phone} via notificação recente em memória`);
        return phone;
      }
    }

    return remoteJid.replace(/@s\.whatsapp\.net|@c\.us|@lid|\D/g, '');
  }

  private extractTextFromMessage(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return '';
    if ((m as any).audioMessage) {
      return '';
    }
    return (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.reactionMessage?.text ||
      m.ephemeralMessage?.message?.conversation ||
      m.ephemeralMessage?.message?.extendedTextMessage?.text ||
      m.ephemeralMessage?.message?.reactionMessage?.text ||
      m.viewOnceMessage?.message?.conversation ||
      m.viewOnceMessage?.message?.extendedTextMessage?.text ||
      m.viewOnceMessageV2?.message?.conversation ||
      m.viewOnceMessageV2?.message?.extendedTextMessage?.text ||
      (m as any).viewOnceMessageV2Extension?.message?.conversation ||
      (m as any).viewOnceMessageV2Extension?.message?.extendedTextMessage?.text ||
      (m as any).interactiveMessage?.body?.text ||
      (m as any).interactiveMessage?.header?.title ||
      (m as any).editedMessage?.message?.protocolMessage?.editedMessage?.conversation ||
      (m as any).editedMessage?.message?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
      (m as any).protocolMessage?.editedMessage?.conversation ||
      (m as any).protocolMessage?.editedMessage?.extendedTextMessage?.text ||
      (m as any).interactiveResponseMessage?.body?.text ||
      (m as any).interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
      (m as any).documentWithCaptionMessage?.message?.documentMessage?.caption ||
      m.imageMessage?.caption ||
      m.documentMessage?.caption ||
      m.videoMessage?.caption ||
      m.buttonsResponseMessage?.selectedDisplayText ||
      m.buttonsResponseMessage?.selectedButtonId ||
      m.templateButtonReplyMessage?.selectedId ||
      m.listResponseMessage?.title ||
      m.listResponseMessage?.singleSelectReply?.selectedRowId ||
      ''
    );
  }

  private extractQuotedInfoFromMessage(msg: WAMessage): { quotedText: string; quotedMsgId?: string } {
    const contextInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      (msg.message as any)?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo ||
      (msg.message as any)?.interactiveMessage?.contextInfo ||
      (msg.message as any)?.buttonsResponseMessage?.contextInfo;

    const quotedMsgId = contextInfo?.stanzaId;
    const qm = contextInfo?.quotedMessage;
    if (!qm) return { quotedText: '', quotedMsgId };

    const quotedText = (
      qm.conversation ||
      qm.extendedTextMessage?.text ||
      qm.imageMessage?.caption ||
      qm.videoMessage?.caption ||
      ''
    );

    return { quotedText, quotedMsgId };
  }

  private async sendWhatsAppReply(remoteJid: string, cleanPhone: string, replyText: string): Promise<void> {
    try {
      if (this.socket) {
        await this.socket.sendPresenceUpdate('composing', remoteJid);
      }
    } catch {}

    await new Promise(resolve => setTimeout(resolve, 1800));

    try {
      if (this.socket) {
        await this.socket.sendPresenceUpdate('paused', remoteJid);
      }
    } catch {}

    try {
      if (this.socket) {
        this.logToFile(`Enviando resposta diretamente para conversa ativa: ${remoteJid}...`);
        const sent = await this.socket.sendMessage(remoteJid, { text: replyText });
        if (sent?.key?.id && sent.message) {
          this.recentSentMessagesRaw.set(sent.key.id, sent.message);
        }
      } else {
        await this.sendTextMessage(cleanPhone, replyText);
      }
    } catch (sendErr: any) {
      this.logToFile(`Fallback para sendTextMessage(${cleanPhone})...`);
      await this.sendTextMessage(cleanPhone, replyText);
    }
  }

  private async handleIncomingReaction(reactionUpdate: any): Promise<void> {
    try {
      this.logToFile(`🔍 [DEBUG Reaction] Payload recebido: ${JSON.stringify(reactionUpdate)}`);

      // 1. Extração robusta do JID da conversa
      const remoteJid =
        reactionUpdate.reaction?.key?.remoteJid ||
        reactionUpdate.key?.remoteJid ||
        reactionUpdate.remoteJid ||
        '';

      if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.includes('@g.us') || remoteJid.includes('@newsletter')) {
        return;
      }

      // 2. Extração do Emoji da reação
      const emoji = (
        reactionUpdate.reaction?.text ||
        reactionUpdate.text ||
        reactionUpdate.reaction?.emoji ||
        reactionUpdate.emoji ||
        ''
      ).trim();

      if (!emoji) {
        this.logToFile(`ℹ️ Reação vazia ou desfeita em ${remoteJid}`);
        return;
      }

      // 3. Extração correta do ID da mensagem original curtida (notificação)
      // reactionUpdate.key é o WAMessageKey da mensagem ALVO curtida!
      // reactionUpdate.reaction.key é a chave do próprio evento de reação!
      const targetMsgId = reactionUpdate.key?.id || reactionUpdate.reaction?.key?.id;
      this.logToFile(`👍 Reação recebida em ${remoteJid} (Msg: ${targetMsgId}): "${emoji}"`);

      // 4. Se a reação for contestação vs afirmação
      const isContest = ['👎', '❌', '🚫', '😡', '😠'].some(e => emoji.includes(e));
      const simulatedText = isContest ? 'Não reconheço essa encomenda ❌' : 'Ciente, obrigado 👍';

      const remoteJidAlt =
        (reactionUpdate.reaction?.key as any)?.remoteJidAlt ||
        (reactionUpdate.key as any)?.remoteJidAlt ||
        (reactionUpdate.reaction?.key as any)?.participantAlt ||
        (reactionUpdate.key as any)?.participantAlt ||
        '';

      await this.processIncomingContent({
        remoteJid,
        remoteJidAlt,
        text: simulatedText,
        quotedMsgId: targetMsgId,
        isReaction: true
      });
    } catch (err: any) {
      this.logToFile(`❌ Erro ao processar reação: ${err.message}`);
    }
  }

  private unwrapWAMessage(msg: WAMessage): WAMessage {
    if (!msg.message) return msg;
    let m: any = msg.message;
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
    return {
      ...msg,
      message: m,
    };
  }

  private getAudioMessageFromWAMessage(msg: WAMessage): any | null {
    const unwrapped = this.unwrapWAMessage(msg);
    const m = unwrapped.message;
    if (!m) return null;
    if (m.audioMessage) return m.audioMessage;
    if (m.documentMessage?.mimetype?.startsWith('audio/')) return m.documentMessage;
    return null;
  }

  private async transcribeAudioMessage(msg: WAMessage): Promise<string> {
    try {
      const unwrappedMsg = this.unwrapWAMessage(msg);
      const audioMsg = this.getAudioMessageFromWAMessage(unwrappedMsg);
      if (!audioMsg) {
        this.logToFile('⚠️ Nenhum payload de áudio detectado na mensagem.');
        return '';
      }

      this.logToFile('📥 Baixando arquivo de áudio com Baileys...');
      const buffer = await downloadMediaMessage(
        unwrappedMsg,
        'buffer',
        {},
        {
          logger: pino({ level: 'silent' }),
          reuploadRequest: (update: any) => {
            if (!this.socket) return Promise.reject(new Error('Socket unavailable'));
            return this.socket.updateMediaMessage(update);
          },
        }
      );

      if (!buffer || buffer.length === 0) {
        this.logToFile('⚠️ Buffer de áudio vazio retornado pelo Baileys.');
        return '';
      }

      this.logToFile(`🔊 Áudio recebido (${buffer.length} bytes). Transcrevendo com IA...`);

      const audioMime = audioMsg.mimetype || 'audio/ogg; codecs=opus';
      const cleanMime = audioMime.split(';')[0].trim() || 'audio/ogg';

      // 1. Provedor Primário: Groq Whisper Large V3 Turbo (ultrarrápido, ~200ms, alta precisão em português)
      const groqKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY;
      if (groqKey) {
        try {
          const blob = new Blob([buffer], { type: cleanMime });
          const formData = new FormData();
          formData.append('file', blob, 'audio.ogg');
          formData.append('model', 'whisper-large-v3-turbo');
          formData.append('language', 'pt');
          formData.append('response_format', 'json');
          formData.append('temperature', '0.0');
          formData.append(
            'prompt',
            'Áudio de WhatsApp de morador de condomínio sobre encomenda, código de retirada, ciência de pacote, eu mesmo vou buscar ou autorizando terceiro (esposa, marido, filho, etc.).'
          );

          const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${groqKey}`,
            },
            body: formData,
          });

          if (res.ok) {
            const data: any = await res.json();
            const transcribed = (data.text || '').trim();
            if (transcribed) {
              this.logToFile(`🎙️ [Áudio Transcrito via Groq Whisper]: "${transcribed}"`);
              return transcribed;
            }
          } else {
            const errText = await res.text().catch(() => '');
            this.logToFile(`⚠️ Groq Whisper status ${res.status}: ${errText}`);
          }
        } catch (groqErr: any) {
          this.logToFile(`⚠️ Falha na chamada do Groq Whisper: ${groqErr.message}`);
        }
      }

      // 2. Provedor Fallback: Google Gemini Flash Multimodal
      const geminiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (geminiKey) {
        const geminiModels = ['gemini-3.5-flash-lite', 'gemini-3.6-flash'];
        const base64Data = buffer.toString('base64');

        for (const mName of geminiModels) {
          try {
            const genAI = new GoogleGenerativeAI(geminiKey);
            const model = genAI.getGenerativeModel({ model: mName });

            const result = await model.generateContent([
              {
                inlineData: {
                  mimeType: cleanMime,
                  data: base64Data,
                },
              },
              {
                text: 'Transcreva este áudio em português com máxima fidelidade. Retorne APENAS o texto falado, sem aspas, introduções ou explicações. Se inaudível ou silêncio, retorne vazio.',
              },
            ]);

            const transcribed = result.response.text().trim();
            if (transcribed) {
              this.logToFile(`🎙️ [Áudio Transcrito via Gemini Flash (${mName})]: "${transcribed}"`);
              return transcribed;
            }
          } catch (geminiErr: any) {
            this.logToFile(`⚠️ Falha na chamada do Gemini Flash (${mName}) para áudio: ${geminiErr.message}`);
          }
        }
      }

      this.logToFile('⚠️ Não foi possível transcrever o áudio por nenhum dos provedores disponíveis.');
      return '';
    } catch (err: any) {
      this.logToFile(`❌ Falha geral ao transcrever áudio: ${err.message}`);
      return '';
    }
  }

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    try {
      if (msg.key.fromMe) return;
      const remoteJid = msg.key.remoteJid || '';
      if (
        !remoteJid ||
        remoteJid === 'status@broadcast' ||
        remoteJid.includes('@g.us') ||
        remoteJid.includes('@newsletter') ||
        remoteJid.includes('@broadcast')
      ) return;

      const remoteJidAlt = (msg.key as any).remoteJidAlt || (msg.key as any).participantAlt || '';
      if (remoteJid.includes('@lid') && remoteJidAlt) {
        const altPhone = remoteJidAlt.replace(/@s\.whatsapp\.net|@c\.us|@lid|\D/g, '');
        if (altPhone && altPhone.length >= 10) {
          this.recordLidMapping(remoteJid, altPhone);
        }
      }

      if ((msg as any).messageStubType) {
        this.logToFile(`ℹ️ Mensagem com stubType=${(msg as any).messageStubType} de ${remoteJid} (alt: ${remoteJidAlt})`);
      }

      this.logToFile(`📩 Mensagem recebida via socket de ${remoteJid}${remoteJidAlt ? ` (alt: ${remoteJidAlt})` : ''} (fromMe: ${msg.key.fromMe}, id: ${msg.key.id})`);

      // Ignora mensagens históricas muito antigas (> 12 horas) recebidas em sincronizações iniciais
      const rawTs = typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp
        : (msg.messageTimestamp?.low ? msg.messageTimestamp.low : null);
      if (rawTs) {
        const msgAgeMs = Date.now() - (rawTs * 1000);
        if (msgAgeMs > 12 * 60 * 60 * 1000) {
          return;
        }
      }

      // Deduplicação: ignora se a mesma mensagem já foi processada
      const msgId = msg.key.id;
      if (msgId) {
        if (this.processedMessageIds.has(msgId)) return;
        this.processedMessageIds.add(msgId);
        if (this.processedMessageIds.size > 200) {
          const first = this.processedMessageIds.values().next().value;
          if (first) this.processedMessageIds.delete(first);
        }
      }

      // 1. Detecção direta de Reação (ReactionMessage) recebida via messages.upsert
      const reactionMsg =
        msg.message?.reactionMessage ||
        (msg.message as any)?.ephemeralMessage?.message?.reactionMessage;

      if (reactionMsg) {
        const emoji = (reactionMsg.text || '').trim();
        const targetMsgId = reactionMsg.key?.id;
        this.logToFile(`👍 [ReactionMessage via Upsert] de ${remoteJid} (Alvo: ${targetMsgId}): "${emoji}"`);
        if (!emoji) {
          this.logToFile(`ℹ️ Reação removida por ${remoteJid}`);
          return;
        }
        const isContest = ['👎', '❌', '🚫', '😡', '😠'].some(e => emoji.includes(e));
        const simulatedText = isContest ? 'Não reconheço essa encomenda ❌' : 'Ciente, obrigado 👍';
        await this.processIncomingContent({
          remoteJid,
          remoteJidAlt,
          text: simulatedText,
          quotedMsgId: targetMsgId,
          isReaction: true
        });
        return;
      }

      let text = this.extractTextFromMessage(msg).trim();
      const audioMsg = this.getAudioMessageFromWAMessage(msg);

      let isFromAudio = false;
      // Se for mensagem de áudio, transcreve com IA para entender a fala do morador
      if (audioMsg && !text) {
        this.logToFile(`🎤 Mensagem de voz/áudio recebida de ${remoteJid}. Iniciando transcrição inteligente...`);
        const transcribed = await this.transcribeAudioMessage(msg);
        if (transcribed) {
          text = transcribed.trim();
          isFromAudio = true;
          this.logToFile(`🧠 [Áudio Compreendido]: Morador disse: "${text}"`);
        } else {
          this.logToFile(`ℹ️ [Áudio Inaudível] Áudio de ${remoteJid} sem voz compreensível.`);
          const cleanP = this.resolvePhoneFromRemoteJid(remoteJid, remoteJidAlt);
          const hasRecentNotif = this.recentNotificationByJid.has(remoteJid) || this.recentNotificationByPhone.has(cleanP);
          if (hasRecentNotif) {
            const promptText =
              `Olá, Morador(a)! 👋\n\n` +
              `Recebemos seu áudio, porém o som ficou um pouco baixo ou inaudível.\n\n` +
              `💬 *Para liberarmos seu Código e QR Code na hora, por favor:*\n` +
              `• Se for você mesmo retirar: responda *"Eu mesmo"* ou *"OK"* (ou reaja com 👍 nesta mensagem).\n` +
              `• Se for outra pessoa retirar: informe o nome dela (ex: *"Minha esposa Maria"*).\n\n` +
              `Assim que você responder, liberamos seus dados de retirada imediatamente! 🔑\n\n` +
              `🏢 Portaria do Condomínio`;
            await this.sendWhatsAppReply(remoteJid, cleanP, promptText);
            this.logToFile(`💬 Enviada orientação de áudio inaudível para ${cleanP}.`);
          }
          return;
        }
      }

      this.logToFile(`📝 Texto processado de ${remoteJid} (de áudio: ${isFromAudio}): "${text}"`);
      if (!text) {
        const msgKeys = Object.keys(msg.message || {}).join(', ');
        if (msgKeys) {
          this.logToFile(`ℹ️ Mensagem recebida de ${remoteJid} sem texto extraível direto. Proto types: [${msgKeys}]`);
        }
        return;
      }

      const { quotedText, quotedMsgId } = this.extractQuotedInfoFromMessage(msg);

      await this.processIncomingContent({
        remoteJid,
        remoteJidAlt,
        text,
        quotedText,
        quotedMsgId,
        isFromAudio,
      });
    } catch (err: any) {
      this.logToFile(`❌ Erro ao tratar mensagem recebida: ${err.message}`);
    }
  }

  private async processIncomingContent(params: {
    remoteJid: string;
    remoteJidAlt?: string;
    text: string;
    quotedText?: string;
    quotedMsgId?: string;
    isReaction?: boolean;
    isFromAudio?: boolean;
  }): Promise<void> {
    const { remoteJid, remoteJidAlt, text, quotedText = '', quotedMsgId, isReaction, isFromAudio } = params;

    let cleanPhone = this.resolvePhoneFromRemoteJid(remoteJid, remoteJidAlt);
    this.logToFile(`📩 Mensagem recebida de ${remoteJid} (Telefone: ${cleanPhone}, Áudio: ${Boolean(isFromAudio)}): "${text}"`);

    // 1. Resolução inteligente de identidade via notificação citada / recente
    let targetNotif: { phone: string; residentName: string; carrier: string; pickupCode: string; qrToken?: string; timestamp: number } | null = null;

    if (quotedMsgId && this.recentSentNotifications.has(quotedMsgId)) {
      const found = this.recentSentNotifications.get(quotedMsgId);
      if (found) {
        targetNotif = found;
        cleanPhone = found.phone;
        if (remoteJid.includes('@lid')) {
          this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        }
        this.logToFile(`🎯 Morador identificado via histórico da mensagem citada em memória (${quotedMsgId}): ${found.residentName} (${cleanPhone})`);
      }
    } else if (quotedMsgId) {
      const dbNotif = databaseService.getSentNotificationByMsgId(quotedMsgId);
      if (dbNotif) {
        targetNotif = dbNotif;
        cleanPhone = dbNotif.phone;
        if (remoteJid.includes('@lid')) {
          this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        }
        this.logToFile(`🎯 Morador identificado via histórico da mensagem citada no SQLite (${quotedMsgId}): ${dbNotif.residentName} (${cleanPhone})`);
      }
    }

    if (!targetNotif && this.recentNotificationByJid.has(remoteJid)) {
      const found = this.recentNotificationByJid.get(remoteJid);
      if (found) {
        targetNotif = found;
        cleanPhone = found.phone ? found.phone.replace(/\D/g, '') : cleanPhone;
        if (remoteJid.includes('@lid')) {
          this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        }
        this.logToFile(`🎯 Morador identificado via notificação enviada para JID em memória (${remoteJid}): ${found.residentName} (${cleanPhone})`);
      }
    }

    if (!targetNotif) {
      const dbJidNotif = databaseService.getLatestSentNotificationForJid(remoteJid);
      if (dbJidNotif) {
        targetNotif = dbJidNotif;
        cleanPhone = dbJidNotif.phone.replace(/\D/g, '');
        if (remoteJid.includes('@lid')) {
          this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        }
        this.logToFile(`🎯 Morador identificado via última notificação para JID no SQLite (${remoteJid}): ${dbJidNotif.residentName} (${cleanPhone})`);
      }
    }

    if (!targetNotif && this.recentNotificationByPhone.has(cleanPhone)) {
      targetNotif = this.recentNotificationByPhone.get(cleanPhone) || null;
    }

    if (!targetNotif) {
      // Fallback: tenta todas as variações do telefone na memória
      const phoneVariants: string[] = [];
      if (cleanPhone.startsWith('55') && cleanPhone.length >= 12) {
        const without55 = cleanPhone.slice(2);
        phoneVariants.push(without55);
        if (without55.length === 11 && without55[2] === '9') {
          phoneVariants.push(`55${without55.slice(0, 2)}${without55.slice(3)}`);
          phoneVariants.push(`${without55.slice(0, 2)}${without55.slice(3)}`);
        } else if (without55.length === 10) {
          phoneVariants.push(`55${without55.slice(0, 2)}9${without55.slice(2)}`);
          phoneVariants.push(`${without55.slice(0, 2)}9${without55.slice(2)}`);
        }
      } else if (cleanPhone.length >= 10) {
        phoneVariants.push(`55${cleanPhone}`);
        if (cleanPhone.length === 11 && cleanPhone[2] === '9') {
          phoneVariants.push(`55${cleanPhone.slice(0, 2)}${cleanPhone.slice(3)}`);
          phoneVariants.push(`${cleanPhone.slice(0, 2)}${cleanPhone.slice(3)}`);
        }
      }
      for (const variant of phoneVariants) {
        if (this.recentNotificationByPhone.has(variant)) {
          targetNotif = this.recentNotificationByPhone.get(variant) || null;
          if (targetNotif) {
            this.logToFile(`🎯 Notificação encontrada via variação de telefone em memória ${variant} (original: ${cleanPhone})`);
            break;
          }
        }
      }
    }

    if (!targetNotif) {
      // Fallback: busca última notificação por telefone no SQLite
      const dbPhoneNotif = databaseService.getLatestSentNotificationForPhone(cleanPhone);
      if (dbPhoneNotif) {
        targetNotif = dbPhoneNotif;
        this.logToFile(`🎯 Notificação encontrada via SQLite por telefone ${cleanPhone}: ${dbPhoneNotif.residentName} (${dbPhoneNotif.pickupCode})`);
      }
    }

    // Fallback de segurança máxima: se cleanPhone ainda for um LID não mapeado e houver notificação enviada no condomínio nas últimas 4 horas
    if (!targetNotif && remoteJid.includes('@lid')) {
      const latestNotif = databaseService.getLatestSentNotification();
      if (latestNotif && Date.now() - latestNotif.timestamp < 4 * 60 * 60 * 1000) {
        targetNotif = latestNotif;
        cleanPhone = latestNotif.phone.replace(/\D/g, '');
        this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        this.logToFile(`🎯 Morador associado via última notificação recente no condomínio: ${latestNotif.residentName} (${cleanPhone})`);
      }
    }

    // Se encontramos notificação mas cleanPhone ainda era um LID ou difere do telefone real da notificação
    if (targetNotif && targetNotif.phone) {
      const realPhone = targetNotif.phone.replace(/\D/g, '');
      if (realPhone && realPhone.length >= 10 && cleanPhone !== realPhone) {
        if (remoteJid.includes('@lid')) {
          this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), realPhone);
        }
        cleanPhone = realPhone;
      }
    }


    // 2. Extrai código de retirada mencionado no texto ou no texto citado
    const codeFromText = aiIntentService.extractCode(text) || (quotedText ? aiIntentService.extractCode(quotedText) : null);
    const candidateCode = codeFromText || targetNotif?.pickupCode || null;

    // 3. Busca encomenda pelo código (inclusive DELIVERED) se houver código
    let matchedPkgByCode: any = null;
    if (candidateCode) {
      matchedPkgByCode = await databaseService.findPackageByCode(candidateCode);
      if (matchedPkgByCode?.resident?.phone) {
        cleanPhone = matchedPkgByCode.resident.phone;
        if (remoteJid.includes('@lid')) {
          this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        }
      }
    }

    // 4. Busca contexto das encomendas pendentes do morador
    let pendingPkgs = await databaseService.getPendingPackagesForPhone(cleanPhone, candidateCode);
    if ((!pendingPkgs || pendingPkgs.length === 0) && matchedPkgByCode && matchedPkgByCode.status !== 'DELIVERED') {
      pendingPkgs = [matchedPkgByCode];
    }

    // Se ainda não achou mas há notificação recente enviada para este contato:
    if ((!pendingPkgs || pendingPkgs.length === 0) && targetNotif?.pickupCode) {
      const pkg = await databaseService.findPackageByCode(targetNotif.pickupCode);
      if (pkg && pkg.status !== 'DELIVERED') {
        pendingPkgs = [pkg];
      }
    }

    // Verifica se a mensagem possui sinal claro de contestação ou retirada indevida
    const normText = (text || '').toLowerCase().trim();
    const isContestSignal =
      normText.includes('não fiz a retirada') ||
      normText.includes('nao fiz a retirada') ||
      normText.includes('não fiz retirada') ||
      normText.includes('nao fiz retirada') ||
      normText.includes('não retirei') ||
      normText.includes('nao retirei') ||
      normText.includes('não recebi') ||
      normText.includes('nao recebi') ||
      normText.includes('não peguei') ||
      normText.includes('nao peguei') ||
      normText.includes('não é meu') ||
      normText.includes('nao e meu') ||
      normText.includes('não é minha') ||
      normText.includes('nao e minha') ||
      normText.includes('contestação') ||
      normText.includes('contestacao') ||
      normText.includes('não foi você quem retirou') ||
      Boolean(matchedPkgByCode);

    // 🛑 REGRA CRÍTICA: Se o morador NÃO possui nenhuma encomenda pendente para retirada,
    // o robô NUNCA deve responder ou enviar mensagens sobre encomendas.
    // EXCETO se for um sinal de contestação (inclusive de retirada) ou código informado!
    if ((!pendingPkgs || pendingPkgs.length === 0) && !isContestSignal) {
      this.logToFile(
        `ℹ️ [Silenciado] Mensagem recebida de ${cleanPhone} ("${text}"), mas não há nenhuma encomenda pendente para este contato. Nenhuma resposta automática disparada.`
      );
      return;
    }

    let residentName = targetNotif?.residentName || 'Morador(a)';
    let packagesInfo = '';

    if (pendingPkgs && pendingPkgs.length > 0) {
      const first = pendingPkgs[0];
      residentName = first.resident?.name || first.recipient_name_ocr || targetNotif?.residentName || 'Morador(a)';
      packagesInfo = pendingPkgs.map((p: any) => `${p.carrier} (Código: ${p.pickup_code})`).join(', ');
    } else if (matchedPkgByCode) {
      residentName = matchedPkgByCode.resident?.name || matchedPkgByCode.recipient_name_ocr || targetNotif?.residentName || 'Morador(a)';
      packagesInfo = `${matchedPkgByCode.carrier} (Código: ${matchedPkgByCode.pickup_code})`;
    } else {
      const recentDelivered = await databaseService.getRecentDeliveredPackageForPhone(cleanPhone);
      if (recentDelivered) {
        residentName = recentDelivered.resident?.name || recentDelivered.recipient_name_ocr || targetNotif?.residentName || 'Morador(a)';
        packagesInfo = `${recentDelivered.carrier} (Código: ${recentDelivered.pickup_code})`;
      }
    }

    // 🧠 CLASSIFICAÇÃO INTELIGENTE: Heurística Direta + IA (Groq -> Gemini -> NVIDIA)
    const directConfirmKeywords = [
      // Afirmações simples
      'ok', 'ok!', 'sim', 'sim!', 's', 'ss', 'sss', '1', '👍',
      // Confirmações pessoais (eu mesmo)
      'eu mesmo', 'eu mesma', 'eu msm', 'eu mmo', 'sou eu', 'sou eu mesmo',
      'vou eu', 'vou eu mesmo', 'vou eu mesma', 'eu que vou', 'eu que vou buscar',
      'vou eu buscar', 'eu busco', 'eu vou buscar', 'eu vou pegar', 'eu pego',
      'vou pegar', 'vou la', 'vou lá', 'já vou', 'ja vou', 'já vou lá', 'ja vou la',
      'já vou buscar', 'ja vou buscar', 'já vou pegar', 'ja vou pegar',
      // Indo agora
      'tô indo', 'to indo', 'estou indo', 'vou indo', 'indo buscar', 'indo pegar',
      'to descendo', 'tô descendo', 'estou descendo', 'ja to descendo', 'já to descendo',
      'to indo la', 'tô indo lá', 'indo la', 'indo lá',
      'ja desci', 'já desci', 'to la', 'tô lá', 'ja to la', 'já to lá',
      // Confirmações de ciência
      'ciente', 'estou ciente', 'to ciente', 'tô ciente', 'estou sabendo', 'ja sei', 'já sei',
      'ja sabia', 'já sabia', 'tá bom', 'ta bom', 'tá', 'ta', 'combinado', 'confirmado',
      'entendido', 'entendi', 'recebi', 'vi', 'vi sim', 'ok sim', 'tudo bem',
      // Retirada pessoal
      'vou buscar', 'vou retirar', 'vou retirar pessoalmente', 'vou pegar pessoalmente',
      'busco hoje', 'pego hoje', 'retiro hoje', 'vou hoje',
      // Expressões coloquiais
      'beleza', 'blz', 'blza', 'show', 'top', 'joia', 'jóia', 'pode', 'pode ser',
      'valeu', 'vlw', 'obg', 'obrigado', 'obrigada', 'tmj', 'flw', 'falou',
      'massa', 'bora', 'bora la', 'bora lá', 'perfeito',
    ];
    // Remove diacritics for more robust comparison
    const normNoAccent = normText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const isDirectConfirm =
      ['👍', '👌', '✅', '❤️', '👏', '🙏', '🤙', '💪', '🫶', '🫡'].some(e => text.includes(e)) ||
      directConfirmKeywords.includes(normText) ||
      directConfirmKeywords.includes(normNoAccent) ||
      normText.startsWith('eu mesmo') ||
      normText.startsWith('eu mesma') ||
      normText.startsWith('eu que vou') ||
      normText.startsWith('vou eu') ||
      normText.startsWith('ja vou') ||
      normNoAccent.startsWith('ja vou') ||
      normText.startsWith('já vou') ||
      normText.startsWith('to indo') ||
      normText.startsWith('tô indo') ||
      normNoAccent.startsWith('to indo') ||
      normText.startsWith('to descendo') ||
      normText.startsWith('tô descendo') ||
      normText.startsWith('estou descendo') ||
      normText.startsWith('vou buscar') ||
      normText.startsWith('vou pegar') ||
      normText.startsWith('vou la') ||
      normText.startsWith('vou lá') ||
      normNoAccent.startsWith('vou la') ||
      normText.startsWith('indo ') ||
      (normText.length <= 20 && (normText.includes('vou') || normText.includes('buscar') || normText.includes('pegar') || normText.includes('retirar')) && !normText.includes('nao') && !normText.includes('não'));

    let aiResult: any;
    if (isReaction) {
      aiResult = text.includes('Não reconheço')
        ? { intent: 'CONTEST_PACKAGE' as const, confidence: 1.0, reasoning: 'Emoji de reação negativo', extractedCode: candidateCode, source: 'heuristic' as const }
        : { intent: 'CONFIRM_SCIENCE' as const, confidence: 1.0, reasoning: 'Emoji de reação afirmativo', extractedCode: candidateCode, source: 'heuristic' as const };
    } else if (isDirectConfirm) {
      aiResult = {
        intent: 'CONFIRM_SCIENCE' as const,
        confidence: 1.0,
        reasoning: 'Confirmação afirmativa direta do morador',
        extractedCode: candidateCode,
        source: 'heuristic' as const
      };
    } else {
      aiResult = await aiIntentService.classify(text, {
        quotedText,
        residentName,
        packagesInfo
      });
      if (!aiResult.extractedCode && candidateCode) {
        aiResult.extractedCode = candidateCode;
      }
    }

    this.logToFile(
      `🤖 [IA: ${aiResult.source.toUpperCase()}] Intenção: ${aiResult.intent} (Confiança: ${aiResult.confidence}) - Motivo: "${aiResult.reasoning}"`
    );

    const webBaseUrl = this.getPublicWebUrl();

    // 🚨 CASO 1: CONTESTAÇÃO / NÃO RECONHECIMENTO (Morador diz que não é dele / não tem ciência / não retirou)
    if (aiResult.intent === 'CONTEST_PACKAGE') {
      this.logToFile(`🚨 Morador ${cleanPhone} contestou a encomenda! Registrando alerta no sistema...`);
      const contestResult = await databaseService.contestPackageByPhone(
        cleanPhone,
        aiResult.conciergeAlert || aiResult.reasoning || text,
        aiResult.extractedCode || codeFromText
      );

      const targetPkg =
        contestResult?.pkg ||
        contestResult?.pkgs?.[0] ||
        matchedPkgByCode ||
        pendingPkgs?.[0];

      const isWithdrawal =
        Boolean(contestResult?.isWithdrawalContest) ||
        targetPkg?.status === 'DELIVERED' ||
        Boolean(targetPkg?.delivered_at) ||
        normText.includes('retirada') ||
        normText.includes('retirei') ||
        normText.includes('não fiz');

      const carrierName = targetPkg?.carrier || 'Encomenda';
      const pickupCode = targetPkg?.pickup_code || codeFromText || '';

      const audioAck = isFromAudio ? `🎙️ _(Mensagem de voz compreendida: "${text}")_\n\n` : '';
      let replyText = '';
      if (isWithdrawal) {
        replyText =
          `🚨 *ALERTA DE CONTESTAÇÃO DE RETIRADA REGISTRADO!*\n\n` +
          `Olá, *${residentName}*!\n\n` +
          `${audioAck}` +
          `Recebemos com máxima prioridade seu aviso de que você *NÃO realizou a retirada* da encomenda da *${carrierName}*${pickupCode ? ` (Código: *${pickupCode}*)` : ''}.\n\n` +
          `🚨 *A equipe da portaria já foi alertada com alarme de emergência na tela do sistema!*\n` +
          `O porteiro foi orientado a conferir imediatamente o livro de registros, assinatura digital e imagens de câmeras.\n\n` +
          `A portaria entrará em contato com você o mais breve possível para esclarecer.`;
      } else {
        replyText =
          `⚠️ *REGISTRO DE NÃO RECONHECIMENTO DE ENCOMENDA*\n\n` +
          `Olá, *${residentName}*!\n\n` +
          `${audioAck}` +
          `Registramos no sistema que você *não reconhece* ou *não tem ciência* da encomenda da *${carrierName}*${pickupCode ? ` (Código: *${pickupCode}*)` : ''}.\n\n` +
          `🚨 *A equipe da portaria já foi alertada imediatamente na tela do sistema!* O pacote foi retido para conferência física de etiqueta, destinatário e apartamento.\n\n` +
          `Agradecemos o aviso! Caso necessário, a portaria entrará em contato com você.`;
      }

      await this.sendWhatsAppReply(remoteJid, cleanPhone, replyText);
      this.logToFile(`✅ Resposta de contestação (${isWithdrawal ? 'RETIRADA' : 'RECEBIMENTO'}) enviada para ${cleanPhone} e portaria alertada com sucesso.`);
      return;
    }

    // 📦 CASO 2: PEDIDO DE CÓDIGO / QR CODE ("qual meu código?", "manda o qr code", "beleza me manda ai")
    if (aiResult.intent === 'REQUEST_CODE') {
      this.logToFile(`🔍 Morador ${cleanPhone} solicitou código/QR Code...`);
      if (!pendingPkgs || pendingPkgs.length === 0) {
        this.logToFile(`ℹ️ [Silenciado] Nenhuma encomenda pendente para ${cleanPhone}. Nenhuma mensagem disparada.`);
        return;
      }

      const audioAck = isFromAudio ? `🎙️ _(Mensagem de voz compreendida: "${text}")_\n\n` : '';
      let replyText = '';
      if (pendingPkgs.length === 1) {
        const pkg = pendingPkgs[0];
        const token = pkg.qr_token || pkg.pickup_code;
        const pickupUrl = `${webBaseUrl}/p/${token}`;
        const carrierName = pkg.carrier || 'Encomenda';

        replyText =
          `📦 *DADOS DA SUA ENCOMENDA*\n\n` +
          `Olá, *${residentName}*!\n\n` +
          `${audioAck}` +
          `Aqui estão os dados para retirada da sua encomenda da *${carrierName}*:\n\n` +
          `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
          `📱 *Acesse seu QR Code para retirada aqui:*\n${pickupUrl}\n\n` +
          `🏢 Apresente o código ou QR Code no balcão da portaria para retirar.`;
      } else {
        const listItems = pendingPkgs.map((pkg: any, idx: number) => {
          const token = pkg.qr_token || pkg.pickup_code;
          const pickupUrl = `${webBaseUrl}/p/${token}`;
          const carrier = pkg.carrier || 'Encomenda';
          return `📦 *${idx + 1}. ${carrier}*\n🔑 *Código:* *${pkg.pickup_code}*\n📱 *QR Code:* ${pickupUrl}`;
        }).join('\n\n');

        replyText =
          `📦 *DADOS DAS SUAS ENCOMENDAS*\n\n` +
          `Olá, *${residentName}*! Você possui *${pendingPkgs.length} encomendas pendentes* para retirada:\n\n` +
          `${audioAck}` +
          `${listItems}\n\n` +
          `🏢 Apresente os códigos ou QR Codes na portaria para retirar todas as suas encomendas.`;
      }

      await this.sendWhatsAppReply(remoteJid, cleanPhone, replyText);
      this.logToFile(`✅ Dados de retirada enviados a pedido do morador ${cleanPhone}.`);
      return;
    }

    // 🤝 CASO 3: AUTORIZAÇÃO DE RETIRADA POR TERCEIRO ("Quem vai buscar é minha esposa Maria", "Pode entregar pro Carlos")
    if (aiResult.intent === 'AUTHORIZE_THIRD_PARTY') {
      const thirdPartyName = aiResult.thirdPartyName || 'Pessoa Autorizada';
      const thirdPartyRelation = aiResult.thirdPartyRelation || null;

      const lastAck = this.acknowledgmentCooldown.get(cleanPhone) || 0;
      if (!aiResult.extractedCode && !codeFromText && Date.now() - lastAck < 15000) {
        this.logToFile(`⏳ Ignorando autorização de terceiro duplicada em rajada de ${cleanPhone} (<15s).`);
        return;
      }

      this.logToFile(`Processando autorização de terceiro (${thirdPartyName}) para ${cleanPhone}...`);
      const result = await databaseService.authorizeThirdPartyByPhone(
        cleanPhone,
        thirdPartyName,
        thirdPartyRelation,
        aiResult.extractedCode || codeFromText
      );

      const pkgs: any[] = result?.pkgs && result.pkgs.length > 0
        ? result.pkgs
        : (result?.pkg ? [result.pkg] : (pendingPkgs || []));

      if (pkgs.length > 0) {
        this.acknowledgmentCooldown.set(cleanPhone, Date.now());

        const audioAck = isFromAudio ? `🎙️ _(Mensagem de voz compreendida: "${text}")_\n\n` : '';
        const relationLabel = thirdPartyRelation ? ` (${thirdPartyRelation})` : '';
        let replyText = '';

        if (pkgs.length === 1) {
          const pkg = pkgs[0];
          const token = pkg.qr_token || pkg.pickup_code;
          const pickupUrl = `${webBaseUrl}/p/${token}`;
          const carrierName = pkg.carrier || 'Encomenda';

          replyText =
            `🤝 *RETIRADA POR TERCEIRO AUTORIZADA!*\n\n` +
            `Olá, *${residentName}*! 👋\n\n` +
            `${audioAck}` +
            `Registramos no sistema da portaria que *${thirdPartyName}*${relationLabel} está autorizado(a) a retirar sua encomenda da *${carrierName}*.\n\n` +
            `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
            `📱 *Link do QR Code para repassar ao terceiro:*\n${pickupUrl}\n\n` +
            `🏢 A pessoa autorizada só precisa apresentar este código ou QR Code no balcão da portaria.`;
        } else {
          const listItems = pkgs.map((pkg, idx) => {
            const token = pkg.qr_token || pkg.pickup_code;
            const pickupUrl = `${webBaseUrl}/p/${token}`;
            const carrier = pkg.carrier || 'Encomenda';
            return `📦 *${idx + 1}. ${carrier}*\n🔑 *Código:* *${pkg.pickup_code}*\n📱 *QR Code:* ${pickupUrl}`;
          }).join('\n\n');

          replyText =
            `🤝 *RETIRADA POR TERCEIRO AUTORIZADA!*\n\n` +
            `Olá, *${residentName}*! 👋\n\n` +
            `${audioAck}` +
            `Registramos no sistema da portaria que *${thirdPartyName}*${relationLabel} está autorizado(a) a retirar suas *${pkgs.length} encomendas*.\n\n` +
            `Aqui estão os dados e links para você repassar à pessoa autorizada:\n\n` +
            `${listItems}\n\n` +
            `🏢 A pessoa autorizada só precisa apresentar os códigos ou QR Codes na portaria para retirar.`;
        }

        await this.sendWhatsAppReply(remoteJid, cleanPhone, replyText);
        this.logToFile(`✅ Autorização de terceiro (${thirdPartyName}) registrada e enviada para ${cleanPhone}.`);
      } else {
        this.logToFile(`ℹ️ [Silenciado] Nenhuma encomenda pendente para autorizar terceiro de ${cleanPhone}.`);
      }
      return;
    }

    // 👍 CASO 4: CONFIRMAÇÃO DE CIÊNCIA (RETIRADA PESSOAL / OK / JÁ VOU BUSCAR)
    if (aiResult.intent === 'CONFIRM_SCIENCE') {
      // Se a confiança for baixa (<0.65) e não houver código informado, evita confirmação indevida
      if (aiResult.confidence < 0.65 && !codeFromText && !aiResult.extractedCode) {
        this.logToFile(`⚠️ [Silenciado] Mensagem de ${cleanPhone} com baixa confiança (${aiResult.confidence}) para CONFIRM_SCIENCE ("${text}"). Nenhuma ação tomada.`);
        return;
      }

      const lastAck = this.acknowledgmentCooldown.get(cleanPhone) || 0;
      // Cooldown de 15s apenas para evitar envios duplicados em rajada acidental
      if (!aiResult.extractedCode && !codeFromText && Date.now() - lastAck < 15000) {
        this.logToFile(`⏳ Ignorando confirmação duplicada em rajada de ${cleanPhone} (<15s).`);
        return;
      }

      const codeToAck = aiResult.extractedCode || codeFromText || candidateCode;
      this.logToFile(`Processando confirmação de ciência para ${cleanPhone} (Código: ${codeToAck || 'automático'})...`);
      let result = await databaseService.acknowledgePackageByPhone(cleanPhone, codeToAck);

      if (!result && pendingPkgs && pendingPkgs.length > 0) {
        // Se a busca direta por telefone falhou mas temos pendingPkgs conhecidos, confirma diretamente!
        const nowIso = new Date().toISOString();
        for (const row of pendingPkgs) {
          const updatedNotes = row.notes?.includes('CIENTE:') ? row.notes : (row.notes ? `${row.notes};CIENTE:${nowIso}` : `CIENTE:${nowIso}`);
          row.notes = updatedNotes;
          try {
            databaseService.db.prepare(`
              UPDATE packages
              SET status = CASE WHEN status = 'RECEIVED' THEN 'NOTIFIED' ELSE status END,
                  notes = ?,
                  sync_status = 'PENDING'
              WHERE id = ?
            `).run(updatedNotes, row.id);
          } catch {}
        }
        result = { pkgs: pendingPkgs, pkg: pendingPkgs[0], alreadyAcknowledged: false };
      }

      const pkgs: any[] = result?.pkgs && result.pkgs.length > 0
        ? result.pkgs
        : (result?.pkg ? [result.pkg] : (pendingPkgs || []));

      if (pkgs.length > 0) {
        this.acknowledgmentCooldown.set(cleanPhone, Date.now());

        const audioAck = isFromAudio ? `🎙️ _(Mensagem de voz compreendida: "${text}")_\n\n` : '';
        let replyText = '';
        const isReAck = Boolean(result?.alreadyAcknowledged);

        if (pkgs.length === 1) {
          const pkg = pkgs[0];
          const token = pkg.qr_token || pkg.pickup_code;
          const pickupUrl = `${webBaseUrl}/p/${token}`;
          const carrierName = pkg.carrier || 'Encomenda';

          const title = isReAck ? `📦 *DADOS DA SUA ENCOMENDA*` : `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*`;
          const header = isReAck
            ? `Olá, *${residentName}*! Sua ciência já está confirmada. Aqui estão os dados para retirada da sua encomenda da *${carrierName}*:`
            : `Que bom que você está ciente da sua encomenda da *${carrierName}*, *${residentName}*!`;

          replyText =
            `${title}\n\n` +
            `${header}\n\n` +
            `${audioAck}` +
            `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
            `📱 *Acesse seu QR Code para retirada aqui:*\n${pickupUrl}\n\n` +
            `🏢 Apresente o QR Code no balcão da portaria para retirar.`;
        } else {
          const listItems = pkgs.map((pkg, idx) => {
            const token = pkg.qr_token || pkg.pickup_code;
            const pickupUrl = `${webBaseUrl}/p/${token}`;
            const carrier = pkg.carrier || 'Encomenda';
            return `📦 *${idx + 1}. ${carrier}*\n🔑 *Código:* *${pkg.pickup_code}*\n📱 *QR Code:* ${pickupUrl}`;
          }).join('\n\n');

          const title = isReAck ? `📦 *DADOS DAS SUAS ENCOMENDAS*` : `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*`;
          const header = isReAck
            ? `Olá, *${residentName}*! Aqui estão os dados das suas *${pkgs.length} encomendas* para retirada:`
            : `Que bom que você está ciente das suas *${pkgs.length} encomendas*, *${residentName}*! Aqui estão os seus dados de retirada:`;

          replyText =
            `${title}\n\n` +
            `${header}\n\n` +
            `${listItems}\n\n` +
            `🏢 Apresente os códigos ou QR Codes na portaria para retirar todas as suas encomendas.`;
        }

        await this.sendWhatsAppReply(remoteJid, cleanPhone, replyText);

        const codes = pkgs.map(p => p.pickup_code).join(', ');
        this.logToFile(`✅ Ciência confirmada com sucesso e QR Code enviado para ${cleanPhone} (Encomendas: ${codes})`);
      } else {
        // Se nenhuma encomenda pendente foi encontrada: SILÊNCIO TOTAL!
        this.logToFile(`ℹ️ [Silenciado] Nenhuma encomenda pendente para confirmação de ciência de ${cleanPhone}. Nenhuma mensagem disparada.`);
      }
      return;
    }

    // 🛑 CASO 4: NÃO RELACIONADO (Assuntos do condomínio, portão, vaga, bom dia, etc.)
    this.logToFile(
      `ℹ️ [IA: ${aiResult.source.toUpperCase()}] Mensagem recebida de ${cleanPhone} ("${text}") classificada como assunto diverso. Nenhuma resposta automática disparada.`
    );
  }
}

export const whatsAppEngineService = new WhatsAppEngineService();
