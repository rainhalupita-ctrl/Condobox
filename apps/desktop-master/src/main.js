const { app, BrowserWindow, session, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");

// Configurações do App do Proprietário
const APP_TITLE = "CondoBox SaaS Master - Painel do Proprietário";
const MASTER_PARTITION = "persist:condobox_master_owner";
const PRIMARY_URL = process.env.CONDOBOX_MASTER_URL || "https://web-eight-rust-97.vercel.app/super-admin";
const LOCAL_URL = "http://localhost:3000/super-admin";

app.disableHardwareAcceleration();

if (process.platform === "win32") {
  app.setAppUserModelId("com.condobox.master");
}

let splashWindow = null;
let mainWindow = null;

function getAppIcon() {
  const customIco = path.join(__dirname, "..", "assets", "icon.ico");
  const fallbackIco = path.join(__dirname, "..", "..", "desktop", "assets", "icon.ico");
  const pngPath = path.join(__dirname, "..", "..", "desktop", "assets", "icon.png");

  if (fs.existsSync(customIco)) return nativeImage.createFromPath(customIco);
  if (fs.existsSync(fallbackIco)) return nativeImage.createFromPath(fallbackIco);
  if (fs.existsSync(pngPath)) return nativeImage.createFromPath(pngPath);
  return undefined;
}

function createSplash() {
  const icon = getAppIcon();

  splashWindow = new BrowserWindow({
    width: 480,
    height: 320,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: false,
    icon: icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (icon) splashWindow.setIcon(icon);
  splashWindow.loadFile(path.join(__dirname, "splash.html"));
}

function createMainWindow() {
  const icon = getAppIcon();
  const masterSession = session.fromPartition(MASTER_PARTITION);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 650,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#020617",
      symbolColor: "#c084fc", // Destaque em tom roxo/master
      height: 40,
    },
    title: APP_TITLE,
    show: false,
    icon: icon,
    webPreferences: {
      session: masterSession,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  if (icon) mainWindow.setIcon(icon);

  // Injetar CSS para refinamento da interface de desktop
  mainWindow.webContents.on("dom-ready", () => {
    mainWindow.webContents.insertCSS(`
      * {
        -webkit-user-drag: none !important;
        user-drag: none !important;
      }
      input, textarea, [contenteditable="true"] {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
    `);
  });

  // Carrega URL principal com fallback
  mainWindow.loadURL(PRIMARY_URL).catch(() => {
    console.log("[Master App] Tentando carregar endereço local:", LOCAL_URL);
    mainWindow.loadURL(LOCAL_URL).catch(() => {});
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL !== LOCAL_URL) {
      console.warn(`[Master App] Falha de conexão (${errorCode}: ${errorDescription}). Alternando para porta local...`);
      mainWindow.loadURL(LOCAL_URL).catch(() => {});
    }
  });

  // Abre links externos no navegador padrão do sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.focus();
    }, 2000);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

app.whenReady().then(() => {
  createSplash();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
