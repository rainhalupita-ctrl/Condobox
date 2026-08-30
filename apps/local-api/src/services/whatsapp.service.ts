import os from 'os';
import { env } from '../config/env.js';

export interface SendMessageOptions {
  phone: string; // Ex: 5511999999999
  message: string;
  mediaUrl?: string;
  caption?: string;
}

export class WhatsAppService {
  private apiUrl: string;
  private apiKey: string;
  private instanceName: string;

  constructor() {
    this.apiUrl = env.EVOLUTION_API_URL.replace(/\/$/, '');
    this.apiKey = env.EVOLUTION_API_KEY;
    this.instanceName = env.EVOLUTION_INSTANCE_NAME;
  }

  /**
   * Obtém a URL pública ou o IP de rede da máquina para que o celular no Wi-Fi/4G consiga abrir
   */
  public getPublicWebUrl(): string {
    // 1. Se estiver configurado um domínio público no .env (ex: ngrok, cloudflare ou domínio real), usa ele
    if (env.WEB_APP_URL && !env.WEB_APP_URL.includes('localhost') && !env.WEB_APP_URL.includes('127.0.0.1')) {
      return env.WEB_APP_URL.replace(/\/$/, '');
    }

    // 2. Se for localhost, resolve para o IP real da máquina na rede local (ex: 192.168.0.6)
    try {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('172.') && !net.address.startsWith('169.254')) {
            return `http://${net.address}:3000`;
          }
        }
      }
    } catch {
      // Fallback para o valor configurado
    }

    return (env.WEB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  }

  /**
   * Normaliza número de telefone para formato WhatsApp (ex: 5511987654321)
   */
  private formatPhone(phone: string): string {
    let clean = phone.replace(/\D/g, '');
    if (!clean.startsWith('55') && clean.length >= 10) {
      clean = `55${clean}`;
    }
    return clean;
  }

  /**
   * Envia notificação de chegada de encomenda
   */
  async notifyPackageArrival(params: {
    phone: string;
    residentName: string;
    unitInfo: string; // Ex: "Apto 101 - Bloco A"
    carrier: string;
    pickupCode: string;
    qrToken?: string;
    labelImageUrl?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const webBaseUrl = this.getPublicWebUrl();
    const token = params.qrToken || params.pickupCode;
    const pickupUrl = `${webBaseUrl}/p/${token}`;

    const text = `📦 *NOVA ENCOMENDA CHEGOU NA PORTARIA!*\n\n` +
      `Olá, *${params.residentName}*!\n\n` +
      `Uma encomenda da *${params.carrier}* acabou de ser recebida na portaria para sua unidade (*${params.unitInfo}*).\n\n` +
      `🔑 *Código de Retirada:* *${params.pickupCode}*\n\n` +
      `📱 *Link Direto com QR Code (Sem login necessário):*\n` +
      `${pickupUrl}\n\n` +
      `_Abra o link acima para exibir o QR Code direto na portaria ou informe o código numérico de 4 dígitos._\n\n` +
      `🏢 Portaria do Condomínio`;

    return this.sendMessage({
      phone: params.phone,
      message: text,
      mediaUrl: params.labelImageUrl,
      caption: `📦 Encomenda ${params.carrier} (${params.unitInfo})\n🔑 Código: ${params.pickupCode}\n📱 QR Code: ${pickupUrl}`
    });
  }

  /**
   * Envia notificação de confirmação de retirada
   */
  async notifyPackageDelivered(params: {
    phone: string;
    residentName: string;
    deliveredTo: string;
    unitInfo: string;
    carrier: string;
    deliveredAt: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const text = `✅ *ENCOMENDA RETIRADA COM SUCESSO*\n\n` +
      `Olá, *${params.residentName}*!\n\n` +
      `A encomenda (*${params.carrier}*) da unidade *${params.unitInfo}* foi retirada na portaria.\n\n` +
      `👤 *Retirado por:* ${params.deliveredTo}\n` +
      `🕒 *Data/Hora:* ${params.deliveredAt}\n` +
      `✍️ *Assinatura digital arquivada com segurança no sistema.*\n\n` +
      `🏢 Portaria do Condomínio`;

    return this.sendMessage({
      phone: params.phone,
      message: text
    });
  }

  /**
   * Envio genérico para Evolution API
   */
  async sendMessage(options: SendMessageOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const phone = this.formatPhone(options.phone);

    try {
      // Se houver imagem, envia media
      if (options.mediaUrl) {
        const url = `${this.apiUrl}/message/sendMedia/${this.instanceName}`;
        const body = {
          number: phone,
          mediaMessage: {
            mediatype: 'image',
            caption: options.message,
            media: options.mediaUrl
          }
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.apiKey
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
          // Fallback para texto simples se o envio de media falhar
          return this.sendTextMessage(phone, options.message);
        }

        const data = await response.json();
        return { success: true, messageId: (data as any)?.key?.id || 'ok' };
      } else {
        return this.sendTextMessage(phone, options.message);
      }
    } catch (err: any) {
      console.error('[WhatsAppService] Falha ao comunicar com Evolution API:', err.message);
      return { success: false, error: err.message };
    }
  }

  private async sendTextMessage(phone: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const url = `${this.apiUrl}/message/sendText/${this.instanceName}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey
        },
        body: JSON.stringify({
          number: phone,
          text: text
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn('[WhatsAppService] Resposta não-OK da Evolution API:', errorText);
        return { success: false, error: errorText };
      }

      const data = await response.json();
      return { success: true, messageId: (data as any)?.key?.id || 'ok' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Verifica o status da instância na Evolution API
   */
  async checkInstanceStatus(): Promise<{ state: string; connected: boolean }> {
    try {
      const url = `${this.apiUrl}/instance/connectionState/${this.instanceName}`;
      const response = await fetch(url, {
        headers: { 'apikey': this.apiKey },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return { state: 'DISCONNECTED', connected: false };
      const data = (await response.json()) as any;
      const state = data?.instance?.state || 'DISCONNECTED';
      return { state, connected: state === 'open' };
    } catch (e) {
      return { state: 'OFFLINE', connected: false };
    }
  }
}

export const whatsappService = new WhatsAppService();
