const { app, BrowserWindow, session, nativeImage, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const APP_TITLE = "CondoBox SaaS Master - Painel do Proprietário";
const MASTER_PARTITION = "persist:condobox_master_owner";
const PRIMARY_URL = process.env.CONDOBOX_MASTER_URL || "http://localhost:3000/master/login";
const REMOTE_URL = "https://web-eight-rust-97.vercel.app/master/login";

app.disableHardwareAcceleration();

if (process.platform === "win32") {
  app.setAppUserModelId("com.condobox.master");
}

// Garante apenas 1 instância do aplicativo aberta
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

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

function createMainWindow() {
  const icon = getAppIcon();
  const masterSession = session.fromPartition(MASTER_PARTITION);
  masterSession.setUserAgent(masterSession.getUserAgent() + " CondoBox-Master-Desktop/1.0");

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024,
    minHeight: 650,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#020617",
      symbolColor: "#c084fc",
      height: 40,
    },
    title: APP_TITLE,
    show: true, // Abre IMEDIATAMENTE visível na tela
    backgroundColor: "#020617",
    icon: icon,
    webPreferences: {
      session: masterSession,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  if (icon) mainWindow.setIcon(icon);

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

  // Tenta carregar primeiro o servidor local mais recente
  mainWindow.loadURL(PRIMARY_URL).catch((err) => {
    console.warn("[Master App] Local indisponível, tentando nuvem:", err?.message);
    mainWindow.loadURL(REMOTE_URL).catch(() => {});
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL === PRIMARY_URL) {
      console.warn(`[Master App] Falha ao carregar ${PRIMARY_URL}. Alternando para nuvem...`);
      mainWindow.loadURL(REMOTE_URL).catch(() => {});
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
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
