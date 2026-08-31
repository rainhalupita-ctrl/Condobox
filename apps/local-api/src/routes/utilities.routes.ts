import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { BackupService } from '../services/backup.service.js';
import { ReportsService } from '../services/reports.service.js';
import { PrinterService, LabelPrintData } from '../services/printer.service.js';

export const utilitiesRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
  // 1. BACKUP
  server.post('/api/backup/create', async (_req, reply) => {
    try {
      const result = await BackupService.createBackup();
      return reply.send(result);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  server.get('/api/backup/list', async (_req, reply) => {
    try {
      const backups = BackupService.listBackups();
      return reply.send({ backups });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 2. RELATÓRIOS
  server.get('/api/reports/generate', async (_req, reply) => {
    try {
      const report = await ReportsService.generateReport();
      return reply.send(report);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  server.post<{ Body: { phone: string } }>('/api/reports/send-whatsapp', async (req, reply) => {
    try {
      const { phone } = req.body || {};
      if (!phone) {
        return reply.status(400).send({ error: 'Número de telefone é obrigatório' });
      }
      const result = await ReportsService.sendReportViaWhatsApp(phone);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // 3. IMPRESSÃO TÉRMICA
  server.post<{ Body: LabelPrintData }>('/api/printer/print-label', async (req, reply) => {
    try {
      const result = await PrinterService.printLabel(req.body);
      return reply.send(result);
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
};
