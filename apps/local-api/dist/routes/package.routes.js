import { z } from 'zod';
import { supabaseService } from '../services/supabase.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { env } from '../config/env.js';
const createPackageSchema = z.object({
    unitId: z.string().uuid().or(z.string().min(1)),
    residentId: z.string().uuid().optional().nullable(),
    carrier: z.string().default('Outro'),
    trackingCode: z.string().optional().nullable(),
    recipientNameOcr: z.string().optional().nullable(),
    labelImagePath: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    sendWhatsApp: z.boolean().default(true),
    // Dados auxiliares para notificação se residentId não estiver associado
    residentPhone: z.string().optional().nullable(),
    residentName: z.string().optional().nullable(),
    unitInfo: z.string().optional().nullable()
});
export async function packageRoutes(fastify) {
    /**
     * POST /api/packages
     * Registra a encomenda e envia notificação no WhatsApp
     */
    fastify.post('/api/packages', async (request, reply) => {
        try {
            const body = createPackageSchema.parse(request.body);
            // 1. Grava no banco de dados Supabase
            const newPackage = await supabaseService.createPackage({
                unitId: body.unitId,
                residentId: body.residentId,
                carrier: body.carrier,
                trackingCode: body.trackingCode,
                recipientNameOcr: body.recipientNameOcr,
                labelImagePath: body.labelImagePath,
                notes: body.notes
            });
            let whatsappSent = false;
            let whatsappError = null;
            // 2. Se marcado para enviar WhatsApp e temos os dados de contato
            if (body.sendWhatsApp) {
                let phone = body.residentPhone;
                let name = body.residentName || 'Morador';
                let unitText = body.unitInfo || 'sua unidade';
                // Se o residentId foi passado mas não veio o telefone direto, busca do banco
                if (!phone && body.residentId && supabaseService.isConfigured()) {
                    const { data: res } = await supabaseService.getClient()
                        .from('residents')
                        .select('name, phone')
                        .eq('id', body.residentId)
                        .single();
                    if (res) {
                        phone = res.phone;
                        name = res.name;
                    }
                }
                if (phone) {
                    const labelUrl = body.labelImagePath
                        ? `${env.LOCAL_BASE_URL}/images/${body.labelImagePath}`
                        : undefined;
                    const notifyRes = await whatsappService.notifyPackageArrival({
                        phone,
                        residentName: name,
                        unitInfo: unitText,
                        carrier: body.carrier,
                        pickupCode: newPackage.pickup_code,
                        labelImageUrl: labelUrl
                    });
                    whatsappSent = notifyRes.success;
                    whatsappError = notifyRes.error;
                    // Grava log da notificação
                    await supabaseService.logNotification({
                        packageId: newPackage.id,
                        residentId: body.residentId,
                        phone,
                        message: `Notificação de chegada - Código: ${newPackage.pickup_code}`,
                        status: notifyRes.success ? 'SENT' : 'FAILED',
                        error: notifyRes.error
                    });
                }
            }
            return reply.status(201).send({
                success: true,
                package: newPackage,
                whatsapp: {
                    sent: whatsappSent,
                    error: whatsappError
                }
            });
        }
        catch (err) {
            request.log.error(err);
            return reply.status(400).send({
                error: 'Erro ao registrar encomenda',
                details: err.errors || err.message
            });
        }
    });
    /**
     * GET /api/packages/search
     * Busca rápida para autocomplete ou checagem na portaria
     */
    fastify.get('/api/packages/search', async (request, reply) => {
        const { q, status } = request.query;
        if (!supabaseService.isConfigured()) {
            return reply.send({ packages: [] });
        }
        let query = supabaseService.getClient()
            .from('packages')
            .select('*, unit:units(*), resident:residents(*)')
            .order('received_at', { ascending: false });
        if (status) {
            query = query.eq('status', status);
        }
        if (q) {
            query = query.or(`pickup_code.ilike.%${q}%,recipient_name_ocr.ilike.%${q}%,tracking_code.ilike.%${q}%`);
        }
        const { data, error } = await query.limit(50);
        if (error) {
            return reply.status(500).send({ error: error.message });
        }
        return reply.send({ packages: data });
    });
}
