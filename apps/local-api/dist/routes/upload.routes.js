import { storageService } from '../services/storage.service.js';
import { ocrService } from '../services/ocr.service.js';
import { supabaseService } from '../services/supabase.service.js';
export async function uploadRoutes(fastify) {
    /**
     * POST /api/upload
     * Recebe multipart file da etiqueta, salva em disco e processa OCR com Gemini
     */
    fastify.post('/api/upload', async (request, reply) => {
        try {
            const data = await request.file();
            if (!data) {
                return reply.status(400).send({ error: 'Nenhum arquivo de imagem enviado' });
            }
            const buffer = await data.toBuffer();
            const ext = data.filename.split('.').pop() || 'jpg';
            // 1. Salva a imagem no disco local da portaria (/data/packages/labels/...)
            const stored = await storageService.saveLabelImage(buffer, ext);
            // 2. Extrai informações com o Gemini Vision
            const ocrResult = await ocrService.extractPackageInfo(buffer, data.mimetype);
            // 3. Tenta localizar a unidade e morador automaticamente no banco
            const matched = await supabaseService.matchResidentFromOCR({
                unitNumber: ocrResult.unitNumber,
                block: ocrResult.block,
                recipientName: ocrResult.recipientName
            });
            return reply.send({
                success: true,
                image: {
                    path: stored.relativePath,
                    url: stored.url
                },
                ocr: ocrResult,
                suggestedMatch: {
                    unit: matched.unit,
                    resident: matched.resident
                }
            });
        }
        catch (err) {
            request.log.error(err);
            return reply.status(500).send({
                error: 'Falha ao processar upload e OCR',
                details: err.message
            });
        }
    });
}
