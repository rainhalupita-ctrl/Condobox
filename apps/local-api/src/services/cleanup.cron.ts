import cron from 'node-cron';
import { storageService } from './storage.service.js';

export function setupCleanupCron(retentionDays: number = 90) {
  // Executa todo dia às 03:00 da manhã
  cron.schedule('0 3 * * *', async () => {
    console.log(`[CleanupCron] Iniciando rotina de limpeza de etiquetas antigas (> ${retentionDays} dias)...`);
    try {
      const result = await storageService.cleanupOldLabels(retentionDays);
      console.log(`[CleanupCron] Limpeza concluída com sucesso. Total de arquivos removidos: ${result.deletedCount}`);
    } catch (error) {
      console.error('[CleanupCron] Erro durante a rotina de limpeza:', error);
    }
  });

  console.log(`[CleanupCron] Agendamento de limpeza de fotos ativado (Retenção: ${retentionDays} dias).`);
}
