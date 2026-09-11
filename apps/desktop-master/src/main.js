const { app, BrowserWindow, nativeImage, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const APP_TITLE = "CondoBox SaaS Master - Painel do Proprietário";
const logFile = path.join(__dirname, "debug.log");

function log(...args) {
  try {
    const line = `[${new Date().toISOString()}] ` + args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ") + "\n";
    fs.appendFileSync(logFile, line);
  } catch {}
}

log("Iniciando CondoBox SaaS Master... PID:", process.pid);

app.disableHardwareAcceleration();

if (process.platform === "win32") {
  app.setAppUserModelId("com.condobox.master");
}

let mainWindow = null;
let webServerProcess = null;

function getAppIcon() {
  const icoPath = path.join(__dirname, "..", "..", "desktop", "assets", "icon.ico");
  const pngPath = path.join(__dirname, "..", "..", "desktop", "assets", "icon.png");

  if (fs.existsSync(icoPath)) return nativeImage.createFromPath(icoPath);
  if (fs.existsSync(pngPath)) return nativeImage.createFromPath(pngPath);
  return undefined;
}

const net = require("net");

function checkPortListening(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

let isStartingWebServer = false;

function ensureWebServer() {
  if (isStartingWebServer) return Promise.resolve();
  return checkPortListening(3000).then((isListening) => {
    if (!isListening) {
      isStartingWebServer = true;
      log("Porta 3000 nao esta escutando. Iniciando apps/web em background...");
      const webDir = path.resolve(__dirname, "..", "..", "web");
      
      try {
        if (process.platform === "win32") {
          webServerProcess = spawn("powershell.exe", [
            "-WindowStyle", "Hidden",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command",
            `Start-Process cmd.exe -ArgumentList '/c npm run dev' -WorkingDirectory '${webDir}' -WindowStyle Hidden`
          ], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          webServerProcess = spawn("npm", ["run", "dev"], {
            cwd: webDir,
            detached: true,
            stdio: "ignore",
          });
        }
        if (webServerProcess) {
          webServerProcess.unref();
          log("Processo do servidor web disparado. PID:", webServerProcess.pid);
        }
      } catch (err) {
        log("Erro ao iniciar servidor web:", err.message);
      } finally {
        setTimeout(() => { isStartingWebServer = false; }, 4000);
      }
    } else {
      log("Servidor web ja esta rodando na porta 3000.");
    }
  });
}

// Watchdog continuo para manter o servidor web sempre ativo na porta 3000
setInterval(() => {
  checkPortListening(3000).then((isListening) => {
    if (!isListening && !isStartingWebServer) {
      log("Watchdog: Servidor web (porta 3000) indisponivel. Relancando...");
      ensureWebServer();
    }
  });
}, 4000);

function createWindow() {
  log("Criando janela principal...");
  const icon = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 650,
    autoHideMenuBar: true,
    title: APP_TITLE,
    backgroundColor: "#020617",
    icon: icon,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (icon) mainWindow.setIcon(icon);

  // Carrega imediatamente a tela de abertura local
  const loadingHtmlPath = path.join(__dirname, "loading.html");
  log("Carregando loading.html local:", loadingHtmlPath);
  mainWindow.loadFile(loadingHtmlPath);

  // Garante inicializacao do servidor web se necessario
  ensureWebServer();

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      mainWindow.reload();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    log("Janela principal fechada pelo usuario.");
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  log("app.whenReady disparado com sucesso.");
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  log("Todas as janelas foram fechadas.");
  if (webServerProcess) {
    try {
      log("Encerrando processo do servidor web...");
      webServerProcess.kill();
    } catch {}
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
