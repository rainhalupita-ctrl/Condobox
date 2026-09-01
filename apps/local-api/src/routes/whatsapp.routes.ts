import { FastifyInstance } from 'fastify';
import { whatsappService } from '../services/whatsapp.service.js';
import { whatsAppEngineService } from '../services/whatsapp-engine.service.js';

export async function whatsappRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/whatsapp/status
   * Retorna o status de conexão da instância e o QR Code em tempo real
   */
  fastify.get('/api/whatsapp/status', async (request, reply) => {
    const status = whatsAppEngineService.getStatus();
    return reply.send({
      success: true,
      engine: 'BAILEYS-NATIVE',
      ...status
    });
  });

  /**
   * POST /api/whatsapp/connect
   * Inicializa o motor de WhatsApp e gera/retorna o QR Code
   */
  fastify.post('/api/whatsapp/connect', async (request, reply) => {
    try {
      await whatsAppEngineService.initialize();

      // Aguarda até o QR Code ser gerado pelo Baileys (ou conexão ser restabelecida)
      let attempts = 0;
      while (!whatsAppEngineService.getStatus().qrcode && !whatsAppEngineService.getStatus().connected && attempts < 15) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
      }

      const status = whatsAppEngineService.getStatus();

      return reply.send({
        success: true,
        engine: 'BAILEYS-NATIVE',
        ...status
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: 'Erro ao inicializar motor de WhatsApp.',
        details: err.message
      });
    }
  });

  /**
   * POST /api/whatsapp/logout
   * Desconecta o WhatsApp e limpa a sessão local para permitir novo pareamento
   */
  fastify.post('/api/whatsapp/logout', async (request, reply) => {
    try {
      await whatsAppEngineService.logout();
      return reply.send({
        success: true,
        message: 'WhatsApp desconectado com sucesso.'
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * POST /api/whatsapp/test
   * Envia mensagem de teste
   */
  fastify.post('/api/whatsapp/test', async (request, reply) => {
    const { phone, message } = (request.body as any) || {};
    if (!phone) {
      return reply.status(400).send({ error: 'Telefone obrigatório' });
    }

    const res = await whatsappService.sendMessage({
      phone,
      message: message || '🤖 Teste de conexão do CondoBox Portaria!'
    });

    return reply.send(res);
  });
}
