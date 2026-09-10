import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { storageService } from '../services/storage.service.js';
import { databaseService } from '../services/database.service.js';
import { supabaseService } from '../services/supabase.service.js';
import { whatsappService } from '../services/whatsapp.service.js';

const signaturePayloadSchema = z.object({
  packageId: z.string().min(1),
  signatureBase64: z.string().min(10, 'Assinatura inválida'),
  deliveredToName: z.string().min(2, 'Nome do recebedor é obrigatório'),
  deliveredByUserId: z.string().optional().nullable(),
  sendWhatsAppConfirmation: z.boolean().default(true)
});

export async function signatureRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/signature
   * Registra a assinatura digital de retirada e dá baixa na encomenda localmente no SQLite
   */
  fastify.post('/api/signature', async (request, reply) => {
    try {
      const body = signaturePayloadSchema.parse(request.body);

      // 1. Salva a imagem da assinatura no disco local (/data/packages/signatures/...)
      const stored = await storageService.saveSignatureImage(body.signatureBase64);

      // 2. Atualiza status no SQLite local para DELIVERED
      const updatedPackage = databaseService.deliverPackage({
        packageId: body.packageId,
        signatureImagePath: stored.relativePath,
        deliveredToName: body.deliveredToName,
        deliveredByUserId: body.deliveredByUserId
      });

      if (!updatedPackage) {
        return reply.status(404).send({ error: 'Encomenda não encontrada no banco de dados' });
      }

      // 3. Se o Supabase estiver online, envia assinatura para a nuvem, atualiza e dispara Realtime
      if (supabaseService.isConfigured()) {
        let cloudSignaturePath = stored.relativePath;
        try {
          const client = supabaseService.getClient();
          const cleanBase64 = body.signatureBase64.replace(/^data:image\/\w+;base64,/, '');
          const buffer = Buffer.from(cleanBase64, 'base64');
          const sigFilename = `sig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.png`;
          const { data: upData, error: upErr } = await client.storage
            .from('signatures')
            .upload(sigFilename, buffer, { contentType: 'image/png', upsert: true });
          if (!upErr && upData) {
            cloudSignaturePath = `signatures/${sigFilename}`;
          }
        } catch (storageErr: any) {
          console.warn('[SignatureRoutes] Falha no upload para Supabase Storage:', storageErr.message);
        }

        supabaseService
          .deliverPackage({
            packageId: updatedPackage.id,
            qrToken: updatedPackage.qr_token,
            pickupCode: updatedPackage.pickup_code,
            signatureImagePath: cloudSignaturePath,
            deliveredToName: body.deliveredToName,
            deliveredByUserId: body.deliveredByUserId
          })
          .then(() => {
            databaseService.markPackageSynced(updatedPackage.id);
          })
          .catch((cloudErr: any) => {
            console.warn('[SignatureRoutes] Aviso ao atualizar entrega na nuvem:', cloudErr.message);
          });

        // Dispara broadcast Realtime instantâneo em TODOS os canais associados à encomenda
        try {
          const client = supabaseService.getClient();
          const channelsToNotify = [
            `public-package-${updatedPackage.id}`,
            `public-package-${updatedPackage.qr_token}`,
            `public-package-${updatedPackage.pickup_code}`,
            'packages-morador-live'
          ].filter(Boolean);

          for (const chName of channelsToNotify) {
            const ch = client.channel(chName);
            ch.subscribe((st: string) => {
              if (st === 'SUBSCRIBED') {
                ch.send({
                  type: 'broadcast',
                  event: 'status-updated',
                  payload: {
                    status: 'DELIVERED',
                    packageId: updatedPackage.id,
                    qrToken: updatedPackage.qr_token,
                    pickupCode: updatedPackage.pickup_code,
                    deliveredTo: body.deliveredToName,
                    deliveredAt: new Date().toISOString(),
                    signatureUrl: cloudSignaturePath
                  }
                }).then(() => {
                  setTimeout(() => client.removeChannel(ch), 3000);
                }).catch(() => {});
              }
            });
          }
        } catch (brErr: any) {
          console.warn('[SignatureRoutes] Aviso ao emitir broadcast Realtime:', brErr.message);
        }
      }

      let whatsappSent = false;

      // 4. Envia mensagem de confirmação via WhatsApp para o morador
      const residentPhone = updatedPackage.resident?.phone;
      if (body.sendWhatsAppConfirmation && residentPhone) {
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
          phone: residentPhone,
          residentName: updatedPackage.resident?.name || updatedPackage.delivered_to_name || 'Morador',
          deliveredTo: body.deliveredToName,
          unitInfo: unitInfo,
          carrier: updatedPackage.carrier || 'Encomenda',
          deliveredAt: nowFormatted
        });

        whatsappSent = notifyRes.success;
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
    } catch (err: any) {
      request.log.error(err);
      return reply.status(400).send({
        error: 'Erro ao registrar assinatura de retirada',
        details: err.errors || err.message
      });
    }
  });
}
