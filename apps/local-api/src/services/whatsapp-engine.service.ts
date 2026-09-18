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
    console.log(`📱 [WhatsApp Engine] Cache de LIDs carregado com ${this.lidCache.size} mapeamentos.`);
  }

  public recordLidMapping(lid: string, phone: string): void {
    const cleanLid = lid.replace(/\D/g, '');
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanLid || !cleanPhone) return;

    this.lidCache.set(cleanLid, cleanPhone);

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
        getMessage: async () => undefined
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

  public async logout(): Promise<void> {
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
      const cleanP = params.phone.replace(/\D/g, '');
      this.recentNotificationByPhone.set(cleanP, notifData);
      try {
        const targetJid = await this.resolveJid(params.phone);
        this.recentNotificationByJid.set(targetJid, notifData);
      } catch {}

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

  private resolvePhoneFromRemoteJid(remoteJid: string): string {
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

      // 2. Leitura direta O(1) do arquivo reverso sem varredura pesada de diretório
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
              this.logToFile(`LID ${cleanLid} resolvido para telefone: ${content} via disco`);
              return content;
            }
          }
        } catch {}
      }

      // 3. Verificação direta nos arquivos Baileys: se algum telefone recente mapeia para este cleanLid
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
                this.logToFile(`LID ${cleanLid} resolvido para telefone: ${phone} via lid-mapping direto`);
                return phone;
              }
            }
          } catch {}
        }
      }

      // 4. Fallback via notificação recente enviada por JID
      if (this.recentNotificationByJid.has(remoteJid)) {
        const notif = this.recentNotificationByJid.get(remoteJid)!;
        const phone = notif.phone.replace(/\D/g, '');
        this.lidCache.set(cleanLid, phone);
        this.recordLidMapping(cleanLid, phone);
        this.logToFile(`LID ${cleanLid} resolvido para telefone: ${phone} via notificação recente`);
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
        await this.socket.sendMessage(remoteJid, { text: replyText });
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
      const remoteJid = reactionUpdate.key?.remoteJid || reactionUpdate.reaction?.key?.remoteJid || '';
      if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.includes('@g.us')) return;

      const emoji = (reactionUpdate.reaction?.text || '').trim();
      if (!emoji) return; // Reação removida pelo morador

      const targetMsgId = reactionUpdate.reaction?.key?.id || reactionUpdate.key?.id;
      this.logToFile(`👍 Reação recebida em ${remoteJid} (Msg: ${targetMsgId}): "${emoji}"`);

      const isContest = ['👎', '❌', '🚫', '😡', '😠'].some(e => emoji.includes(e));
      const simulatedText = isContest ? 'Não reconheço essa encomenda ❌' : 'Ciente, obrigado 👍';

      await this.processIncomingContent({
        remoteJid,
        text: simulatedText,
        quotedMsgId: targetMsgId,
        isReaction: true
      });
    } catch (err: any) {
      this.logToFile(`❌ Erro ao processar reação: ${err.message}`);
    }
  }

  private async transcribeAudioMessage(msg: WAMessage): Promise<string> {
    try {
      const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) return '';

      const buffer = await downloadMediaMessage(
        msg,
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

      if (!buffer || buffer.length === 0) return '';

      const base64Data = buffer.toString('base64');
      const audioMime = msg.message?.audioMessage?.mimetype || 'audio/ogg; codecs=opus';
      const cleanMime = audioMime.split(';')[0].trim() || 'audio/ogg';

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: cleanMime,
            data: base64Data,
          },
        },
        {
          text: 'Transcreva o áudio em português com precisão. Retorne APENAS o texto falado, sem aspas, introduções ou comentários adicionais. Se inaudível ou ruído, retorne vazio.',
        },
      ]);

      const transcribed = result.response.text().trim();
      if (transcribed) {
        this.logToFile(`🎙️ [Áudio Transcrito com Gemini]: "${transcribed}"`);
      }
      return transcribed;
    } catch (err: any) {
      this.logToFile(`⚠️ Falha ao transcrever áudio com Gemini: ${err.message}`);
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

      this.logToFile(`📩 Mensagem recebida via socket de ${remoteJid} (fromMe: ${msg.key.fromMe}, id: ${msg.key.id})`);

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

      let text = this.extractTextFromMessage(msg).trim();
      const isAudio = Boolean((msg.message as any)?.audioMessage);

      // Se for mensagem de áudio, tenta transcrever com Gemini
      if (isAudio && !text) {
        this.logToFile(`🎤 Mensagem de áudio recebida de ${remoteJid}. Tentando transcrição inteligente...`);
        const transcribed = await this.transcribeAudioMessage(msg);
        if (transcribed) {
          text = transcribed.trim();
        } else {
          this.logToFile(`ℹ️ [Silenciado] Áudio de ${remoteJid} inaudível ou não transcrito. Nenhuma ação automática disparada.`);
          return;
        }
      }

      this.logToFile(`📝 Texto bruto extraído de ${remoteJid}: "${text}"`);
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
        text,
        quotedText,
        quotedMsgId
      });
    } catch (err: any) {
      this.logToFile(`❌ Erro ao tratar mensagem recebida: ${err.message}`);
    }
  }

  private async processIncomingContent(params: {
    remoteJid: string;
    text: string;
    quotedText?: string;
    quotedMsgId?: string;
    isReaction?: boolean;
  }): Promise<void> {
    const { remoteJid, text, quotedText = '', quotedMsgId, isReaction } = params;

    let cleanPhone = this.resolvePhoneFromRemoteJid(remoteJid);
    this.logToFile(`📩 Mensagem recebida de ${remoteJid} (Telefone: ${cleanPhone}): "${text}"`);

    // Import dinâmico do banco e da IA
    const { databaseService } = await import('./database.service.js').catch(() => ({ databaseService: null as any }));
    if (!databaseService) {
      this.logToFile('databaseService não pôde ser importado.');
      return;
    }

    const { aiIntentService } = await import('./ai-intent.service.js');

    // 1. Resolução inteligente de identidade via notificação citada / recente
    if (quotedMsgId && this.recentSentNotifications.has(quotedMsgId)) {
      const notif = this.recentSentNotifications.get(quotedMsgId)!;
      cleanPhone = notif.phone;
      if (remoteJid.includes('@lid')) {
        this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
      }
      this.logToFile(`🎯 Morador identificado via histórico da mensagem citada (${quotedMsgId}): ${notif.residentName} (${cleanPhone})`);
    } else if (this.recentNotificationByJid.has(remoteJid)) {
      const notif = this.recentNotificationByJid.get(remoteJid)!;
      cleanPhone = notif.phone.replace(/\D/g, '');
      if (remoteJid.includes('@lid')) {
        this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
      }
      this.logToFile(`🎯 Morador identificado via notificação enviada para JID (${remoteJid}): ${notif.residentName} (${cleanPhone})`);
    }

    // 2. Extrai código de retirada mencionado no texto ou no texto citado
    const codeFromText = aiIntentService.extractCode(text) || (quotedText ? aiIntentService.extractCode(quotedText) : null);

    // 3. Busca encomenda pelo código (inclusive DELIVERED) se houver código
    let matchedPkgByCode: any = null;
    if (codeFromText) {
      matchedPkgByCode = await databaseService.findPackageByCode(codeFromText);
      if (matchedPkgByCode?.resident?.phone) {
        cleanPhone = matchedPkgByCode.resident.phone;
        if (remoteJid.includes('@lid')) {
          this.recordLidMapping(remoteJid.replace(/@lid|\D/g, ''), cleanPhone);
        }
      }
    }

    // 4. Busca contexto das encomendas pendentes do morador
    let pendingPkgs = await databaseService.getPendingPackagesForPhone(cleanPhone, codeFromText);
    if ((!pendingPkgs || pendingPkgs.length === 0) && matchedPkgByCode && matchedPkgByCode.status !== 'DELIVERED') {
      pendingPkgs = [matchedPkgByCode];
    }

    // Se ainda não achou mas há notificação recente enviada para este contato:
    if ((!pendingPkgs || pendingPkgs.length === 0) && this.recentNotificationByPhone.has(cleanPhone)) {
      const notif = this.recentNotificationByPhone.get(cleanPhone)!;
      if (notif.pickupCode) {
        const pkg = await databaseService.findPackageByCode(notif.pickupCode);
        if (pkg && pkg.status !== 'DELIVERED') {
          pendingPkgs = [pkg];
        }
      }
    }

    // Verifica se a mensagem possui sinal claro de contestação ou retirada indevida
    const normText = (text || '').toLowerCase();
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

    let residentName = 'Morador(a)';
    let packagesInfo = '';

    if (pendingPkgs && pendingPkgs.length > 0) {
      const first = pendingPkgs[0];
      residentName = first.resident?.name || first.recipient_name_ocr || 'Morador(a)';
      packagesInfo = pendingPkgs.map((p: any) => `${p.carrier} (Código: ${p.pickup_code})`).join(', ');
    } else if (matchedPkgByCode) {
      residentName = matchedPkgByCode.resident?.name || matchedPkgByCode.recipient_name_ocr || 'Morador(a)';
      packagesInfo = `${matchedPkgByCode.carrier} (Código: ${matchedPkgByCode.pickup_code})`;
    } else {
      const recentDelivered = await databaseService.getRecentDeliveredPackageForPhone(cleanPhone);
      if (recentDelivered) {
        residentName = recentDelivered.resident?.name || recentDelivered.recipient_name_ocr || 'Morador(a)';
        packagesInfo = `${recentDelivered.carrier} (Código: ${recentDelivered.pickup_code})`;
      }
    }

    // 🧠 CLASSIFICAÇÃO INTELIGENTE COM IA (Groq -> Gemini -> NVIDIA -> Heurística)
    const aiResult = isReaction
      ? (text.includes('Não reconheço')
          ? { intent: 'CONTEST_PACKAGE' as const, confidence: 1.0, reasoning: 'Emoji de reação negativo', extractedCode: codeFromText, source: 'heuristic' as const }
          : { intent: 'CONFIRM_SCIENCE' as const, confidence: 1.0, reasoning: 'Emoji de reação afirmativo', extractedCode: codeFromText, source: 'heuristic' as const })
      : await aiIntentService.classify(text, {
          quotedText,
          residentName,
          packagesInfo
        });

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

      let replyText = '';
      if (isWithdrawal) {
        replyText =
          `🚨 *ALERTA DE CONTESTAÇÃO DE RETIRADA REGISTRADO!*\n\n` +
          `Olá, *${residentName}*!\n\n` +
          `Recebemos com máxima prioridade seu aviso de que você *NÃO realizou a retirada* da encomenda da *${carrierName}*${pickupCode ? ` (Código: *${pickupCode}*)` : ''}.\n\n` +
          `🚨 *A equipe da portaria já foi alertada com alarme de emergência na tela do sistema!*\n` +
          `O porteiro foi orientado a conferir imediatamente o livro de registros, assinatura digital e imagens de câmeras.\n\n` +
          `A portaria entrará em contato com você o mais breve possível para esclarecer.`;
      } else {
        replyText =
          `⚠️ *REGISTRO DE NÃO RECONHECIMENTO DE ENCOMENDA*\n\n` +
          `Olá, *${residentName}*!\n\n` +
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

      let replyText = '';
      if (pendingPkgs.length === 1) {
        const pkg = pendingPkgs[0];
        const token = pkg.qr_token || pkg.pickup_code;
        const pickupUrl = `${webBaseUrl}/p/${token}`;
        const carrierName = pkg.carrier || 'Encomenda';

        replyText =
          `📦 *DADOS DA SUA ENCOMENDA*\n\n` +
          `Olá, *${residentName}*! Aqui estão os dados para retirada da sua encomenda da *${carrierName}*:\n\n` +
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
      const lastAck = this.acknowledgmentCooldown.get(cleanPhone) || 0;
      // Cooldown de 15s apenas para evitar envios duplicados em rajada acidental
      if (!aiResult.extractedCode && !codeFromText && Date.now() - lastAck < 15000) {
        this.logToFile(`⏳ Ignorando confirmação duplicada em rajada de ${cleanPhone} (<15s).`);
        return;
      }

      this.logToFile(`Processando confirmação de ciência para ${cleanPhone} (Código: ${aiResult.extractedCode || codeFromText || 'automático'})...`);
      const result = await databaseService.acknowledgePackageByPhone(cleanPhone, aiResult.extractedCode || codeFromText);

      const pkgs: any[] = result?.pkgs && result.pkgs.length > 0
        ? result.pkgs
        : (result?.pkg ? [result.pkg] : (pendingPkgs || []));

      if (pkgs.length > 0) {
        this.acknowledgmentCooldown.set(cleanPhone, Date.now());

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
