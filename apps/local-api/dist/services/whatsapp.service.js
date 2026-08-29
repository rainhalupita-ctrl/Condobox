import { env } from '../config/env.js';
export class WhatsAppService {
    apiUrl;
    apiKey;
    instanceName;
    constructor() {
        this.apiUrl = env.EVOLUTION_API_URL.replace(/\/$/, '');
        this.apiKey = env.EVOLUTION_API_KEY;
        this.instanceName = env.EVOLUTION_INSTANCE_NAME;
    }
    /**
     * Normaliza número de telefone para formato WhatsApp (ex: 5511987654321)
     */
    formatPhone(phone) {
        let clean = phone.replace(/\D/g, '');
        if (!clean.startsWith('55') && clean.length >= 10) {
            clean = `55${clean}`;
        }
        return clean;
    }
    /**
     * Envia notificação de chegada de encomenda
     */
    async notifyPackageArrival(params) {
        const text = `📦 *NOVA ENCOMENDA CHEGOU NA PORTARIA*\n\n` +
            `Olá, *${params.residentName}*!\n\n` +
            `Uma encomenda recebida da *${params.carrier}* acabou de chegar para sua unidade (*${params.unitInfo}*).\n\n` +
            `🔑 *Código de Retirada:* \`${params.pickupCode}\`\n\n` +
            `_Você pode apresentar este código numérico ou o QR Code no seu aplicativo na portaria para retirar._\n\n` +
            `🏢 Portaria do Condomínio`;
        return this.sendMessage({
            phone: params.phone,
            message: text,
            mediaUrl: params.labelImageUrl,
            caption: `Foto da etiqueta da encomenda (${params.carrier})`
        });
    }
    /**
     * Envia notificação de confirmação de retirada
     */
    async notifyPackageDelivered(params) {
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
    async sendMessage(options) {
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
                    body: JSON.stringify(body)
                });
                if (!response.ok) {
                    // Fallback para texto simples se o envio de media falhar
                    return this.sendTextMessage(phone, options.message);
                }
                const data = await response.json();
                return { success: true, messageId: data?.key?.id || 'ok' };
            }
            else {
                return this.sendTextMessage(phone, options.message);
            }
        }
        catch (err) {
            console.error('[WhatsAppService] Falha ao comunicar com Evolution API:', err.message);
            return { success: false, error: err.message };
        }
    }
    async sendTextMessage(phone, text) {
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
                    text: text,
                    options: {
                        delay: 1200,
                        presence: 'composing'
                    }
                })
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.warn('[WhatsAppService] Resposta não-OK da Evolution API:', errorText);
                return { success: false, error: errorText };
            }
            const data = await response.json();
            return { success: true, messageId: data?.key?.id || 'ok' };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    /**
     * Verifica o status da instância na Evolution API
     */
    async checkInstanceStatus() {
        try {
            const url = `${this.apiUrl}/instance/connectionState/${this.instanceName}`;
            const response = await fetch(url, {
                headers: { 'apikey': this.apiKey }
            });
            if (!response.ok)
                return { state: 'DISCONNECTED', connected: false };
            const data = (await response.json());
            const state = data?.instance?.state || 'DISCONNECTED';
            return { state, connected: state === 'open' };
        }
        catch (e) {
            return { state: 'OFFLINE', connected: false };
        }
    }
}
export const whatsappService = new WhatsAppService();
