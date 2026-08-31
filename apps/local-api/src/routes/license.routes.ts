import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { licenseService } from '../services/license.service.js';
import { adsService } from '../services/ads.service.js';
import { databaseService } from '../services/database.service.js';

export async function licenseRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/license/status
   * Retorna o status de licenciamento, plano e cota de unidades
   */
  fastify.get('/api/license/status', async (request, reply) => {
    try {
      const { condoId } = (request.query as { condoId?: string }) || {};
      const subscription = await licenseService.getSubscription(condoId);
      const { units } = databaseService.getUnitsAndResidents(condoId);
      const currentCount = units.length;

      const unitCheck = await licenseService.canRegisterMoreUnits(currentCount, condoId);

      return reply.send({
        success: true,
        subscription,
        unitsUsage: {
          current: currentCount,
          max: unitCheck.maxUnits,
          canAddMore: unitCheck.allowed,
          percentage: Math.min(100, Math.round((currentCount / unitCheck.maxUnits) * 100))
        }
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/license/activate
   * Ativa a licença da portaria através de uma Chave de Licença (License Key)
   */
  fastify.post('/api/license/activate', async (request, reply) => {
    try {
      const body = z.object({
        licenseKey: z.string().min(10),
        condoId: z.string().optional()
      }).parse(request.body);

      const result = await licenseService.activateLicenseKey(body.licenseKey, body.condoId);

      if (!result.success) {
        return reply.status(400).send(result);
      }

      return reply.send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * POST /api/license/generate
   * Gera chave de licença (Endpoint exclusivo do Super Admin)
   */
  fastify.post('/api/license/generate', async (request, reply) => {
    try {
      const body = z.object({
        condoId: z.string().min(1),
        planId: z.enum(['BASIC', 'PRO', 'PRO_MAX']),
        daysValid: z.number().int().min(1).default(30)
      }).parse(request.body);

      const key = licenseService.generateLicenseKey(body.condoId, body.planId, body.daysValid);

      return reply.send({
        success: true,
        licenseKey: key,
        condoId: body.condoId,
        planId: body.planId,
        daysValid: body.daysValid
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  /**
   * GET /api/ads/active
   * Retorna anúncio ativo para exibição no frontend (Plano BASIC)
   */
  fastify.get('/api/ads/active', async (_request, reply) => {
    try {
      const ad = await adsService.getActiveAd();
      return reply.send({ success: true, ad });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * POST /api/ads/:id/click
   * Registra clique no anúncio
   */
  fastify.post('/api/ads/:id/click', async (request, reply) => {
    const { id } = request.params as { id: string };
    await adsService.registerClick(id);
    return reply.send({ success: true });
  });
}
