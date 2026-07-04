import { IPC, type WatchMarketRefreshOptions } from "../../../shared/ipc";
import type {
  StockQuote,
  StockSearchResult,
  WatchDataTransferResult,
  WatchMarketData,
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
  get(secids: string[]): Promise<WatchMarketData>;
  refresh(secids: string[], options?: WatchMarketRefreshOptions): Promise<WatchMarketData>;
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
}

export function registerWatchIpc(dependencies: WatchIpcDependencies): void {
  const {
    ipcMain,
    dialog,
    watchTreeStore,
    quoteService,
    watchMarketService,
    watchDataTransferService
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
    return await watchMarketService.get(requireStringArray(input.secids, "secids"));
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
}

async function chooseDirectory(
  dialog: DialogLike,
  options: Parameters<DialogLike["showOpenDialog"]>[0]
): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  return result.canceled || !path ? undefined : path;
}
