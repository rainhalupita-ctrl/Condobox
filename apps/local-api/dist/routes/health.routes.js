import { whatsappService } from '../services/whatsapp.service.js';
import { supabaseService } from '../services/supabase.service.js';
import { env } from '../config/env.js';
export async function healthRoutes(fastify) {
    /**
     * GET /api/health
     * Diagnóstico em tempo real dos serviços locais e cloud
     */
    fastify.get('/api/health', async (_request, reply) => {
        const whatsappStatus = await whatsappService.checkInstanceStatus();
        const supabaseConfigured = supabaseService.isConfigured();
        const geminiConfigured = !!env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '';
        return reply.send({
            status: 'OK',
            timestamp: new Date().toISOString(),
            services: {
                whatsapp: {
                    status: whatsappStatus.state,
                    connected: whatsappStatus.connected,
                    instance: env.EVOLUTION_INSTANCE_NAME
                },
                supabase: {
                    configured: supabaseConfigured,
                    url: env.SUPABASE_URL
                },
                geminiOCR: {
                    configured: geminiConfigured
                },
                localBaseUrl: env.LOCAL_BASE_URL
            }
        });
    });
}
