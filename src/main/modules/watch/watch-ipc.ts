import { IPC } from "../../../shared/ipc";
import type {
  StockQuote,
  StockSearchResult,
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
  list(secids: string[]): Promise<StockQuote[]>;
  search(query: string): Promise<StockSearchResult[]>;
}

export interface WatchMarketServiceLike {
  get(secids: string[]): Promise<WatchMarketData>;
  refresh(secids: string[]): Promise<WatchMarketData>;
}

export interface WatchIpcDependencies {
  ipcMain: IpcMainLike;
  watchTreeStore: WatchTreeStoreLike;
  quoteService: QuoteServiceLike;
  watchMarketService: WatchMarketServiceLike;
}

export function registerWatchIpc(dependencies: WatchIpcDependencies): void {
  const {
    ipcMain,
    watchTreeStore,
    quoteService,
    watchMarketService
  } = dependencies;

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
