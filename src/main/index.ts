import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  shell
} from "electron";
import { join } from "node:path";
import { resolveAppDataDirectory } from "./app-data-directory";
import { CodexLocator } from "./codex-locator";
import { getCodexLauncherOverride } from "./codex-launcher-override";
import { CodexRunner } from "./codex-runner";
import { ConfigStore } from "./config-store";
import { buildApplicationMenuTemplate } from "./app-menu";
import { CodexCliResearchProvider } from "./modules/research/providers/codex-cli-provider";
import { EastMoneyMarketDataProvider } from "./modules/watch/market-data/east-money-provider";
import { MockCacheMarketDataProvider } from "./modules/watch/market-data/mock-cache-provider";
import { SelectableMarketDataProvider } from "./modules/watch/market-data/selectable-market-data-provider";
import { resolveEmbeddedSkillDirectory } from "./embedded-skill";
import { configureExternalLinks } from "./external-links";
import { HistoryStore } from "./history-store";
import { registerIpcHandlers } from "./ipc";
import { PdfExporter } from "./pdf-exporter";
import { ResearchService } from "./research-service";
import { ResearchSkillPreparer } from "./research-skill-preparer";
import { ResearchSpecStore } from "./research-spec-store";
import { WatchDataTransferService } from "./watch-data-transfer-service";
import { WatchMarketCacheStore } from "./watch-market-cache-store";
import { WatchMarketService } from "./watch-market-service";
import { WatchTreeStore } from "./watch-tree-store";
import { IPC } from "../shared/ipc";
import type { WatchMarketProviderId } from "../shared/types";

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

  configureExternalLinks(window, (url) => shell.openExternal(url));
  void window.loadFile(join(__dirname, "../renderer/index.html"));
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });
  mainWindow = window;
  return window;
}

void app.whenReady().then(async () => {
  const userData = resolveAppDataDirectory({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    executablePath: process.execPath
  });
  const configStore = new ConfigStore(join(userData, "config.json"));
  const historyStore = new HistoryStore(join(userData, "history.json"));
  const watchTreeStore = new WatchTreeStore(join(userData, "watch-tree.json"));
  const embeddedSkillDirectory = resolveEmbeddedSkillDirectory({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath
  });
  const researchSpecStore = new ResearchSpecStore(
    join(userData, "stock_research_spec.md"),
    join(embeddedSkillDirectory, "references", "stock_research_spec.md")
  );
  const researchSkillPreparer = new ResearchSkillPreparer(
    embeddedSkillDirectory,
    researchSpecStore
  );
  const launcherOverride = getCodexLauncherOverride();
  const codexLocator = launcherOverride
    ? {
        detect: async () => ({
          available: true,
          loggedIn: true,
          launcher: launcherOverride,
          version: "development override"
        })
      }
    : new CodexLocator();
  const pdfExporter = new PdfExporter({
    createWindow: () => new BrowserWindow({ show: false })
  });
  const researchProvider = new CodexCliResearchProvider({
    codexLocator,
    createRunner: (options) => new CodexRunner(options),
    researchSkillPreparer
  });
  const researchService = new ResearchService({
    userDataDirectory: userData,
    configStore,
    historyStore,
    researchProvider,
    pdfExporter,
    onProgress: (event) => {
      mainWindow?.webContents.send(IPC.researchEvent, event);
    }
  });
  const watchMarketCacheStore = new WatchMarketCacheStore(join(userData, "watch-quotes-cache.json"));
  const eastMoneyProvider = new EastMoneyMarketDataProvider((url) => net.fetch(url));
  const mockCacheProvider = new MockCacheMarketDataProvider(watchMarketCacheStore);
  const initialConfig = await configStore.get();
  const quoteService = new SelectableMarketDataProvider([
    eastMoneyProvider,
    mockCacheProvider
  ], resolveWatchMarketProviderId(initialConfig.watchMarketProviderId));
  const watchMarketService = new WatchMarketService(watchMarketCacheStore, quoteService);
  const watchDataTransferService = new WatchDataTransferService(
    watchTreeStore,
    watchMarketCacheStore
  );
  registerIpcHandlers({
    ipcMain,
    dialog,
    shell,
    configStore,
    researchSpecStore,
    historyStore,
    researchService,
    codexLocator,
    watchTreeStore,
    quoteService,
    watchMarketService,
    watchDataTransferService
  });
  const applyApplicationMenu = (selectedWatchMarketProviderId: WatchMarketProviderId): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate({
      selectedWatchMarketProviderId,
      onOpenWatchMarketProviderSettings: () => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send(IPC.openWatchMarketProviderSettings);
        });
      }
    })));
  };
  const selectWatchMarketProvider = async (providerId: WatchMarketProviderId): Promise<void> => {
    await configStore.setWatchMarketProviderId(providerId);
    quoteService.select(providerId);
    applyApplicationMenu(providerId);
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(IPC.watchMarketProviderChanged, { providerId });
    });
  };
  ipcMain.handle(IPC.setWatchMarketProvider, async (_event, value) => {
    const providerId = readWatchMarketProviderId(value);
    await selectWatchMarketProvider(providerId);
    return await configStore.get();
  });
  applyApplicationMenu(quoteService.id);

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

function resolveWatchMarketProviderId(value: unknown): WatchMarketProviderId {
  return value === "mock-cache" ? "mock-cache" : "east-money";
}

function readWatchMarketProviderId(value: unknown): WatchMarketProviderId {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("providerId 参数必须是对象");
  }
  const providerId = (value as Record<string, unknown>).providerId;
  if (providerId === "east-money" || providerId === "mock-cache") {
    return providerId;
  }
  throw new Error("providerId 必须是 east-money 或 mock-cache");
}
