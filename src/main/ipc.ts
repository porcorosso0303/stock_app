import { IPC } from "../shared/ipc";
import type {
  AppConfig,
  CodexEnvironmentStatus,
  ResearchRecord,
  StockQuote,
  StockSearchResult,
  WatchMarketData,
  WatchTreeConfig
} from "../shared/types";

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, value?: unknown) => unknown
  ): void;
}

interface DialogLike {
  showOpenDialog(options: {
    properties: ["openDirectory"];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface ShellLike {
  openPath(path: string): Promise<string>;
}

interface ConfigStoreLike {
  get(): Promise<AppConfig>;
  setReportDirectory(path: string): Promise<AppConfig>;
}

interface ResearchSpecStoreLike {
  get(): Promise<string>;
  set(spec: string): Promise<void>;
  reset(): Promise<string>;
}

interface HistoryStoreLike {
  list(): Promise<ResearchRecord[]>;
  get(id: string): Promise<ResearchRecord | undefined>;
}

interface ResearchServiceLike {
  start(stockName: string): Promise<ResearchRecord>;
  cancel(): void;
  readReport(id: string): Promise<string>;
  retryPdfExport(id: string): Promise<ResearchRecord>;
}

interface CodexLocatorLike {
  detect(): Promise<CodexEnvironmentStatus>;
}

interface WatchTreeStoreLike {
  get(): Promise<WatchTreeConfig>;
  set(value: unknown): Promise<WatchTreeConfig>;
}

interface QuoteServiceLike {
  list(secids: string[]): Promise<StockQuote[]>;
  search(query: string): Promise<StockSearchResult[]>;
}

interface WatchMarketServiceLike {
  get(secids: string[]): Promise<WatchMarketData>;
  refresh(secids: string[]): Promise<WatchMarketData>;
}

interface IpcDependencies {
  ipcMain: IpcMainLike;
  dialog: DialogLike;
  shell: ShellLike;
  configStore: ConfigStoreLike;
  researchSpecStore: ResearchSpecStoreLike;
  historyStore: HistoryStoreLike;
  researchService: ResearchServiceLike;
  codexLocator: CodexLocatorLike;
  watchTreeStore: WatchTreeStoreLike;
  quoteService: QuoteServiceLike;
  watchMarketService: WatchMarketServiceLike;
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const {
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
    watchMarketService
  } = dependencies;

  ipcMain.handle(IPC.getBootstrap, async () => ({
    config: await configStore.get(),
    history: await historyStore.list(),
    codex: await detectCodexSafely(codexLocator)
  }));

  ipcMain.handle(IPC.chooseReportDirectory, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const path = result.filePaths[0];
    if (result.canceled || !path) {
      return undefined;
    }
    await configStore.setReportDirectory(path);
    return path;
  });

  ipcMain.handle(IPC.getResearchSpec, async () => await researchSpecStore.get());

  ipcMain.handle(IPC.saveResearchSpec, async (_event, value) => {
    const input = requireObject(value);
    await researchSpecStore.set(requireString(input.spec, "spec"));
  });

  ipcMain.handle(IPC.resetResearchSpec, async () => await researchSpecStore.reset());

  ipcMain.handle(IPC.startResearch, async (_event, value) => {
    const input = requireObject(value);
    return await researchService.start(requireString(input.stockName, "stockName"));
  });

  ipcMain.handle(IPC.cancelResearch, async () => {
    researchService.cancel();
  });

  ipcMain.handle(IPC.listHistory, async () => await historyStore.list());

  ipcMain.handle(IPC.readReport, async (_event, value) => {
    const input = requireObject(value);
    return await researchService.readReport(requireString(input.id, "id"));
  });

  ipcMain.handle(IPC.openPdf, async (_event, value) => {
    const input = requireObject(value);
    const id = requireString(input.id, "id");
    const record = await historyStore.get(id);
    if (!record?.pdfPath) {
      throw new Error("该历史记录没有可打开的 PDF");
    }
    const errorMessage = await shell.openPath(record.pdfPath);
    if (errorMessage) {
      throw new Error(`打开 PDF 失败：${errorMessage}`);
    }
  });

  ipcMain.handle(IPC.retryPdf, async (_event, value) => {
    const input = requireObject(value);
    return await researchService.retryPdfExport(requireString(input.id, "id"));
  });

  ipcMain.handle(IPC.redetectCodex, async () => await detectCodexSafely(codexLocator));

  ipcMain.handle(IPC.getWatchTree, async () => await watchTreeStore.get());

  ipcMain.handle(IPC.saveWatchTree, async (_event, value) => {
    const input = requireObject(value);
    return await watchTreeStore.set(input.config);
  });

  ipcMain.handle(IPC.getWatchQuotes, async (_event, value) => {
    const input = requireObject(value);
    return await quoteService.list(requireStringArray(input.secids, "secids"));
  });

  ipcMain.handle(IPC.getWatchMarketData, async (_event, value) => {
    const input = requireObject(value);
    return await watchMarketService.get(requireStringArray(input.secids, "secids"));
  });

  ipcMain.handle(IPC.refreshWatchMarketData, async (_event, value) => {
    const input = requireObject(value);
    return await watchMarketService.refresh(requireStringArray(input.secids, "secids"));
  });

  ipcMain.handle(IPC.searchStocks, async (_event, value) => {
    const input = requireObject(value);
    return await quoteService.search(requireString(input.query, "query"));
  });
}

async function detectCodexSafely(
  codexLocator: CodexLocatorLike
): Promise<CodexEnvironmentStatus> {
  try {
    return await codexLocator.detect();
  } catch (error) {
    return {
      available: false,
      message: `检测 Codex CLI 失败：${getErrorMessage(error)}`
    };
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("IPC 参数必须是对象");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`IPC 参数 ${name} 必须是字符串`);
  }
  return value;
}

function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`IPC 参数 ${name} 必须是字符串数组`);
  }
  return value;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
