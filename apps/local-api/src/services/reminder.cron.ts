import cron from 'node-cron';
import { databaseService } from './database.service.js';
import { whatsAppEngineService } from './whatsapp-engine.service.js';
import { supabaseService } from './supabase.service.js';

export class ReminderCronService {
  private isRunning: boolean = false;

  /**
   * Executa a rotina de envio de lembretes para encomendas paradas
   * @param minHoursAge Idade mínima da encomenda em horas (padrão: 24 horas)
   */
  public async processPendingReminders(minHoursAge: number = 24): Promise<{
    checkedCount: number;
    remindersSent: number;
    errors: string[];
  }> {
    if (this.isRunning) {
      console.log('⏳ [Reminder Cron] Rotina de lembretes já está em execução. Pulando...');
      return { checkedCount: 0, remindersSent: 0, errors: [] };
    }

    this.isRunning = true;
    const errors: string[] = [];
    let remindersSent = 0;

    try {
      if (!whatsAppEngineService.isConnected()) {
        console.log('⚠️ [Reminder Cron] WhatsApp desconectado. Lembretes não disparados.');
        return { checkedCount: 0, remindersSent: 0, errors: ['WhatsApp desconectado'] };
      }

      const allPackages = databaseService.getAllPackages();
      const now = Date.now();
      const minAgeMs = minHoursAge * 60 * 60 * 1000;

      // Filtra estritamente encomendas pendentes (RECEIVED ou NOTIFIED) recebidas há mais de minHoursAge
      // Bloqueia DELIVERED, RETURNED ou qualquer encomenda que não esteja aguardando retirada
      const pendingPackages = allPackages.filter((pkg) => {
        if (pkg.status !== 'RECEIVED' && pkg.status !== 'NOTIFIED') return false;
        const receivedTime = new Date(pkg.received_at).getTime();
        return now - receivedTime >= minAgeMs;
      });

      console.log(`🔍 [Reminder Cron] Encontradas ${pendingPackages.length} encomendas elegíveis com mais de ${minHoursAge}h na portaria.`);

      for (const pkg of pendingPackages) {
        try {
          // 🛑 TRAVA DE SEGURANÇA: Validação prévia com o Supabase (Nuvem)
          // Impede expressamente o envio de lembretes para encomendas excluídas ou com status alterado
          if (supabaseService.isConfigured()) {
            try {
              const client = supabaseService.getClient();
              const { data: cloudPkg, error: cloudErr } = await client
                .from('packages')
                .select('id, status')
                .eq('id', pkg.id)
                .maybeSingle();

              if (!cloudErr) {
                // Se a encomenda NÃO existe mais na nuvem (foi excluída definitivamente)
                if (!cloudPkg) {
                  console.warn(`🛑 [Reminder Cron] Trava acionada: Encomenda ${pkg.id} (${pkg.pickup_code} - ${pkg.carrier}) foi EXCLUÍDA do sistema. Removendo do banco local e abortando envio.`);
                  databaseService.deletePackage(pkg.id);
                  continue;
                }

                // Se a encomenda já foi entregue ou devolvida na nuvem
                if (cloudPkg.status !== 'RECEIVED' && cloudPkg.status !== 'NOTIFIED') {
                  console.warn(`🛑 [Reminder Cron] Trava acionada: Encomenda ${pkg.id} (${pkg.pickup_code}) não está mais pendente na nuvem (status: ${cloudPkg.status}). Atualizando SQLite local e abortando.`);
                  databaseService.updatePackageStatus(pkg.id, cloudPkg.status);
                  continue;
                }
              }
            } catch (checkErr: any) {
              console.warn(`⚠️ [Reminder Cron] Falha ao verificar nuvem para pacote ${pkg.id}:`, checkErr.message);
            }
          }

          // Busca morador associado
          let resident = pkg.resident_id ? databaseService.getResidentById(pkg.resident_id) : null;
          if (!resident && pkg.unit_id) {
            const residents = databaseService.getResidentsByUnit(pkg.unit_id);
            resident = residents.find((r) => r.is_primary === 1) || residents[0] || null;
          }

          if (!resident || !resident.phone) {
            continue;
          }

          // Verifica se já enviamos um lembrete nas últimas 20 horas para este pacote
          const recentLogs = databaseService.getNotificationsLogByPackageId(pkg.id);
          const hasRecentReminder = recentLogs.some((log) => {
            const isReminder = (log as any).notification_type === 'REMINDER' || log.status === 'REMINDER_SENT';
            const logTime = new Date(log.sent_at || log.created_at).getTime();
            return isReminder && now - logTime < 20 * 60 * 60 * 1000;
          });

          if (hasRecentReminder) {
            continue; // Já lembrou recentemente
          }

          const unit = pkg.unit_id ? databaseService.getUnitById(pkg.unit_id) : null;
          const unitInfo = unit ? `${unit.block} - Apto ${unit.unit_number}` : 'Unidade';

          const formattedDate = new Date(pkg.received_at).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });

          console.log(`⏰ [Reminder Cron] Enviando lembrete autônomo para ${resident.name} (${resident.phone}) - Apto ${unitInfo}`);

          const result = await whatsAppEngineService.notifyPackageReminder({
            phone: resident.phone,
            residentName: resident.name,
            unitInfo,
            carrier: pkg.carrier,
            pickupCode: pkg.pickup_code,
            receivedAt: formattedDate,
            qrToken: pkg.qr_token
          });

          if (result.success) {
            remindersSent++;
            databaseService.logNotification({
              packageId: pkg.id,
              residentId: resident.id,
              channel: 'WHATSAPP',
              recipient: resident.phone,
              status: 'SENT',
              sentAt: new Date().toISOString()
            });
            // Delay suave entre disparos para respeitar taxa do WhatsApp
            await new Promise((resolve) => setTimeout(resolve, 3000));
          } else {
            errors.push(`Erro ao enviar para ${resident.name}: ${result.error}`);
          }
        } catch (itemErr: any) {
          errors.push(`Erro no pacote ${pkg.id}: ${itemErr.message}`);
        }
      }

      console.log(`✅ [Reminder Cron] Rotina concluída! Total de lembretes enviados: ${remindersSent}`);
      return { checkedCount: pendingPackages.length, remindersSent, errors };
    } catch (err: any) {
      console.error('❌ [Reminder Cron] Erro durante a execução da rotina:', err.message);
      errors.push(err.message);
      return { checkedCount: 0, remindersSent: 0, errors };
    } finally {
      this.isRunning = false;
    }
  }
}

export const reminderCronService = new ReminderCronService();

/**
 * Inicializa o agendamento de lembretes autônomos (executado às 10:00 e às 18:00)
 */
export function setupReminderCron() {
  // Dispara todo dia às 10h e às 18h
  cron.schedule('0 10,18 * * *', async () => {
    console.log('⏰ [Reminder Cron] Iniciando disparo agendado de lembretes autônomos...');
    await reminderCronService.processPendingReminders(24);
  });

  console.log('⏰ [Reminder Cron] Agendamento de lembretes autônomos ativado (Execuções diárias às 10:00 e 18:00).');
}
