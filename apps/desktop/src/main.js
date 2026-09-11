const { app, BrowserWindow, session, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { checkForUpdates } = require("./updater");

// Desabilitar aceleração de hardware ANTES do app estar pronto para evitar bugs com webcams antigas/DWM
app.disableHardwareAcceleration();

// Permite requisições de HTTPS para API local (localhost:3001) sem bloqueio do Chromium
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests,BlockInsecurePrivateNetworkRequestsFromPrivate,BlockInsecurePrivateNetworkRequestsFromUnknown');

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

      // Checa atualizações da versão ao iniciar o aplicativo
      checkForUpdates(mainWindow, 'condobox-desktop');
    }, 4500);
  });

  mainWindow.on("closed", () => {
    app.quit();
  });
}

function killProcessOnPort(port) {
  try {
    const { execSync } = require("child_process");
    const output = execSync(`netstat -ano | findstr :${port}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const lines = output.trim().split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== "0" && pid !== String(process.pid)) {
        console.log(`[CondoBox] Liberando porta ${port} ocupada pelo PID ${pid}...`);
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        } catch {}
      }
    }
  } catch {}
}

function startLocalApi() {
  const isDev = !app.isPackaged;

  // Libera a porta 3001 caso algum processo anterior tenha ficado preso
  killProcessOnPort(3001);

  const scriptPath = isDev
    ? path.join(__dirname, "../../local-api/dist/server.js")
    : path.join(process.resourcesPath, "app.asar.unpacked/node_modules/condo-local-api/dist/server.js");

  // Diretório de dados persistente e 100% gravável em qualquer computador Windows (sem erro de permissão)
  const dataDir = isDev
    ? path.join(__dirname, "../../local-api/data")
    : path.join(app.getPath("userData"), "data");

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (e) {
    console.warn("[CondoBox] Falha ao criar dataDir:", e?.message);
  }

  // Configuração segura embutida (protegida dentro do ASAR binário)
  let embeddedEnv = {};
  try {
    embeddedEnv = require("./embedded-env.js");
  } catch {}

  const envPath = isDev
    ? path.join(__dirname, "../../local-api/.env")
    : path.join(process.resourcesPath, ".env");

  let envVars = {
    ...process.env,
    ...embeddedEnv,
    PORT: "3001",
    CONDOBOX_DATA_DIR: dataDir,
  };

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

  const cwd = isDev
    ? path.join(__dirname, "../../local-api")
    : path.join(process.resourcesPath, "app.asar.unpacked/node_modules/condo-local-api");

  const nodeModulesPath = isDev
    ? path.join(__dirname, "../../local-api/node_modules")
    : `${path.join(process.resourcesPath, "app.asar.unpacked/node_modules/condo-local-api/node_modules")};${path.join(process.resourcesPath, "app.asar.unpacked/node_modules")}`;

  // Procura o executável Node.js:
  // 1. Node portátil embutido dentro de resources/bin/node.exe (GARANTE funcionamento em QUALQUER computador sem Node)
  // 2. Node em apps/desktop/bin/node.exe (em desenvolvimento)
  // 3. Node do sistema operacional
  const packagedNode = path.join(process.resourcesPath, "bin", "node.exe");
  const devBundledNode = path.join(__dirname, "..", "bin", "node.exe");

  let nodeExe = "node";
  if (!isDev && fs.existsSync(packagedNode)) {
    nodeExe = packagedNode;
  } else if (isDev && fs.existsSync(devBundledNode)) {
    nodeExe = devBundledNode;
  } else {
    try {
      const { execSync } = require("child_process");
      execSync("node -v", { stdio: "ignore" });
      nodeExe = "node";
    } catch {
      nodeExe = isDev ? "node" : process.execPath;
    }
  }

  const childEnv = {
    ...envVars,
    NODE_PATH: nodeModulesPath,
    CONDOBOX_DATA_DIR: dataDir,
  };

  console.log(`[CondoBox] Iniciando API Local em: ${scriptPath}`);
  console.log(`[CondoBox] Usando executável Node: ${nodeExe}`);
  console.log(`[CondoBox] Diretório de dados persistentes: ${dataDir}`);

  try {
    apiProcess = spawn(nodeExe, [scriptPath], {
      cwd: cwd,
      env: childEnv,
      stdio: "inherit",
      windowsHide: true,
      detached: false,
    });

    apiProcess.on("error", (err) => {
      console.error(`[CondoBox] Erro ao iniciar processo da API via ${nodeExe}:`, err?.message);
    });

    apiProcess.on("exit", (code) => {
      console.log(`[CondoBox] Processo da API local finalizado com código ${code}`);
    });
  } catch (err) {
    console.error("[CondoBox] Falha crítica ao disparar API Local:", err?.message);
  }
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

function killApiProcess() {
  if (apiProcess) {
    try {
      if (process.platform === "win32" && apiProcess.pid) {
        const { execSync } = require("child_process");
        execSync(`taskkill /F /T /PID ${apiProcess.pid}`, { stdio: "ignore" });
      } else {
        apiProcess.kill();
      }
    } catch {}
    apiProcess = null;
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    killApiProcess();
    app.quit();
  }
});

app.on("before-quit", () => {
  killApiProcess();
});

