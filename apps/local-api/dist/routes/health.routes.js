import { whatsappService } from '../services/whatsapp.service.js';
import { syncService } from '../services/sync.service.js';
import { supabaseService } from '../services/supabase.service.js';
import { env } from '../config/env.js';
export async function healthRoutes(fastify) {
    /**
     * GET /api/health
     * Diagnóstico em tempo real dos serviços locais e cloud
     */
    fastify.get('/api/health', async (_request, reply) => {
        const whatsappStatus = await whatsappService.checkInstanceStatus();
        const syncStatus = syncService.getStatus();
        const supabaseConfigured = supabaseService.isConfigured();
        const geminiConfigured = !!env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '';
        return reply.send({
            status: 'OK',
            timestamp: new Date().toISOString(),
            mode: 'ALL-IN-ONE-LOCAL',
            services: {
                database: {
                    type: 'SQLite (Local WAL)',
                    status: 'ACTIVE',
                    path: './data/condobox.db'
                },
                whatsapp: {
                    engine: 'Baileys-Native (No Docker Required)',
                    status: whatsappStatus.state,
                    connected: whatsappStatus.connected,
                    phone: whatsappStatus.phone || null
                },
                sync: {
                    status: syncStatus.isOnline ? 'ONLINE_SYNC' : 'OFFLINE_LOCAL',
                    isOnline: syncStatus.isOnline,
                    isSyncing: syncStatus.isSyncing,
                    cloudConfigured: supabaseConfigured
                },
                ocr: {
                    localTesseract: true,
                    cloudGemini: geminiConfigured
                },
                localBaseUrl: env.LOCAL_BASE_URL
            }
        });
    });
}
