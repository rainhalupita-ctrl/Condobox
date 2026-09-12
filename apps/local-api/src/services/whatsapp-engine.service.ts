import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WAMessage,
  proto,
  WASocket
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import os from 'os';
import { env } from '../config/env.js';
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
  private processedMessageIds: Set<string> = new Set();
  private acknowledgmentCooldown: Map<string, number> = new Map();

  constructor() {
    const baseDataDir = process.env.CONDOBOX_DATA_DIR || path.resolve(process.cwd(), 'data');
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
                const phone = f.replace('lid-mapping-', '').replace('.json', '');
                this.lidCache.set(content, phone);
              } catch {}
            }
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
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      if (state.creds?.me?.id) {
        const meId = state.creds.me.id;
        this.connectedPhone = meId.split(':')[0] || meId.split('@')[0];
        if (this.connectedPhone) {
          this.syncConnectedPhoneToCondo(this.connectedPhone);
        }
      }

      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] as [number, number, number] }));

      const logger = pino({ level: 'silent' });

      this.socket = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: state,
        browser: ['CondoBox Portaria', 'Desktop', '1.0.0'],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000
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
            console.log('🔒 [WhatsApp Engine] Sessão deslogada. Limpando credenciais locais e gerando novo QR Code...');
            this.cleanSessionDir();
            this.qrCodeBase64 = null;
            this.reconnectAttempts = 0;
            this.broadcastStatus();
            // Reinicia imediatamente com sessão limpa para emitir novo QR Code para pareamento
            setTimeout(() => {
              this.initialize().catch(() => {});
            }, 1000);
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

  private cleanSessionDir() {
    try {
      if (fs.existsSync(this.sessionDir)) {
        const files = fs.readdirSync(this.sessionDir);
        for (const file of files) {
          const filePath = path.join(this.sessionDir, file);
          try {
            if (fs.statSync(filePath).isDirectory()) {
              fs.rmSync(filePath, { recursive: true, force: true });
            } else {
              if (file.startsWith('creds')) {
                fs.writeFileSync(filePath, '{}', 'utf-8');
              }
              fs.unlinkSync(filePath);
            }
          } catch (fileErr: any) {
            try {
              fs.writeFileSync(filePath, '', 'utf-8');
            } catch {}
          }
        }
      }
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
        await this.socket.logout().catch(() => {});
        this.socket.end(new Error('Logout manual'));
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
    console.log('🔓 [WhatsApp Engine] Sessão encerrada manualmente.');
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
      const jid = await this.resolveJid(phone);
      console.log(`📱 [WhatsApp Engine] Enviando mensagem de texto para JID: ${jid} (telefone: ${phone})`);
      const sent = await this.socket.sendMessage(jid, { text });
      return { success: true, messageId: sent?.key?.id || 'ok' };
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
      const jid = await this.resolveJid(phone);
      console.log(`🖼️ [WhatsApp Engine] Enviando imagem para JID: ${jid} (telefone: ${phone})`);
      let imageBuffer: Buffer;

      if (Buffer.isBuffer(imageSource)) {
        imageBuffer = imageSource;
      } else if (typeof imageSource === 'string' && (imageSource.startsWith('http://') || imageSource.startsWith('https://'))) {
        const res = await fetch(imageSource);
        const arrayBuf = await res.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuf);
      } else if (typeof imageSource === 'string' && fs.existsSync(imageSource)) {
        imageBuffer = fs.readFileSync(imageSource);
      } else {
        // Fallback para envio de texto
        if (caption) return this.sendTextMessage(phone, caption);
        return { success: false, error: 'Imagem inválida' };
      }

      const sent = await this.socket.sendMessage(jid, {
        image: imageBuffer,
        caption: caption || '',
        mimetype: 'image/jpeg'
      });

      return { success: true, messageId: sent?.key?.id || 'ok' };
    } catch (err: any) {
      console.warn('[WhatsApp Engine] Falha no envio de imagem, enviando apenas texto:', err.message);
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
      `💬 *Por favor, responda esta mensagem (ex: "OK" ou "Ciente") para confirmar que você tem ciência dessa encomenda e liberar seu Código e QR Code de Retirada.*\n\n` +
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

    if (params.labelImageUrl) {
      return this.sendImageMessage(params.phone, params.labelImageUrl, text);
    } else {
      return this.sendTextMessage(params.phone, text);
    }
  }

  public async notifyPackageDelivered(params: {
    phone: string;
    residentName: string;
    deliveredTo: string;
    unitInfo: string;
    carrier: string;
    deliveredAt: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const text =
      `✅ *ENCOMENDA RETIRADA COM SUCESSO*\n\n` +
      `Olá, *${params.residentName}*!\n\n` +
      `A encomenda (*${params.carrier}*) da unidade *${params.unitInfo}* foi retirada na portaria.\n\n` +
      `👤 *Retirado por:* ${params.deliveredTo}\n` +
      `🕒 *Data/Hora:* ${params.deliveredAt}\n` +
      `✍️ *Assinatura digital arquivada no sistema da portaria.*\n\n` +
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
      `Olá, *${params.residentName}*!\n\n` +
      `Lembramos que sua encomenda de *${params.carrier}* (recebida em ${params.receivedAt}) ainda está disponível para retirada na portaria para sua unidade (*${params.unitInfo}*).\n\n` +
      `🔑 *Código de Retirada:* *${params.pickupCode}*\n` +
      `📱 *Link do QR Code:*\n${pickupUrl}\n\n` +
      `_Por favor, passe na portaria para retirar sua encomenda quando puder._\n\n` +
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

      // Resposta instantânea da memória (0.001ms)
      if (this.lidCache.has(cleanLid)) {
        return this.lidCache.get(cleanLid)!;
      }

      // Se ainda não estiver em cache, faz leitura rápida do disco
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
                  const phone = f.replace('lid-mapping-', '').replace('.json', '');
                  this.lidCache.set(content, phone);
                } catch {}
              }
            }
          }
        } catch {}
      }

      if (this.lidCache.has(cleanLid)) {
        const phone = this.lidCache.get(cleanLid)!;
        this.logToFile(`LID ${cleanLid} resolvido para telefone: ${phone}`);
        return phone;
      }
    }

    return remoteJid.replace(/@s\.whatsapp\.net|@c\.us|@lid|\D/g, '');
  }

  private extractTextFromMessage(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return '';
    return (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.ephemeralMessage?.message?.conversation ||
      m.ephemeralMessage?.message?.extendedTextMessage?.text ||
      m.viewOnceMessage?.message?.conversation ||
      m.viewOnceMessage?.message?.extendedTextMessage?.text ||
      m.viewOnceMessageV2?.message?.conversation ||
      m.viewOnceMessageV2?.message?.extendedTextMessage?.text ||
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

      const text = this.extractTextFromMessage(msg).trim();
      if (!text) return;

      const cleanPhone = this.resolvePhoneFromRemoteJid(remoteJid);
      this.logToFile(`📩 Mensagem recebida de ${remoteJid} (Telefone: ${cleanPhone}): "${text}"`);

      // Extrai código somente se não for palavra comum de confirmação em português
      const commonWords = ['OK', 'CIENTE', 'SIM', 'NAO', 'VALEU', 'BOA', 'RECEBI', 'CONFIRMO', 'CHEGANDO', 'VOU', 'OBRIGADO', 'OBRIGADA', 'SHOW', 'TA', 'TÁ'];
      let mentionedCode: string | null = null;
      const codeMatch = text.match(/\b([0-9a-zA-Z]{4,6})\b/);
      if (codeMatch) {
        const potential = codeMatch[1].toUpperCase();
        if (!commonWords.includes(potential)) {
          mentionedCode = potential;
        }
      }

      // Se não for um código digitado expressamente e já houve confirmação enviada nos últimos 30 segundos, ignora
      const lastAck = this.acknowledgmentCooldown.get(cleanPhone) || 0;
      if (!mentionedCode && Date.now() - lastAck < 30000) {
        this.logToFile(`⏳ Ignorando mensagem de ${cleanPhone}: confirmação enviada recentemente (<30s). Evitando duplicata.`);
        return;
      }

      // Import dinâmico do serviço de dados local/supabase
      const { databaseService } = await import('./database.service.js').catch(() => ({ databaseService: null as any }));
      if (!databaseService) {
        this.logToFile('databaseService não pôde ser importado.');
        return;
      }

      this.logToFile(`Buscando encomenda pendente para telefone ${cleanPhone}...`);
      const result = await databaseService.acknowledgePackageByPhone(cleanPhone, mentionedCode);

      if (result && result.pkg) {
        this.acknowledgmentCooldown.set(cleanPhone, Date.now());
        const pkg = result.pkg;
        const webBaseUrl = this.getPublicWebUrl();
        const token = pkg.qr_token || pkg.pickup_code;
        const pickupUrl = `${webBaseUrl}/p/${token}`;

        let residentName = 'Morador(a)';
        try {
          if (pkg.resident?.name) {
            residentName = pkg.resident.name;
          } else if (pkg.resident_id) {
            const r = databaseService.getResidentById(pkg.resident_id);
            if (r?.name) residentName = r.name;
          } else if (pkg.recipient_name_ocr) {
            residentName = pkg.recipient_name_ocr;
          }
        } catch {}

        const carrierName = pkg.carrier || 'Encomenda';

        const replyText =
          `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
          `Que bom que você está ciente da sua encomenda da *${carrierName}*, *${residentName}*!\n\n` +
          `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
          `📱 *Acesse seu QR Code para retirada aqui:*\n${pickupUrl}\n\n` +
          `🏢 Apresente o QR Code no balcão da portaria para retirar.`;

        // ⏱️ Delay humanizado anti-banimento (1.8s) com presença "digitando..."
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

        // Envia resposta
        try {
          if (this.socket) {
            this.logToFile(`Enviando confirmação diretamente para conversa ativa: ${remoteJid}...`);
            await this.socket.sendMessage(remoteJid, { text: replyText });
          } else {
            await this.sendTextMessage(cleanPhone, replyText);
          }
        } catch (sendErr: any) {
          this.logToFile(`Fallback para sendTextMessage(${cleanPhone})...`);
          await this.sendTextMessage(cleanPhone, replyText);
        }

        this.logToFile(`✅ Ciência confirmada com sucesso e QR Code enviado para ${cleanPhone} (Encomenda: ${pkg.pickup_code})`);
      } else if (result && (result as any).alreadyAcknowledged) {
        this.acknowledgmentCooldown.set(cleanPhone, Date.now());
        this.logToFile(`ℹ️ Ciência do morador (${cleanPhone}) já havia sido registrada. Envio repetido de QR Code suprimido.`);
      } else {
        this.logToFile(`⚠️ Nenhuma encomenda pendente encontrada para o telefone ${cleanPhone}.`);
      }
    } catch (err: any) {
      this.logToFile(`❌ Erro ao tratar mensagem recebida: ${err.message}`);
    }
  }
}

export const whatsAppEngineService = new WhatsAppEngineService();
