const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { diagnoseEnvironment } = require("./core/environment.cjs");
const { detectProject } = require("./core/project.cjs");
const { listDevices, listAvds } = require("./core/adb.cjs");
const { Runner } = require("./core/runner.cjs");

let window;
const runner = new Runner((payload) => window?.webContents.send("console:event", payload));
const hasInstanceLock = app.requestSingleInstanceLock();

if (!hasInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}

async function targets() {
  const environment = diagnoseEnvironment();
  const [devices, avds] = await Promise.all([
    listDevices(environment.adb).catch(() => []),
    listAvds(environment.emulator).catch(() => []),
  ]);
  return { environment, devices, avds };
}

function createWindow() {
  const capturePath = process.env.MOBILE_CONSOLE_SCREENSHOT;
  window = new BrowserWindow({
    width: Number(process.env.MOBILE_CONSOLE_WIDTH || 1440),
    height: Number(process.env.MOBILE_CONSOLE_HEIGHT || 900),
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#17191d",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (capturePath) {
    window.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const image = await window.webContents.capturePage();
        fs.writeFileSync(capturePath, image.toPNG());
        app.quit();
      }, 800);
    });
  }
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) window.loadURL(devUrl);
  else window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

if (hasInstanceLock) app.whenReady().then(() => {
  ipcMain.handle("console:bootstrap", targets);
  ipcMain.handle("console:refresh-targets", targets);
  ipcMain.handle("console:choose-project", async () => {
    const result = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    if (result.canceled) return null;
    return detectProject(result.filePaths[0]);
  });
  ipcMain.handle("console:inspect-project", (_event, projectPath) => detectProject(projectPath));
  ipcMain.handle("console:start", (_event, config) => runner.start(config));
  ipcMain.handle("console:stop", () => runner.stop());
  ipcMain.handle("console:restart", () => runner.restart());
  ipcMain.handle("console:open-external", (_event, url) => shell.openExternal(url));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => runner.stop());
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
