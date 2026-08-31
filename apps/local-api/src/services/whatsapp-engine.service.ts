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

  constructor() {
    this.sessionDir = path.resolve(process.cwd(), 'data', 'whatsapp_session');
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
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
    return {
      status: this.currentStatus,
      connected: this.currentStatus === 'CONNECTED',
      phone: this.connectedPhone,
      qrcode: this.qrCodeBase64
    };
  }

  public async initialize(): Promise<void> {
    if (this.isInitializing || (this.socket && this.currentStatus === 'CONNECTED')) {
      return;
    }

    this.isInitializing = true;
    this.currentStatus = 'CONNECTING';

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
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
          } catch (err: any) {
            console.error('[WhatsApp Engine] Erro ao converter QR Code:', err.message);
          }
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.currentStatus = 'DISCONNECTED';
          this.connectedPhone = null;

          console.log(`⚠️ [WhatsApp Engine] Conexão encerrada. Motivo: ${statusCode}. Reconectar: ${shouldReconnect}`);

          if (statusCode === DisconnectReason.loggedOut) {
            console.log('🔒 [WhatsApp Engine] Sessão deslogada. Limpando credenciais locais...');
            this.cleanSessionDir();
            this.qrCodeBase64 = null;
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
        }
      });

      // Listener de respostas dos moradores (Confirmação de Ciência automática)
      this.socket.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
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
        fs.rmSync(this.sessionDir, { recursive: true, force: true });
        fs.mkdirSync(this.sessionDir, { recursive: true });
      }
    } catch (err: any) {
      console.error('[WhatsApp Engine] Erro ao limpar diretório de sessão:', err.message);
    }
  }

  public async logout(): Promise<void> {
    try {
      if (this.socket) {
        await this.socket.logout().catch(() => {});
        this.socket.end(new Error('Logout manual'));
        this.socket = null;
      }
    } catch {}
    this.cleanSessionDir();
    this.currentStatus = 'DISCONNECTED';
    this.connectedPhone = null;
    this.qrCodeBase64 = null;
    console.log('🔓 [WhatsApp Engine] Sessão encerrada manualmente.');
  }

  private formatJid(phone: string): string {
    let clean = phone.replace(/\D/g, '');
    if (!clean.startsWith('55') && clean.length >= 10) {
      clean = `55${clean}`;
    }
    return `${clean}@s.whatsapp.net`;
  }

  public async sendTextMessage(phone: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.socket || this.currentStatus !== 'CONNECTED') {
      return { success: false, error: 'WhatsApp não está conectado no CondoBox.' };
    }

    try {
      const jid = this.formatJid(phone);
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
      const jid = this.formatJid(phone);
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
      `Olá, *${params.residentName}*!\n\n` +
      `Uma encomenda de *${params.carrier}* acabou de ser recebida na portaria para sua unidade (*${params.unitInfo}*).\n\n` +
      `🔑 *Código de Retirada:* *${params.pickupCode}*\n` +
      `📱 *Link do QR Code:*\n${pickupUrl}\n\n` +
      `_Apresente o QR Code ou informe o código de 4 dígitos na portaria ao retirar._\n\n` +
      `🏢 Portaria do Condomínio${adFooter}`;

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

    return this.sendTextMessage(params.phone, text);
  }

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    try {
      if (msg.key.fromMe) return;
      const remoteJid = msg.key.remoteJid || '';
      if (!remoteJid || remoteJid.includes('@g.us')) return;

      const cleanPhone = remoteJid.replace(/@s\.whatsapp\.net|@c\.us|\D/g, '');
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';

      if (!text.trim()) return;

      console.log(`📩 [WhatsApp Engine] Mensagem de ${cleanPhone}: "${text}"`);

      const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const isCiente =
        normalized.includes('ciente') ||
        normalized.includes('ok') ||
        normalized.includes('sim') ||
        normalized.includes('recebido') ||
        normalized.includes('obrigado') ||
        normalized.includes('valeu');

      if (!isCiente) return;

      // Código de 4 dígitos se mencionado
      const codeMatch = text.match(/\b\d{4}\b/);
      const mentionedCode = codeMatch ? codeMatch[0] : null;

      // Import dinâmico do serviço de dados local/supabase
      const { databaseService } = await import('./database.service.js').catch(() => ({ databaseService: null as any }));
      if (databaseService) {
        const result = databaseService.acknowledgePackageByPhone(cleanPhone, mentionedCode);
        if (result && result.pkg) {
          const pkg = result.pkg;
          const replyText =
            `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
            `Registramos sua confirmação para a encomenda *${pkg.carrier}*.\n\n` +
            `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n` +
            `🏢 Portaria ciente da sua resposta!`;

          await this.sendTextMessage(cleanPhone, replyText);
        }
      }
    } catch (err: any) {
      console.warn('[WhatsApp Engine] Erro ao tratar mensagem recebida:', err.message);
    }
  }
}

export const whatsAppEngineService = new WhatsAppEngineService();
