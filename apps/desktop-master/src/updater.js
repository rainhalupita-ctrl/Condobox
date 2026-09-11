const { app, dialog, shell } = require('electron');
const https = require('https');

const VERSION_CONFIG_URL = 'https://isurnvsehvjdslpnxirn.supabase.co/storage/v1/object/public/labels/system/version.json';

/**
 * Compara duas versões no formato semântico (ex: "1.0.1" > "1.0.0")
 */
function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const lParts = String(latest).replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
  const cParts = String(current).replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
    const l = lParts[i] || 0;
    const c = cParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

/**
 * Busca os dados de versão na nuvem via HTTPS
 */
function fetchRemoteVersion() {
  return new Promise((resolve) => {
    const url = `${VERSION_CONFIG_URL}?t=${Date.now()}`;
    const req = https.get(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Verifica atualizações e exibe a notificação com "Atualizar Agora" ou "Depois"
 */
async function checkForUpdates(mainWindow, appName = 'condobox-master') {
  try {
    const currentVersion = app.getVersion() || '1.0.0';
    console.log(`[Updater] Verificando atualizações para ${appName} (versão atual: v${currentVersion})...`);

    const config = await fetchRemoteVersion();
    if (!config || !config[appName]) {
      console.log('[Updater] Não foi possível obter informações de versão remota.');
      return;
    }

    const appInfo = config[appName];
    const latestVersion = appInfo.latest_version;

    if (isNewerVersion(latestVersion, currentVersion)) {
      console.log(`[Updater] Nova versão disponível: v${latestVersion} (atual: v${currentVersion})`);

      const friendlyName = appName === 'condobox-master' ? 'CondoBox SaaS Master' : 'CondoBox Portaria';
      const notes = appInfo.release_notes ? `Novidades desta versão:\n${appInfo.release_notes}\n\n` : '';
      const detailMsg = `${notes}Versão instalada: v${currentVersion}\nNova versão: v${latestVersion}\n\nDeseja realizar a atualização agora?`;

      const { response } = await dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Nova Versão Disponível!',
        message: `Uma nova versão do ${friendlyName} (v${latestVersion}) está disponível!`,
        detail: detailMsg,
        buttons: ['Atualizar Agora', 'Depois'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (response === 0) {
        // Usuário escolheu "Atualizar Agora"
        console.log('[Updater] Usuário escolheu "Atualizar Agora". Abrindo link:', appInfo.download_url);
        if (appInfo.download_url) {
          shell.openExternal(appInfo.download_url);
        }
      } else {
        console.log('[Updater] Usuário escolheu "Depois". Prosseguindo com execução normal.');
      }
    } else {
      console.log(`[Updater] Sistema já está na versão mais recente (v${currentVersion}).`);
    }
  } catch (err) {
    console.error('[Updater] Erro ao verificar atualizações:', err.message);
  }
}

module.exports = {
  checkForUpdates,
  isNewerVersion,
};
