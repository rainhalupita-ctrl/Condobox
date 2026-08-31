const { app, BrowserWindow, session } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let apiProcess;
let splashWindow;
let mainWindow;

const ICON_PATH = path.join(__dirname, "..", "assets", "icon.ico");

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    title: "CondoBox Portaria",
    show: false,
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  mainWindow.loadURL("https://web-eight-rust-97.vercel.app/portaria");

  // Assim que a janela principal termina de carregar, esconde o splash e mostra a principal
  mainWindow.once("ready-to-show", () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, 1800); // aguarda 1.8s para o progresso da barra de splash completar visualmente
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

  const envPath = isDev
    ? path.join(__dirname, "../../local-api/.env")
    : path.join(process.resourcesPath, ".env");

  let envVars = { ...process.env, PORT: "3001" };
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        envVars[match[1].trim()] = match[2].trim();
      }
    });
  }

  if (!fs.existsSync(scriptPath)) return;

  apiProcess = spawn("node", [scriptPath], {
    env: envVars,
    stdio: "ignore",
    windowsHide: true,
    detached: false,
  });

  apiProcess.on("error", () => {});
}

app.whenReady().then(() => {
  // Permissão automática para câmera e microfone
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media");
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === "media";
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
