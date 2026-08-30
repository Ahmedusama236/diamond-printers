const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

const APP_PORT = 4000;
const START_TIMEOUT_MS = 20000;
const HEALTH_RETRY_MS = 400;

let mainWindow = null;
let logFilePath = "";

function log(message) {
  try {
    if (!logFilePath) return;
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(logFilePath, line, "utf8");
  } catch (_) {
    // Ignore logging errors.
  }
}

function getServerEntry() {
  return path.join(app.getAppPath(), "server", "src", "index.js");
}

function getFrontendDir() {
  return path.join(app.getAppPath(), "client", "dist");
}

function startBackend() {
  const serverEntry = getServerEntry();
  const frontendDir = getFrontendDir();
  log(`Server entry: ${serverEntry}`);
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing backend entry: ${serverEntry}`);
  }
  if (!fs.existsSync(path.join(frontendDir, "index.html"))) {
    throw new Error(`Missing frontend build files in: ${frontendDir}`);
  }

  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  log(`Data dir: ${dataDir}`);
  log(`Frontend dir: ${frontendDir}`);
  process.env.PORT = String(APP_PORT);
  process.env.DATA_DIR = dataDir;
  process.env.FRONTEND_DIR = frontendDir;
  log("Requiring backend server module");
  require(serverEntry);
  log("Backend module loaded");
}

function waitForBackendHealth() {
  const start = Date.now();
  const healthUrl = `http://127.0.0.1:${APP_PORT}/health`;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(healthUrl, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        if (Date.now() - start > START_TIMEOUT_MS) {
          reject(new Error(`Backend returned status ${res.statusCode}`));
          return;
        }
        setTimeout(attempt, HEALTH_RETRY_MS);
      });

      req.on("error", () => {
        if (Date.now() - start > START_TIMEOUT_MS) {
          reject(new Error("Backend did not become ready in time"));
          return;
        }
        setTimeout(attempt, HEALTH_RETRY_MS);
      });
    };

    attempt();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
    autoHideMenuBar: true,
    title: "Diamond Printers",
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, desc, url, isMainFrame) => {
      log(
        `did-fail-load code=${code} desc=${desc} url=${url} mainFrame=${isMainFrame}`
      );
    }
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log(`render-process-gone: ${JSON.stringify(details)}`);
  });
  mainWindow.webContents.on("console-message", (_event, level, message) => {
    log(`renderer-console level=${level} message=${message}`);
  });

  mainWindow.loadURL(`http://127.0.0.1:${APP_PORT}/app`);
  log("Browser window created and loading /app");
}

app.whenReady().then(async () => {
  try {
    logFilePath = path.join(app.getPath("userData"), "desktop-startup.log");
    log("App ready");
    startBackend();
    await waitForBackendHealth();
    log("Backend health check passed");
    createWindow();
  } catch (error) {
    log(`Startup error: ${error?.stack || error}`);
    dialog.showErrorBox(
      "Diamond Printers - Startup Error",
      String(error?.message || error)
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  log("All windows closed, app quitting");
  app.quit();
});

process.on("uncaughtException", (error) => {
  log(`Uncaught exception: ${error?.stack || error}`);
});

process.on("unhandledRejection", (reason) => {
  log(`Unhandled rejection: ${String(reason)}`);
});
