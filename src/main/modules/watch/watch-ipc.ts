import { IPC, type WatchMarketRefreshOptions } from "../../../shared/ipc";
import type {
  StockQuote,
  StockSearchResult,
  WatchDataTransferResult,
  WatchMarketData,
  WatchMarketRequestOptions,
  WatchNewsAnalysisResult,
  WatchNewsMessage,
  WatchNewsSettings,
  WatchTreeConfig
} from "../../../shared/types";
import {
  requireObject,
  requireString,
  requireStringArray,
  type IpcMainLike
} from "../../ipc-utils";

export interface WatchTreeStoreLike {
  get(): Promise<WatchTreeConfig>;
  set(value: unknown): Promise<WatchTreeConfig>;
}

export interface QuoteServiceLike {
  listQuotes(secids: string[]): Promise<StockQuote[]>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
}

export interface WatchMarketServiceLike {
  get(secids: string[], options?: WatchMarketRequestOptions): Promise<WatchMarketData>;
  refresh(secids: string[], options?: WatchMarketRefreshOptions): Promise<WatchMarketData>;
}

export interface WatchNewsServiceLike {
  list(secids?: string[]): Promise<WatchNewsMessage[]>;
  markRead(secid: string, messageIds?: string[]): Promise<WatchNewsMessage[]>;
  analyzeStock(stock: { secid: string; stockName: string }): Promise<WatchNewsAnalysisResult>;
  analyzeHoldingStocks(config: WatchTreeConfig): Promise<WatchNewsAnalysisResult>;
}

export interface ConfigStoreLike {
  get(): Promise<{ watchNewsIntervalHours?: number }>;
  setWatchNewsIntervalHours(value: number): Promise<unknown>;
}

export interface DialogLike {
  showOpenDialog(options: {
    title?: string;
    buttonLabel?: string;
    properties: Array<"openDirectory" | "createDirectory">;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface WatchDataTransferServiceLike {
  exportToDirectory(directory: string): Promise<WatchDataTransferResult>;
  importFromDirectory(directory: string): Promise<WatchDataTransferResult>;
}

export interface WatchIpcDependencies {
  ipcMain: IpcMainLike;
  dialog: DialogLike;
  watchTreeStore: WatchTreeStoreLike;
  quoteService: QuoteServiceLike;
  watchMarketService: WatchMarketServiceLike;
  watchDataTransferService: WatchDataTransferServiceLike;
  watchNewsService: WatchNewsServiceLike;
  configStore: ConfigStoreLike;
  onWatchNewsSettingsChanged?: () => void;
  onWatchNewsUpdated?: () => void;
}

export function registerWatchIpc(dependencies: WatchIpcDependencies): void {
  const {
    ipcMain,
    dialog,
    watchTreeStore,
    quoteService,
    watchMarketService,
    watchDataTransferService,
    watchNewsService,
    configStore,
    onWatchNewsSettingsChanged,
    onWatchNewsUpdated
  } = dependencies;

  ipcMain.handle(IPC.getWatchTree, async () => await watchTreeStore.get());

  ipcMain.handle(IPC.saveWatchTree, async (_event, value) => {
    const input = requireObject(value);
    return await watchTreeStore.set(input.config);
  });

  ipcMain.handle(IPC.getWatchQuotes, async (_event, value) => {
    const input = requireObject(value);
    return await quoteService.listQuotes(requireStringArray(input.secids, "secids"));
  });

  ipcMain.handle(IPC.getWatchMarketData, async (_event, value) => {
    const input = requireObject(value);
    return await watchMarketService.get(requireStringArray(input.secids, "secids"), {
      tradingDate: typeof input.tradingDate === "string" ? input.tradingDate : undefined
    });
  });

  ipcMain.handle(IPC.refreshWatchMarketData, async (_event, value) => {
    const input = requireObject(value);
    return await watchMarketService.refresh(requireStringArray(input.secids, "secids"), {
      forceLatest: input.forceLatest === true
    });
  });

  ipcMain.handle(IPC.searchStocks, async (_event, value) => {
    const input = requireObject(value);
    return await quoteService.searchStocks(requireString(input.query, "query"));
  });

  ipcMain.handle(IPC.exportWatchData, async () => {
    const directory = await chooseDirectory(dialog, {
      title: "选择盯盘数据导出目录",
      buttonLabel: "导出到此目录",
      properties: ["openDirectory", "createDirectory"]
    });
    return directory
      ? await watchDataTransferService.exportToDirectory(directory)
      : undefined;
  });

  ipcMain.handle(IPC.importWatchData, async () => {
    const directory = await chooseDirectory(dialog, {
      title: "选择盯盘数据目录",
      buttonLabel: "导入此目录",
      properties: ["openDirectory"]
    });
    return directory
      ? await watchDataTransferService.importFromDirectory(directory)
      : undefined;
  });

  ipcMain.handle(IPC.analyzeWatchStockNews, async (_event, value) => {
    const input = requireObject(value);
    const result = await watchNewsService.analyzeStock({
      secid: requireString(input.secid, "secid"),
      stockName: requireString(input.stockName, "stockName")
    });
    onWatchNewsUpdated?.();
    return result;
  });

  ipcMain.handle(IPC.analyzeHoldingWatchNews, async () => {
    const result = await watchNewsService.analyzeHoldingStocks(await watchTreeStore.get());
    onWatchNewsUpdated?.();
    return result;
  });

  ipcMain.handle(IPC.listWatchNews, async (_event, value) => {
    const input = value === undefined ? {} : requireObject(value);
    return await watchNewsService.list(Array.isArray(input.secids)
      ? requireStringArray(input.secids, "secids")
      : undefined);
  });

  ipcMain.handle(IPC.markWatchNewsRead, async (_event, value) => {
    const input = requireObject(value);
    return await watchNewsService.markRead(
      requireString(input.secid, "secid"),
      Array.isArray(input.messageIds) ? requireStringArray(input.messageIds, "messageIds") : undefined
    );
  });

  ipcMain.handle(IPC.getWatchNewsSettings, async (): Promise<WatchNewsSettings> => {
    const config = await configStore.get();
    return { intervalHours: normalizeWatchNewsInterval(config.watchNewsIntervalHours) };
  });

  ipcMain.handle(IPC.setWatchNewsSettings, async (_event, value) => {
    const input = requireObject(value);
    const intervalHours = normalizeWatchNewsInterval(Number(input.intervalHours));
    const config = await configStore.setWatchNewsIntervalHours(intervalHours);
    onWatchNewsSettingsChanged?.();
    return config;
  });
}

function normalizeWatchNewsInterval(value: unknown): number {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval <= 0) {
    return 3;
  }
  return Math.min(168, Math.max(0.1, interval));
}

async function chooseDirectory(
  dialog: DialogLike,
  options: Parameters<DialogLike["showOpenDialog"]>[0]
): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  return result.canceled || !path ? undefined : path;
}
