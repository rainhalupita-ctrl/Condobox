import { whatsAppEngineService } from './whatsapp-engine.service.js';
export class WhatsAppService {
    getPublicWebUrl() {
        return whatsAppEngineService.getPublicWebUrl();
    }
    async initialize() {
        return whatsAppEngineService.initialize();
    }
    async logout() {
        return whatsAppEngineService.logout();
    }
    getStatus() {
        return whatsAppEngineService.getStatus();
    }
    async checkInstanceStatus() {
        const status = whatsAppEngineService.getStatus();
        return {
            state: status.status === 'CONNECTED' ? 'open' : status.status,
            connected: status.connected,
            qrcode: status.qrcode,
            phone: status.phone
        };
    }
    async ensureWebhookConfigured() {
        // No Baileys nativo, os eventos já são escutados internamente pelo socket.ev.on('messages.upsert')
        return Promise.resolve();
    }
    async notifyPackageArrival(params) {
        return whatsAppEngineService.notifyPackageArrival(params);
    }
    async notifyPackageDelivered(params) {
        return whatsAppEngineService.notifyPackageDelivered(params);
    }
    async sendMessage(options) {
        if (options.mediaUrl) {
            return whatsAppEngineService.sendImageMessage(options.phone, options.mediaUrl, options.caption || options.message);
        }
        else {
            return whatsAppEngineService.sendTextMessage(options.phone, options.message);
        }
    }
}
export const whatsappService = new WhatsAppService();
