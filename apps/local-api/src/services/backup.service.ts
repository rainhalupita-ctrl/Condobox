import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

export interface BackupItem {
  filename: string;
  filepath: string;
  sizeKb: number;
  createdAt: string;
}

export class BackupService {
  private static backupsDir = path.join(process.cwd(), 'data', 'backups');

  public static init() {
    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }

    // Executa verificação diária de backup
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === 23 && now.getMinutes() === 0) {
        console.log('[BackupService] Executando backup diário agendado...');
        this.createBackup().catch(err => console.error('[BackupService] Erro no backup agendado:', err));
      }
    }, 60000);
  }

  public static async createBackup(): Promise<{ success: boolean; filename?: string; sizeKb?: number; error?: string }> {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '../../scripts/python/backup_sqlite.py');

      // Tenta executar via Python
      const pyProcess = spawn('python', [scriptPath], { windowsHide: true });

      let output = '';
      let errorOutput = '';

      pyProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      pyProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      pyProcess.on('close', (code) => {
        if (code === 0 && output.includes('FILE:')) {
          const match = output.match(/FILE:(.+)/);
          const fullPath = match ? match[1].trim() : '';
          const filename = path.basename(fullPath);
          const sizeKb = fs.existsSync(fullPath) ? Math.round(fs.statSync(fullPath).size / 1024) : 0;

          console.log(`[BackupService] Backup criado com sucesso: ${filename} (${sizeKb} KB)`);
          return resolve({ success: true, filename, sizeKb });
        }

        // Fallback direto em Node.js caso o Python não esteja instalado na máquina
        try {
          const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
          const filename = `condobox_backup_${timestamp}.db`;
          const destPath = path.join(this.backupsDir, filename);
          const srcPath = path.join(process.cwd(), 'data', 'condobox.db');

          if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            const sizeKb = Math.round(fs.statSync(destPath).size / 1024);
            return resolve({ success: true, filename, sizeKb });
          } else {
            return resolve({ success: false, error: 'Banco de dados condobox.db não encontrado' });
          }
        } catch (err: any) {
          return resolve({ success: false, error: err.message });
        }
      });

      pyProcess.on('error', () => {
        // Fallback Node direto
        try {
          const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
          const filename = `condobox_backup_${timestamp}.db`;
          const destPath = path.join(this.backupsDir, filename);
          const srcPath = path.join(process.cwd(), 'data', 'condobox.db');

          if (fs.existsSync(srcPath)) {
            fs.copyFileSync(srcPath, destPath);
            const sizeKb = Math.round(fs.statSync(destPath).size / 1024);
            return resolve({ success: true, filename, sizeKb });
          }
          resolve({ success: false, error: 'Falha ao copiar banco' });
        } catch (err: any) {
          resolve({ success: false, error: err.message });
        }
      });
    });
  }

  public static listBackups(): BackupItem[] {
    if (!fs.existsSync(this.backupsDir)) return [];

    const files = fs.readdirSync(this.backupsDir);
    return files
      .filter(f => f.startsWith('condobox_backup_'))
      .map(filename => {
        const filepath = path.join(this.backupsDir, filename);
        const stats = fs.statSync(filepath);
        return {
          filename,
          filepath,
          sizeKb: Math.round(stats.size / 1024),
          createdAt: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}
