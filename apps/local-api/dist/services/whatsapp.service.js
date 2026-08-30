import os from 'os';
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
     * Obtém a URL pública ou o IP de rede da máquina para que o celular no Wi-Fi/4G consiga abrir
     */
    getPublicWebUrl() {
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
        }
        catch {
            // Fallback para o valor configurado
        }
        return (env.WEB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
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
     * Registra webhook na Evolution API para receber respostas dos moradores
     */
    async ensureWebhookConfigured() {
        try {
            const webhookEndpoint = `${this.apiUrl}/webhook/set/${this.instanceName}`;
            const webhookUrl = 'http://host.docker.internal:3001/api/whatsapp/webhook';
            await fetch(webhookEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.apiKey
                },
                body: JSON.stringify({
                    webhook: {
                        enabled: true,
                        url: webhookUrl,
                        events: ['MESSAGES_UPSERT']
                    }
                }),
                signal: AbortSignal.timeout(8000)
            });
            console.log('🔗 [WhatsAppService] Webhook registrado com sucesso na Evolution API.');
        }
        catch (err) {
            console.warn('[WhatsAppService] Aviso ao registrar webhook na Evolution API:', err.message);
        }
    }
    /**
     * Envia notificação de chegada de encomenda com link 1-clique wa.me para confirmar ciência
     */
    async notifyPackageArrival(params) {
        const webBaseUrl = this.getPublicWebUrl();
        const token = params.qrToken || params.pickupCode;
        const pickupUrl = `${webBaseUrl}/p/${token}`;
        const portariaPhone = process.env.WHATSAPP_PORTARIA_NUMBER || '557398419901';
        const waConfirmLink = `https://wa.me/${portariaPhone}?text=${encodeURIComponent(`Estou ciente da encomenda ${params.pickupCode}`)}`;
        const text = `📦 *NOVA ENCOMENDA CHEGOU NA PORTARIA!*\n\n` +
            `Olá, *${params.residentName}*!\n\n` +
            `Uma encomenda de *${params.carrier}* acabou de ser recebida na portaria para sua unidade (*${params.unitInfo}*).\n\n` +
            `🔑 *Código de Retirada:* *${params.pickupCode}*\n\n` +
            `👇 *Toque no link abaixo para responder que está ciente (1 clique):*\n` +
            `${waConfirmLink}\n\n` +
            `📱 *Link com QR Code de retirada:*\n` +
            `${pickupUrl}\n\n` +
            `_Apresente o QR Code ou informe o código de 4 dígitos na portaria._\n\n` +
            `🏢 Portaria do Condomínio`;
        return this.sendMessage({
            phone: params.phone,
            message: text,
            mediaUrl: params.labelImageUrl,
            caption: text
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
            // Se houver imagem, envia media (Evolution API v2)
            if (options.mediaUrl) {
                const url = `${this.apiUrl}/message/sendMedia/${this.instanceName}`;
                const body = {
                    number: phone,
                    media: options.mediaUrl,
                    mediatype: 'image',
                    mimetype: 'image/jpeg',
                    caption: options.message,
                    fileName: 'etiqueta.jpg'
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
                    const errorText = await response.text().catch(() => '');
                    console.warn('[WhatsAppService] Falha no sendMedia da Evolution API, tentando fallback text:', errorText);
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
                headers: { 'apikey': this.apiKey },
                signal: AbortSignal.timeout(5000)
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
