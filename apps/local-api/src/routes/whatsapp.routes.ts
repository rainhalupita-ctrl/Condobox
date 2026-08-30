import { FastifyInstance } from 'fastify';
import { whatsappService } from '../services/whatsapp.service.js';
import { env } from '../config/env.js';

export async function whatsappRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/whatsapp/status
   * Retorna o status de conexão da instância
   */
  fastify.get('/api/whatsapp/status', async (request, reply) => {
    const status = await whatsappService.checkInstanceStatus();
    return reply.send({
      apiUrl: env.EVOLUTION_API_URL,
      instance: env.EVOLUTION_INSTANCE_NAME,
      ...status
    });
  });

  /**
   * POST /api/whatsapp/connect
   * Inicializa a instância na Evolution API e retorna o QR Code para pareamento
   */
  fastify.post('/api/whatsapp/connect', async (request, reply) => {
    try {
      const url = `${env.EVOLUTION_API_URL}/instance/create`;
      
      // 1. Tenta criar a instância caso não exista
      const createRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.EVOLUTION_API_KEY
        },
        body: JSON.stringify({
          instanceName: env.EVOLUTION_INSTANCE_NAME,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS'
        })
      });

      // 2. Busca o QR Code de conexão
      const qrUrl = `${env.EVOLUTION_API_URL}/instance/connect/${env.EVOLUTION_INSTANCE_NAME}`;
      const qrRes = await fetch(qrUrl, {
        method: 'GET',
        headers: {
          'apikey': env.EVOLUTION_API_KEY
        }
      });

      const qrData = (await qrRes.json()) as any;

      return reply.send({
        success: true,
        qrcode: qrData?.base64 || qrData?.code || null,
        pairingCode: qrData?.pairingCode || null,
        instance: env.EVOLUTION_INSTANCE_NAME
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: 'Evolution API indisponível na porta 8080.',
        details: err.message
      });
    }
  });

  /**
   * POST /api/whatsapp/test
   * Envia mensagem de teste
   */
  fastify.post('/api/whatsapp/test', async (request, reply) => {
    const { phone } = (request.body as any) || {};
    if (!phone) {
      return reply.status(400).send({ error: 'Número de telefone obrigatório' });
    }

    const res = await whatsappService.sendMessage({
      phone,
      message: '🔔 *CondoBox WhatsApp Teste*\n\nConexão com a portaria configurada com sucesso com $0 de custo de API! 🎉'
    });

    return reply.send(res);
  });
}
