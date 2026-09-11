const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const electronExe = path.resolve(__dirname, "../desktop/node_modules/electron/dist/electron.exe");
const appDir = __dirname;

if (!fs.existsSync(electronExe)) {
  console.error("Executável do Electron não encontrado em:", electronExe);
  process.exit(1);
}

const child = spawn(electronExe, [appDir], {
  cwd: appDir,
  detached: true,
  stdio: "ignore",
});

child.unref();
process.exit(0);
