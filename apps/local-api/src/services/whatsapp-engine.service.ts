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

  private extractQuotedTextFromMessage(msg: WAMessage): string {
    const contextInfo =
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      (msg.message as any)?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo;

    const qm = contextInfo?.quotedMessage;
    if (!qm) return '';

    return (
      qm.conversation ||
      qm.extendedTextMessage?.text ||
      qm.imageMessage?.caption ||
      qm.videoMessage?.caption ||
      ''
    );
  }

  private classifyIncomingMessage(text: string, quotedText?: string): {
    isAcknowledge: boolean;
    isCodeRequest: boolean;
    isContestation: boolean;
    isUnrelated: boolean;
    extractedCode: string | null;
    reason: string;
  } {
    const trimmed = text.trim();
    const normalized = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // 1. Verificação de Contestação (morador avisando que não é dele / não pediu / destinatário errado)
    const contestationRegex = /\b(nao (e|eh) minh[ao]|nao pedi|encomenda errada|nao recebi|veio errad[ao]|nao sou eu|destinatario errado|pacote errado)\b/i;
    if (contestationRegex.test(normalized)) {
      return {
        isAcknowledge: false,
        isCodeRequest: false,
        isContestation: true,
        isUnrelated: false,
        extractedCode: null,
        reason: 'contestation'
      };
    }

    // 2. Extração de código específico (#ABCDEF ou "codigo: ABCDEF" ou 5 a 7 caracteres alfanuméricos isolados)
    let extractedCode: string | null = null;
    const hashMatch = text.match(/#([a-zA-Z0-9]{4,8})\b/);
    const codePrefixMatch = text.match(/\b(?:cod(?:igo)?|retirada)[:\s]+([a-zA-Z0-9]{4,8})\b/i);

    if (hashMatch) {
      extractedCode = hashMatch[1].toUpperCase();
    } else if (codePrefixMatch) {
      extractedCode = codePrefixMatch[1].toUpperCase();
    } else if (/^[a-zA-Z0-9]{5,7}$/.test(trimmed)) {
      // Se a mensagem inteira for apenas uma palavra de 5 a 7 caracteres, verifica se não é palavra comum em português
      const commonWords = new Set([
        'BOM', 'BOA', 'DIA', 'TARDE', 'NOITE', 'OLA', 'OLAA', 'OI', 'OII', 'OIII',
        'TUDO', 'BEM', 'COMO', 'VAI', 'VALEU', 'VLW', 'OBRIGADO', 'OBRIGADA', 'OBG',
        'SHOW', 'TOP', 'JOIA', 'BELEZA', 'BLZ', 'SIM', 'NAO', 'OK', 'OKK', 'OKEY',
        'CIENTE', 'CONFIRMO', 'RECEBI', 'VOU', 'TESTE', 'FAVOR', 'AJUDA', 'AQUI',
        'ONDE', 'QUEM', 'QUAL', 'PORTA', 'VAGA', 'CARRO', 'CASA', 'APTO', 'BLOCO',
        'QUERO', 'SAIR', 'ENTRAR', 'DESCER', 'SUBIR', 'VENDO', 'PODE', 'PODEM'
      ]);
      const upperCandidate = trimmed.toUpperCase();
      if (!commonWords.has(upperCandidate)) {
        extractedCode = upperCandidate;
      }
    }

    // 3. Pedido de Código / QR Code ("qual meu código?", "manda o qr code", "perdi meu código")
    const codeRequestRegex = /\b(qual (o |meu )?cod(?:igo)?|manda (o |o link do )?(qr\s?code|cod(?:igo)?)|perdi (o |meu )?(qr\s?code|cod(?:igo)?)|link (da encomenda|do qr\s?code|de retirada)|cade o qr\s?code)\b/i;
    if (codeRequestRegex.test(normalized)) {
      return {
        isAcknowledge: false,
        isCodeRequest: true,
        isContestation: false,
        isUnrelated: false,
        extractedCode,
        reason: 'code_request'
      };
    }

    // 4. Assuntos diversos do condomínio (portão, vaga, síndico, boleto, interfone, barulho, etc.)
    const unrelatedCondoRegex = /\b(vaga|garagem|estacionamento|boleto|cota condominial|taxa|segunda via|sindico|sindica|administradora|administracao|interfone|portao|fechadura|chaveiro|chave|barulho|vizinho|som alto|lixo|reciclagem|elevador|vazamento|infiltracao|cano|agua|luz|visita|visitante|prestador|uber|ifood|pizza|entregador|mudanca|salao|churrasqueira|piscina|academia)\b/i;
    if (!hashMatch && !codePrefixMatch && unrelatedCondoRegex.test(normalized)) {
      return {
        isAcknowledge: false,
        isCodeRequest: false,
        isContestation: false,
        isUnrelated: true,
        extractedCode: null,
        reason: 'unrelated_condo_topic'
      };
    }

    // 5. Perguntas gerais com ponto de interrogação que não sejam de código
    if (text.includes('?') && !hashMatch && !codePrefixMatch && !codeRequestRegex.test(normalized)) {
      return {
        isAcknowledge: false,
        isCodeRequest: false,
        isContestation: false,
        isUnrelated: true,
        extractedCode: null,
        reason: 'general_question'
      };
    }

    // 6. Resposta direta a notificação citada (quotedMessage)
    if (quotedText) {
      const normQuoted = quotedText.toLowerCase();
      const isQuotingPackage =
        normQuoted.includes('encomenda') ||
        normQuoted.includes('retirada') ||
        normQuoted.includes('codigo') ||
        normQuoted.includes('condobox') ||
        normQuoted.includes('portaria');
      if (isQuotingPackage && trimmed.length <= 40) {
        return {
          isAcknowledge: true,
          isCodeRequest: false,
          isContestation: false,
          isUnrelated: false,
          extractedCode,
          reason: 'quoted_notification_reply'
        };
      }
    }

    // 7. Emojis afirmativos
    const ackEmojis = ['👍', '👌', '📦', '✅', '🆗', '🤝', '🙏'];
    const hasAckEmoji = ackEmojis.some(emoji => text.includes(emoji));

    // 8. Expressões afirmativas explícitas (mensagens curtas <= 60 caracteres)
    const ackKeywordsRegex = /\b(ciente|estou ciente|to ciente|tô ciente|ta ciente|tá ciente|ok|okk|okey|okay|confirmado|confirmo|confirmar|confirmada|recebido|recebi|entendido|entendi|obrigad[ao]|valeu|vlw|obg|agradecid[ao]|gratidao|show|show de bola|perfeito|maravilha|joia|beleza|blz|tranquilo|vou retirar|vou buscar|ja vou buscar|ja vou descer|estou descendo|to descendo|tô descendo|indo buscar|passo ai|passo aí|vou pegar|ja pego|pego mais tarde|logo busco)\b/i;

    const isShortMessage = trimmed.length <= 60;
    const isAckKeyword = isShortMessage && ackKeywordsRegex.test(normalized);
    const isSimpleYes = isShortMessage && /^(sim|sim obrigado|sim valeu|sim ciente)$/i.test(normalized);

    if (hasAckEmoji || isAckKeyword || isSimpleYes || extractedCode) {
      return {
        isAcknowledge: true,
        isCodeRequest: false,
        isContestation: false,
        isUnrelated: false,
        extractedCode,
        reason: extractedCode ? 'extracted_code' : (hasAckEmoji ? 'ack_emoji' : 'ack_keyword')
      };
    }

    // 9. Se for qualquer outro assunto ou saudação (ex: "Bom dia", "Olá")
    return {
      isAcknowledge: false,
      isCodeRequest: false,
      isContestation: false,
      isUnrelated: true,
      extractedCode: null,
      reason: 'casual_or_unrelated'
    };
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

      const quotedText = this.extractQuotedTextFromMessage(msg);
      const cleanPhone = this.resolvePhoneFromRemoteJid(remoteJid);
      this.logToFile(`📩 Mensagem recebida de ${remoteJid} (Telefone: ${cleanPhone}): "${text}"`);

      // 🧠 CLASSIFICAÇÃO INTELIGENTE DE INTENÇÃO
      const intent = this.classifyIncomingMessage(text, quotedText);

      // Se for contestação de morador avisando que não é dele:
      if (intent.isContestation) {
        this.logToFile(`⚠️ Mensagem de ${cleanPhone} classificada como contestação ("${text}"). Não confirmando ciência.`);
        return;
      }

      // Se NÃO for confirmação de ciência, NEM pedido de código, NEM código digitado:
      if (!intent.isAcknowledge && !intent.isCodeRequest && !intent.extractedCode) {
        this.logToFile(`ℹ️ Mensagem recebida de ${cleanPhone} ("${text}") ignorada para auto-resposta de encomenda (motivo: ${intent.reason}).`);
        return;
      }

      // Import dinâmico do databaseService
      const { databaseService } = await import('./database.service.js').catch(() => ({ databaseService: null as any }));
      if (!databaseService) {
        this.logToFile('databaseService não pôde ser importado.');
        return;
      }

      const webBaseUrl = this.getPublicWebUrl();

      // CASO 1: Morador pediu expressamente o código ou link de retirada ("qual meu código?", "manda o qr code")
      if (intent.isCodeRequest) {
        this.logToFile(`🔍 Morador ${cleanPhone} solicitou dados/QR Code da encomenda...`);
        const pendingPkgs = await databaseService.getPendingPackagesForPhone(cleanPhone);
        if (!pendingPkgs || pendingPkgs.length === 0) {
          this.logToFile(`ℹ️ Nenhuma encomenda pendente encontrada para envio de código a ${cleanPhone}.`);
          return;
        }

        let residentName = 'Morador(a)';
        const firstPkg = pendingPkgs[0];
        try {
          if (firstPkg.resident?.name) {
            residentName = firstPkg.resident.name;
          } else if (firstPkg.recipient_name_ocr) {
            residentName = firstPkg.recipient_name_ocr;
          }
        } catch {}

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
        this.logToFile(`✅ Dados de retirada reenviados a pedido do morador ${cleanPhone}.`);
        return;
      }

      // CASO 2: Confirmação de Ciência ou Envio de Código de Retirada
      const lastAck = this.acknowledgmentCooldown.get(cleanPhone) || 0;
      if (!intent.extractedCode && Date.now() - lastAck < 30000) {
        this.logToFile(`⏳ Ignorando confirmação de ${cleanPhone}: resposta enviada recentemente (<30s).`);
        return;
      }

      this.logToFile(`Processando confirmação de ciência para ${cleanPhone} (Código mencionado: ${intent.extractedCode || 'nenhum'})...`);
      const result = await databaseService.acknowledgePackageByPhone(cleanPhone, intent.extractedCode);

      const pkgs: any[] = result?.pkgs && result.pkgs.length > 0 ? result.pkgs : (result?.pkg ? [result.pkg] : []);

      // Se confirmou ciência de novos pacotes:
      if (pkgs.length > 0 && !result?.alreadyAcknowledged) {
        this.acknowledgmentCooldown.set(cleanPhone, Date.now());

        let residentName = 'Morador(a)';
        const firstPkg = pkgs[0];
        try {
          if (firstPkg.resident?.name) {
            residentName = firstPkg.resident.name;
          } else if (firstPkg.resident_id) {
            const r = databaseService.getResidentById(firstPkg.resident_id);
            if (r?.name) residentName = r.name;
          } else if (firstPkg.recipient_name_ocr) {
            residentName = firstPkg.recipient_name_ocr;
          }
        } catch {}

        let replyText = '';

        if (pkgs.length === 1) {
          const pkg = pkgs[0];
          const token = pkg.qr_token || pkg.pickup_code;
          const pickupUrl = `${webBaseUrl}/p/${token}`;
          const carrierName = pkg.carrier || 'Encomenda';

          replyText =
            `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
            `Que bom que você está ciente da sua encomenda da *${carrierName}*, *${residentName}*!\n\n` +
            `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
            `📱 *Acesse seu QR Code para retirada aqui:*\n${pickupUrl}\n\n` +
            `🏢 Apresente o QR Code no balcão da portaria para retirar.`;
        } else {
          // Múltiplas encomendas juntas para o mesmo morador
          const listItems = pkgs.map((pkg, idx) => {
            const token = pkg.qr_token || pkg.pickup_code;
            const pickupUrl = `${webBaseUrl}/p/${token}`;
            const carrier = pkg.carrier || 'Encomenda';
            return `📦 *${idx + 1}. ${carrier}*\n🔑 *Código:* *${pkg.pickup_code}*\n📱 *QR Code:* ${pickupUrl}`;
          }).join('\n\n');

          replyText =
            `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
            `Que bom que você está ciente das suas *${pkgs.length} encomendas*, *${residentName}*! Aqui estão os seus dados de retirada:\n\n` +
            `${listItems}\n\n` +
            `🏢 Apresente os códigos ou QR Codes na portaria para retirar todas as suas encomendas.`;
        }

        await this.sendWhatsAppReply(remoteJid, cleanPhone, replyText);

        const codes = pkgs.map(p => p.pickup_code).join(', ');
        this.logToFile(`✅ Ciência confirmada com sucesso e QR Code enviado para ${cleanPhone} (Encomendas: ${codes})`);
      } else if (result && result.alreadyAcknowledged) {
        // Se o morador digitou expressamente o código da encomenda já confirmada, reenviamos os dados
        if (intent.extractedCode && pkgs.length > 0) {
          const pkg = pkgs[0];
          const token = pkg.qr_token || pkg.pickup_code;
          const pickupUrl = `${webBaseUrl}/p/${token}`;
          const residentName = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador(a)';
          const carrierName = pkg.carrier || 'Encomenda';

          const replyText =
            `📦 *DADOS DA SUA ENCOMENDA*\n\n` +
            `Olá, *${residentName}*! A sua encomenda da *${carrierName}* está pronta para retirada na portaria:\n\n` +
            `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
            `📱 *Acesse seu QR Code aqui:*\n${pickupUrl}\n\n` +
            `🏢 Apresente no balcão da portaria para retirar.`;

          await this.sendWhatsAppReply(remoteJid, cleanPhone, replyText);
          this.logToFile(`ℹ️ Código digitado expressamente (${intent.extractedCode}). Dados de retirada reenviados para ${cleanPhone}.`);
        } else {
          this.acknowledgmentCooldown.set(cleanPhone, Date.now());
          this.logToFile(`ℹ️ Ciência do morador (${cleanPhone}) já havia sido registrada. Envio repetido de QR Code suprimido para não ser repetitivo.`);
        }
      } else {
        this.logToFile(`ℹ️ Nenhuma encomenda pendente elegível para confirmação para ${cleanPhone}.`);
      }
    } catch (err: any) {
      this.logToFile(`❌ Erro ao tratar mensagem recebida: ${err.message}`);
    }
  }
}

export const whatsAppEngineService = new WhatsAppEngineService();
