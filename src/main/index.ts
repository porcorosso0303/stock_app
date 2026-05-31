import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell
} from "electron";
import { join } from "node:path";
import { CodexLocator } from "./codex-locator";
import { CodexRunner } from "./codex-runner";
import { ConfigStore } from "./config-store";
import { HistoryStore } from "./history-store";
import { registerIpcHandlers } from "./ipc";
import { PdfExporter } from "./pdf-exporter";
import { ResearchService } from "./research-service";

let mainWindow: BrowserWindow | undefined;

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  void window.loadFile(join(__dirname, "../renderer/index.html"));
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  mainWindow = window;
  return window;
}

void app.whenReady().then(() => {
  const userData = app.getPath("userData");
  const configStore = new ConfigStore(join(userData, "config.json"));
  const historyStore = new HistoryStore(join(userData, "history.json"));
  const codexLocator = new CodexLocator();
  const pdfExporter = new PdfExporter({
    createWindow: () => new BrowserWindow({ show: false })
  });
  const researchService = new ResearchService({
    userDataDirectory: userData,
    configStore,
    historyStore,
    codexLocator,
    createRunner: (options) => new CodexRunner(options),
    pdfExporter,
    onProgress: (event) => {
      mainWindow?.webContents.send("research:event", event);
    }
  });
  registerIpcHandlers({
    ipcMain,
    dialog,
    shell,
    configStore,
    historyStore,
    researchService,
    codexLocator
  });

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
