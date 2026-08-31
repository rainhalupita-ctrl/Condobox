import path from 'path';
import { spawn } from 'child_process';
import { databaseService } from './database.service.js';
import { whatsappService } from './whatsapp.service.js';

export interface ReportResult {
  generatedAt: string;
  metrics: {
    totalPackages: number;
    delivered: number;
    pending: number;
    units: number;
    residents: number;
    topCarriers: Array<{ carrier: string; count: number }>;
  };
  reportText: string;
}

export class ReportsService {
  /**
   * Gera o relatório da portaria usando Python ou SQLite direto
   */
  public static async generateReport(): Promise<ReportResult> {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '../../scripts/python/generate_report.py');

      const pyProcess = spawn('python', [scriptPath], { windowsHide: true });

      let output = '';

      pyProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pyProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const data = JSON.parse(output);
            if (data && data.success) {
              return resolve(data);
            }
          } catch {}
        }

        // Fallback SQLite direto em Node.js
        const fallback = this.generateFallbackReport();
        resolve(fallback);
      });

      pyProcess.on('error', () => {
        const fallback = this.generateFallbackReport();
        resolve(fallback);
      });
    });
  }

  /**
   * Envia o relatório gerado diretamente para o WhatsApp do Síndico / Gestor
   */
  public static async sendReportViaWhatsApp(phone: string): Promise<{ success: boolean; error?: string }> {
    const report = await this.generateReport();
    return await whatsappService.sendMessage({ phone, message: report.reportText });
  }

  private static generateFallbackReport(): ReportResult {
    const { units, residents } = databaseService.getUnitsAndResidents();
    const recentPackages = databaseService.listRecentPackages(500);

    const totalPackages = recentPackages.length;
    const delivered = recentPackages.filter((p: any) => p.status === 'DELIVERED').length;
    const pending = recentPackages.filter((p: any) => p.status !== 'DELIVERED').length;

    const carrierCounts: Record<string, number> = {};
    recentPackages.forEach((p: any) => {
      carrierCounts[p.carrier] = (carrierCounts[p.carrier] || 0) + 1;
    });

    const topCarriers = Object.entries(carrierCounts)
      .map(([carrier, count]) => ({ carrier, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const nowStr = new Date().toLocaleString('pt-BR');

    let reportText = `📊 *RELATÓRIO DE FLUXO DA PORTARIA - CONDOBOX*\n`;
    reportText += `🗓️ Data: ${nowStr}\n\n`;
    reportText += `📦 *ENCOMENDAS:*\n`;
    reportText += `• Total Registradas: ${totalPackages}\n`;
    reportText += `• Entregues: ${delivered}\n`;
    reportText += `• Pendentes: ${pending}\n\n`;

    if (topCarriers.length > 0) {
      reportText += `🚚 *PRINCIPAIS TRANSPORTADORAS:*\n`;
      topCarriers.forEach(c => {
        reportText += `• ${c.carrier}: ${c.count} pacote(s)\n`;
      });
      reportText += `\n`;
    }

    reportText += `🏢 *CADASTROS:*\n`;
    reportText += `• Apartamentos: ${units.length}\n`;
    reportText += `• Moradores: ${residents.length}\n\n`;
    reportText += `_Sistema CondoBox Portaria Inteligente_`;

    return {
      generatedAt: nowStr,
      metrics: {
        totalPackages,
        delivered,
        pending,
        units: units.length,
        residents: residents.length,
        topCarriers
      },
      reportText
    };
  }
}
