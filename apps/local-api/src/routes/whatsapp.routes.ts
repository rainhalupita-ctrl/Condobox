import { FastifyInstance } from 'fastify';
import { whatsappService } from '../services/whatsapp.service.js';
import { whatsAppEngineService } from '../services/whatsapp-engine.service.js';
import { deliveryBatcherService } from '../services/delivery-batcher.service.js';

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
   * POST & GET /api/whatsapp/connect
   * Inicializa o motor de WhatsApp e gera/retorna o QR Code
   */
  const connectHandler = async (_request: any, reply: any) => {
    try {
      await whatsAppEngineService.initialize();

      // Aguarda até o QR Code ser gerado pelo Baileys (ou conexão ser restabelecida)
      let attempts = 0;
      while (!whatsAppEngineService.getStatus().qrcode && !whatsAppEngineService.getStatus().connected && attempts < 40) {
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
  };

  fastify.post('/api/whatsapp/connect', connectHandler);
  fastify.get('/api/whatsapp/connect', connectHandler);

  /**
   * POST & GET /api/whatsapp/logout
   * Desconecta o WhatsApp e limpa a sessão local para permitir novo pareamento
   */
  const logoutHandler = async (_request: any, reply: any) => {
    try {
      await whatsAppEngineService.logout();

      // Aguarda brevemente a emissão do novo QR code para novo pareamento
      let attempts = 0;
      while (!whatsAppEngineService.getStatus().qrcode && attempts < 30) {
        await new Promise(r => setTimeout(r, 200));
        attempts++;
      }

      const status = whatsAppEngineService.getStatus();
      return reply.send({
        success: true,
        message: 'WhatsApp desconectado com sucesso. Novo QR Code gerado para pareamento.',
        ...status
      });
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        error: err.message
      });
    }
  };

  fastify.post('/api/whatsapp/logout', logoutHandler);
  fastify.get('/api/whatsapp/logout', logoutHandler);

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

  /**
   * POST /api/delivery-batch/flush
   * Força o envio imediato do lote pendente de retiradas (para um morador ou todos)
   */
  fastify.post('/api/delivery-batch/flush', async (request, reply) => {
    const { phone, condoId } = (request.body as any) || {};

    if (phone) {
      const flushed = await deliveryBatcherService.flushBatchForPhone(phone, condoId);
      return reply.send({
        success: true,
        flushed,
        message: flushed
          ? `Lote de retirada para o telefone ${phone} disparado com sucesso.`
          : `Nenhum lote pendente encontrado para o telefone ${phone}.`
      });
    }

    await deliveryBatcherService.flushAll();
    return reply.send({
      success: true,
      flushed: true,
      message: 'Todos os lotes de retiradas pendentes foram disparados.'
    });
  });
}
