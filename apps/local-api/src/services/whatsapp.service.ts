import { whatsAppEngineService, WhatsAppStatus } from './whatsapp-engine.service.js';

export interface SendMessageOptions {
  phone: string;
  message: string;
  mediaUrl?: string;
  caption?: string;
}

export class WhatsAppService {
  public getPublicWebUrl(): string {
    return whatsAppEngineService.getPublicWebUrl();
  }

  public async initialize(): Promise<void> {
    return whatsAppEngineService.initialize();
  }

  public async logout(): Promise<void> {
    return whatsAppEngineService.logout();
  }

  public getStatus(): WhatsAppStatus {
    return whatsAppEngineService.getStatus();
  }

  public async checkInstanceStatus(): Promise<{ state: string; connected: boolean; qrcode?: string | null; phone?: string | null }> {
    const status = whatsAppEngineService.getStatus();
    return {
      state: status.status === 'CONNECTED' ? 'open' : status.status,
      connected: status.connected,
      qrcode: status.qrcode,
      phone: status.phone
    };
  }

  public async ensureWebhookConfigured(): Promise<void> {
    // No Baileys nativo, os eventos já são escutados internamente pelo socket.ev.on('messages.upsert')
    return Promise.resolve();
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
    return whatsAppEngineService.notifyPackageArrival(params);
  }

  public async notifyPackageDelivered(params: {
    phone: string;
    residentName: string;
    deliveredTo: string;
    unitInfo: string;
    carrier: string;
    deliveredAt: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return whatsAppEngineService.notifyPackageDelivered(params);
  }

  public async sendMessage(options: SendMessageOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (options.mediaUrl) {
      return whatsAppEngineService.sendImageMessage(options.phone, options.mediaUrl, options.caption || options.message);
    } else {
      return whatsAppEngineService.sendTextMessage(options.phone, options.message);
    }
  }
}

export const whatsappService = new WhatsAppService();
