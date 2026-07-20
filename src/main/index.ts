import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  safeStorage,
  shell
} from "electron";
import { join } from "node:path";
import { resolveAppDataDirectory } from "./app-data-directory";
import { CodexLocator } from "./codex-locator";
import { getCodexLauncherOverride } from "./codex-launcher-override";
import { CodexRunner } from "./codex-runner";
import { DeepSeekAgentRunner } from "./deepseek-agent-runner";
import { ConfigStore } from "./config-store";
import { ModelSecretsStore } from "./model-secrets-store";
import { ModelProviderManager, type ModelProviderContext } from "./model-provider-manager";
import { buildApplicationMenuTemplate } from "./app-menu";
import { CodexCliResearchProvider } from "./modules/research/providers/codex-cli-provider";
import { DeepSeekResearchProvider } from "./modules/research/providers/deepseek-provider";
import {
  createElectronNetFetch,
  EastMoneyMarketDataProvider
} from "./modules/watch/market-data/east-money-provider";
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
import {
  CodexWatchNewsAnalysisProvider,
  DeepSeekWatchNewsAnalysisProvider,
  EastMoneyWatchNewsNoticeSource
} from "./watch-news-analysis-provider";
import { WatchNewsService } from "./watch-news-service";
import { WatchNewsStore } from "./watch-news-store";
import { WatchTreeStore } from "./watch-tree-store";
import { IPC } from "../shared/ipc";
import type { WatchMarketProviderId } from "../shared/types";
import { createFetchHttpTransport, TavilyWebTools } from "./tavily-web-tools";

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
  const modelSecretsStore = new ModelSecretsStore(
    join(userData, "model-secrets.json"),
    safeStorage
  );
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
  const modelHttpTransport = createFetchHttpTransport(async (url, init) => await net.fetch(url, init));
  const watchNewsNoticeSource = new EastMoneyWatchNewsNoticeSource(createElectronNetFetch(net));
  const createDeepSeekAgent = (
    context: ModelProviderContext,
    onProgress: ConstructorParameters<typeof DeepSeekAgentRunner>[0]["onProgress"],
    runnerOptions: Pick<ConstructorParameters<typeof DeepSeekAgentRunner>[0], "requestTimeoutMs"> = {}
  ): DeepSeekAgentRunner => {
    const webTools = new TavilyWebTools({
      apiKey: requireModelSecret(context.secrets.tavilyApiKey, "Tavily API Key"),
      transport: modelHttpTransport
    });
    return new DeepSeekAgentRunner({
      apiKey: requireModelSecret(context.secrets.deepSeekApiKey, "DeepSeek API Key"),
      baseUrl: context.settings.deepSeekBaseUrl,
      model: context.settings.deepSeekModel,
      transport: modelHttpTransport,
      webTools,
      onProgress,
      requireSuccessfulWebTool: true,
      ...runnerOptions
    });
  };
  const modelProviderManager = new ModelProviderManager({
    configStore,
    secretsStore: modelSecretsStore,
    bundles: [{
      id: "codex-cli",
      createResearchProvider: () => new CodexCliResearchProvider({
        codexLocator,
        createRunner: (options) => new CodexRunner(options),
        researchSkillPreparer
      }),
      createWatchNewsProvider: () => new CodexWatchNewsAnalysisProvider({
        codexLocator,
        userDataDirectory: userData,
        noticeSource: watchNewsNoticeSource,
        createRunner: (options) => new CodexRunner(options)
      })
    }, {
      id: "deepseek",
      createResearchProvider: (context) => new DeepSeekResearchProvider({
        model: context.settings.deepSeekModel,
        researchSpecStore,
        createAgent: (onProgress) => createDeepSeekAgent(context, onProgress)
      }),
      createWatchNewsProvider: (context) => new DeepSeekWatchNewsAnalysisProvider({
        model: context.settings.deepSeekModel,
        userDataDirectory: userData,
        noticeSource: watchNewsNoticeSource,
        createAgent: (onProgress, options) => createDeepSeekAgent(context, onProgress, options)
      })
    }]
  });
  const researchService = new ResearchService({
    userDataDirectory: userData,
    configStore,
    historyStore,
    resolveResearchProvider: async () => await modelProviderManager.resolveResearchProvider(),
    pdfExporter,
    onProgress: (event) => {
      mainWindow?.webContents.send(IPC.researchEvent, event);
    }
  });
  const watchMarketCacheStore = new WatchMarketCacheStore(join(userData, "watch-quotes-cache.json"));
  const eastMoneyProvider = new EastMoneyMarketDataProvider(createElectronNetFetch(net));
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
  const notifyWatchNewsUpdated = (): void => {
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send(IPC.watchNewsUpdated);
    });
  };
  const watchNewsStore = new WatchNewsStore(join(userData, "watch-news.json"));
  const watchNewsService = new WatchNewsService(
    watchNewsStore,
    async () => await modelProviderManager.resolveWatchNewsProvider(),
    undefined,
    notifyWatchNewsUpdated
  );
  let watchNewsTimer: NodeJS.Timeout | undefined;
  let watchNewsInFlight = false;
  const runScheduledWatchNews = async (): Promise<void> => {
    if (watchNewsInFlight) {
      return;
    }
    watchNewsInFlight = true;
    try {
      const result = await watchNewsService.analyzeHoldingStocks(await watchTreeStore.get());
      if (result.newMessageCount > 0) {
        notifyWatchNewsUpdated();
      }
    } finally {
      watchNewsInFlight = false;
    }
  };
  const scheduleWatchNews = async (): Promise<void> => {
    if (watchNewsTimer) {
      clearInterval(watchNewsTimer);
    }
    const config = await configStore.get();
    const intervalHours = normalizeWatchNewsIntervalHours(config.watchNewsIntervalHours);
    watchNewsTimer = setInterval(() => void runScheduledWatchNews(), intervalHours * 60 * 60 * 1000);
  };
  registerIpcHandlers({
    ipcMain,
    dialog,
    shell,
    configStore,
    modelSecretsStore,
    researchSpecStore,
    historyStore,
    researchService,
    codexLocator,
    watchTreeStore,
    quoteService,
    watchMarketService,
    watchDataTransferService,
    watchNewsService,
    onWatchNewsUpdated: notifyWatchNewsUpdated,
    onWatchNewsSettingsChanged: () => void scheduleWatchNews()
  });
  const applyApplicationMenu = (selectedWatchMarketProviderId: WatchMarketProviderId): void => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate({
      selectedWatchMarketProviderId,
      onOpenWatchMarketProviderSettings: () => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send(IPC.openWatchMarketProviderSettings);
        });
      },
      onOpenWatchNewsSettings: () => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send(IPC.openWatchNewsSettings);
        });
      },
      onOpenModelProviderSettings: () => {
        BrowserWindow.getAllWindows().forEach((window) => {
          window.webContents.send(IPC.openModelProviderSettings);
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
  await scheduleWatchNews();

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

function normalizeWatchNewsIntervalHours(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return 3;
  }
  return Math.min(168, Math.max(0.1, numberValue));
}

function requireModelSecret(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} 尚未配置`);
  return value;
}
