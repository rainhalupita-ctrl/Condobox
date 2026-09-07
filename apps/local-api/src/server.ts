import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { env, ABSOLUTE_STORAGE_DIR } from './config/env.js';
import { uploadRoutes } from './routes/upload.routes.js';
import { packageRoutes } from './routes/package.routes.js';
import { signatureRoutes } from './routes/signature.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { whatsappRoutes } from './routes/whatsapp.routes.js';
import { licenseRoutes } from './routes/license.routes.js';
import { utilitiesRoutes } from './routes/utilities.routes.js';
import { setupCleanupCron } from './services/cleanup.cron.js';
import { setupReminderCron } from './services/reminder.cron.js';
import { whatsAppQueueWorker } from './services/whatsapp-queue.worker.js';
import { whatsAppEngineService } from './services/whatsapp-engine.service.js';
import { syncService } from './services/sync.service.js';
import { databaseService } from './services/database.service.js';
import { BackupService } from './services/backup.service.js';
import { queueConsumerService } from './services/queue-consumer.service.js';

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const fastify = Fastify({
  logger: isServerless
    ? true
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        }
      }
});

async function main() {
  // 1. Plugins
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'Access-Control-Request-Private-Network']
  });

  fastify.addHook('onRequest', async (request, reply) => {
    if (request.headers['access-control-request-private-network']) {
      reply.header('Access-Control-Allow-Private-Network', 'true');
    }
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024 // 20MB max por imagem
    }
  });

  // 2. Servir arquivos estáticos do /data/packages na rota /images (se pasta existir)
  if (fs.existsSync(ABSOLUTE_STORAGE_DIR)) {
    await fastify.register(fastifyStatic, {
      root: ABSOLUTE_STORAGE_DIR,
      prefix: '/images/',
      decorateReply: false
    });
  }

  // 3. Servir frontend compilado estático se existir na pasta public / web
  const publicWebDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicWebDir)) {
    await fastify.register(fastifyStatic, {
      root: publicWebDir,
      prefix: '/',
      decorateReply: false
    });
  }

  // 3.5 Rota raiz amigável para diagnóstico e status
  fastify.get('/', async (_request, reply) => {
    return reply.send({
      status: 'OK',
      name: 'CondoBox Local API',
      version: '1.0.0',
      environment: isServerless ? 'Vercel Serverless' : 'Local PC Portaria',
      healthCheck: '/api/health',
      timestamp: new Date().toISOString()
    });
  });

  // 4. Rotas da API
  await fastify.register(healthRoutes);
  await fastify.register(whatsappRoutes);
  await fastify.register(uploadRoutes);
  await fastify.register(packageRoutes);
  await fastify.register(signatureRoutes);
  await fastify.register(licenseRoutes);
  await fastify.register(utilitiesRoutes);

  // 5. Inicializar Serviços em Segundo Plano (Apenas se NÃO for serverless)
  if (!isServerless) {
    setupCleanupCron(90);
    setupReminderCron();           // Lembretes autônomos diários (10h e 18h para encomendas > 24h)
    BackupService.init();
    whatsAppQueueWorker.start();  // Worker legado (polling packages existentes)
    syncService.start();           // Sincronização de unidades/moradores

    // Consumidor de Fila (Supabase → SQLite → WhatsApp)
    queueConsumerService.start();

    // Inicia motor de WhatsApp nativo em background
    whatsAppEngineService.initialize().catch((e) => {
      console.warn('[Server] Inicialização do WhatsApp em background:', e.message);
    });
  }

  // 6. Iniciar Servidor (Apenas se NÃO for serverless)
  if (!isServerless) {
    try {
      const address = await fastify.listen({ port: env.PORT, host: env.HOST });
      console.log(`\n🚀 [CondoBox All-in-One Engine] API da Portaria rodando em: ${address}`);
      console.log(`💾 [SQLite Database] Banco de dados local ativo em: ./data/condobox.db`);
      console.log(`📱 [WhatsApp Engine] Motor Baileys ativo (Sem necessidade de Docker)`);
      console.log(`📁 [Storage] Arquivos locais servidos em: ${env.LOCAL_BASE_URL}/images/`);
      console.log(`🔍 [Diagnóstico] Health Check em: ${env.LOCAL_BASE_URL}/api/health\n`);
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  }
}

// Inicializa a configuração do Fastify
const appReadyPromise = main().then(() => fastify.ready());

// Exporta handler compatível com o Vercel Serverless Function
export default async function handler(req: any, res: any) {
  await appReadyPromise;
  fastify.server.emit('request', req, res);
}
