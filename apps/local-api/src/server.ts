import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { env, ABSOLUTE_STORAGE_DIR } from './config/env.js';
import { uploadRoutes } from './routes/upload.routes.js';
import { packageRoutes } from './routes/package.routes.js';
import { signatureRoutes } from './routes/signature.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { setupCleanupCron } from './services/cleanup.cron.js';

const fastify = Fastify({
  logger: {
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
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  });

  await fastify.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024 // 20MB max por imagem
    }
  });

  // 2. Servir arquivos estáticos do /data/packages na rota /images
  await fastify.register(fastifyStatic, {
    root: ABSOLUTE_STORAGE_DIR,
    prefix: '/images/',
    decorateReply: false
  });

  // 3. Rotas da API
  await fastify.register(healthRoutes);
  await fastify.register(uploadRoutes);
  await fastify.register(packageRoutes);
  await fastify.register(signatureRoutes);

  // 4. Inicializar Cron de Limpeza de Fotos Antigas (90 dias)
  setupCleanupCron(90);

  // 5. Iniciar Servidor
  try {
    const address = await fastify.listen({ port: env.PORT, host: env.HOST });
    console.log(`\n🚀 [Local API] Servidor da Portaria rodando em: ${address}`);
    console.log(`📁 [Storage] Arquivos locais servidos em: ${env.LOCAL_BASE_URL}/images/`);
    console.log(`🔍 [Diagnóstico] Health Check em: ${env.LOCAL_BASE_URL}/api/health\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
