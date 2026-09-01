const { app, BrowserWindow, session, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Desabilitar aceleração de hardware ANTES do app estar pronto para evitar bugs com webcams antigas/DWM
app.disableHardwareAcceleration();

// Define App User Model ID no Windows para o ícone fixar corretamente na Barra de Tarefas
if (process.platform === "win32") {
  app.setAppUserModelId("com.condobox.desktop");
}

let apiProcess;
let splashWindow;
let mainWindow;

function getAppIcon() {
  const icoPath = path.join(__dirname, "..", "assets", "icon.ico");
  const pngPath = path.join(__dirname, "..", "assets", "icon.png");

  if (fs.existsSync(icoPath)) {
    return nativeImage.createFromPath(icoPath);
  }
  if (fs.existsSync(pngPath)) {
    return nativeImage.createFromPath(pngPath);
  }
  return undefined;
}

function createSplash() {
  const icon = getAppIcon();

  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // Forçar fundo transparente nativo no Windows para evitar tela branca
    resizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: false,
    icon: icon,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  if (icon) {
    splashWindow.setIcon(icon);
  }

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

function createWindow() {
  const icon = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#020617', // Cor de fundo combinando com bg-slate-950
      symbolColor: '#cbd5e1', // Cor dos botões
      height: 40 // Altura da barra
    },
    title: "CondoBox Portaria - Sistema All-in-One",
    show: false,
    icon: icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // Permite carregar recursos de API e câmeras locais
    },
  });

  if (icon) {
    mainWindow.setIcon(icon);
  }

  // Remove menus de contexto de navegador e desabilita arrasto de links/imagens
  mainWindow.webContents.on("dom-ready", () => {
    mainWindow.webContents.insertCSS(`
      * {
        -webkit-user-drag: none !important;
        user-drag: none !important;
        -webkit-touch-callout: none !important;
      }
      body {
        -webkit-user-select: none !important;
        user-select: none !important;
      }
      input, textarea, [contenteditable="true"] {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
      a, button, img {
        -webkit-user-drag: none !important;
        user-drag: none !important;
      }
    `);
  });

  // Tenta carregar a URL local primeiro ou a URL da Vercel
  const primaryUrl = "https://web-eight-rust-97.vercel.app/portaria";
  const localFallbackUrl = "http://localhost:3001/portaria";

  mainWindow.loadURL(primaryUrl).catch(() => {
    console.log("⚠️ Alternando para porta local:", localFallbackUrl);
    mainWindow.loadURL(localFallbackUrl).catch(() => {});
  });

  // Fallback se a internet cair durante o carregamento
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL !== localFallbackUrl) {
      console.warn(`[CondoBox] Falha de rede (${errorCode}: ${errorDescription}). Alternando para porta local...`);
      mainWindow.loadURL(localFallbackUrl).catch(() => {});
    }
  });

  // Assim que a janela principal termina de carregar, esconde o splash e mostra a principal
  mainWindow.once("ready-to-show", () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, 4500);
  });

  mainWindow.on("closed", () => {
    app.quit();
  });
}

function startLocalApi() {
  const isDev = !app.isPackaged;

  const scriptPath = isDev
    ? path.join(__dirname, "../../local-api/dist/server.js")
    : path.join(process.resourcesPath, "app.asar.unpacked/node_modules/condo-local-api/dist/server.js");

  // Configuração segura embutida (protegida dentro do ASAR binário)
  let embeddedEnv = {};
  try {
    embeddedEnv = require("./embedded-env.js");
  } catch {}

  const envPath = isDev
    ? path.join(__dirname, "../../local-api/.env")
    : path.join(process.resourcesPath, ".env");

  let envVars = { ...process.env, ...embeddedEnv, PORT: "3001" };
  if (fs.existsSync(envPath)) {
    try {
      const envContent = fs.readFileSync(envPath, "utf-8");
      envContent.split("\n").forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          envVars[match[1].trim()] = match[2].trim();
        }
      });
    } catch {}
  }

  if (!fs.existsSync(scriptPath)) {
    console.warn("[CondoBox] Script da API local não encontrado em:", scriptPath);
    return;
  }

  console.log("[CondoBox] Iniciando API Local em:", scriptPath);

  apiProcess = spawn("node", [scriptPath], {
    env: envVars,
    stdio: "inherit",
    windowsHide: true,
    detached: false,
  });

  apiProcess.on("error", (err) => {
    console.error("[CondoBox] Erro no processo da API local:", err);
  });

  apiProcess.on("exit", (code) => {
    console.log(`[CondoBox] Processo da API local finalizado com código ${code}`);
  });
}

app.whenReady().then(() => {
  // Permissão automática para câmera e microfone
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Força aceitação de qualquer mídia (câmera/microfone)
    callback(true);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return true;
  });

  startLocalApi();
  createSplash();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (apiProcess) { try { apiProcess.kill(); } catch {} }
    app.quit();
  }
});

app.on("before-quit", () => {
  if (apiProcess) { try { apiProcess.kill(); } catch {} }
});
