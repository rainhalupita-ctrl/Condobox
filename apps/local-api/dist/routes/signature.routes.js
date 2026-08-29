import { z } from 'zod';
import { storageService } from '../services/storage.service.js';
import { supabaseService } from '../services/supabase.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
const signaturePayloadSchema = z.object({
    packageId: z.string().uuid().or(z.string().min(1)),
    signatureBase64: z.string().min(10, 'Assinatura inválida'),
    deliveredToName: z.string().min(2, 'Nome do recebedor é obrigatório'),
    deliveredByUserId: z.string().uuid().optional().nullable(),
    sendWhatsAppConfirmation: z.boolean().default(true)
});
export async function signatureRoutes(fastify) {
    /**
     * POST /api/signature
     * Registra a assinatura digital de retirada e dá baixa na encomenda
     */
    fastify.post('/api/signature', async (request, reply) => {
        try {
            const body = signaturePayloadSchema.parse(request.body);
            // 1. Salva a imagem da assinatura no disco local (/data/packages/signatures/...)
            const stored = await storageService.saveSignatureImage(body.signatureBase64);
            // 2. Atualiza status no Supabase para DELIVERED
            const updatedPackage = await supabaseService.deliverPackage({
                packageId: body.packageId,
                signatureImagePath: stored.relativePath,
                deliveredToName: body.deliveredToName,
                deliveredByUserId: body.deliveredByUserId
            });
            let whatsappSent = false;
            // 3. Envia mensagem de confirmação via WhatsApp para o morador
            if (body.sendWhatsAppConfirmation && updatedPackage.resident?.phone) {
                const unitInfo = updatedPackage.unit
                    ? `Apto ${updatedPackage.unit.unit_number} - ${updatedPackage.unit.block}`
                    : 'Sua Unidade';
                const nowFormatted = new Date().toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                const notifyRes = await whatsappService.notifyPackageDelivered({
                    phone: updatedPackage.resident.phone,
                    residentName: updatedPackage.resident.name,
                    deliveredTo: body.deliveredToName,
                    unitInfo: unitInfo,
                    carrier: updatedPackage.carrier || 'Encomenda',
                    deliveredAt: nowFormatted
                });
                whatsappSent = notifyRes.success;
                // Log da notificação
                await supabaseService.logNotification({
                    packageId: body.packageId,
                    residentId: updatedPackage.resident_id,
                    phone: updatedPackage.resident.phone,
                    message: `Confirmação de retirada por ${body.deliveredToName}`,
                    status: notifyRes.success ? 'SENT' : 'FAILED',
                    error: notifyRes.error
                });
            }
            return reply.send({
                success: true,
                package: updatedPackage,
                signature: {
                    path: stored.relativePath,
                    url: stored.url
                },
                whatsappSent
            });
        }
        catch (err) {
            request.log.error(err);
            return reply.status(400).send({
                error: 'Erro ao registrar assinatura de retirada',
                details: err.errors || err.message
            });
        }
    });
}
