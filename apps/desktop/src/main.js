const { app, BrowserWindow, session } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let apiProcess;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    title: "CondoBox Portaria",
    // icon: path.join(__dirname, "icon.ico")
  });

  win.loadURL("https://web-eight-rust-97.vercel.app/portaria");
  
  win.on("closed", () => {
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

  // Read .env into an object so we can pass it to spawn
  let envVars = { ...process.env, PORT: "3001" };
  if (fs.existsSync(envPath)) {
    console.log("Carregando variáveis do .env:", envPath);
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        envVars[match[1].trim()] = match[2].trim();
      }
    });
  }

  console.log("Iniciando Local API em:", scriptPath);

  apiProcess = spawn("node", [scriptPath], {
    env: envVars,
    stdio: "inherit"
  });

  apiProcess.on("error", (err) => {
    console.error("Falha ao iniciar a API Local:", err);
  });
}

app.whenReady().then(() => {
  // Conceder permissão automática para câmera/microfone
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') {
      return true;
    }
    return false;
  });

  startLocalApi();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (apiProcess) apiProcess.kill();
    app.quit();
  }
});

app.on("before-quit", () => {
  if (apiProcess) apiProcess.kill();
});
