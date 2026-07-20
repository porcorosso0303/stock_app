import { contextBridge, ipcRenderer } from "electron";
import type { StockResearchApi } from "../shared/ipc";
import type { ResearchProgressEvent } from "../shared/types";

const IPC = {
  getBootstrap: "app:get-bootstrap",
  chooseReportDirectory: "config:choose-report-directory",
  getResearchSpec: "research-spec:get",
  saveResearchSpec: "research-spec:save",
  resetResearchSpec: "research-spec:reset",
  startResearch: "research:start",
  cancelResearch: "research:cancel",
  listHistory: "history:list",
  readReport: "history:read-report",
  openPdf: "history:open-pdf",
  retryPdf: "history:retry-pdf",
  redetectCodex: "codex:redetect",
  getModelProviderSettings: "model-provider-settings:get",
  setModelProviderSettings: "model-provider-settings:set",
  openModelProviderSettings: "model-provider-settings:open",
  getWatchTree: "watch-tree:get",
  saveWatchTree: "watch-tree:save",
  getWatchQuotes: "watch-quotes:get",
  getWatchMarketData: "watch-market:get",
  refreshWatchMarketData: "watch-market:refresh",
  searchStocks: "watch-stocks:search",
  exportWatchData: "watch-data:export",
  importWatchData: "watch-data:import",
  analyzeWatchStockNews: "watch-news:analyze-stock",
  analyzeHoldingWatchNews: "watch-news:analyze-holdings",
  getWatchNewsDebugRun: "watch-news:debug-run",
  listWatchNews: "watch-news:list",
  markWatchNewsRead: "watch-news:mark-read",
  getWatchNewsSettings: "watch-news-settings:get",
  setWatchNewsSettings: "watch-news-settings:set",
  openWatchNewsSettings: "watch-news-settings:open",
  watchNewsUpdated: "watch-news:updated",
  openWatchMarketProviderSettings: "watch-market-provider:open-settings",
  setWatchMarketProvider: "watch-market-provider:set",
  watchMarketProviderChanged: "watch-market-provider:changed",
  researchEvent: "research:event"
} as const satisfies typeof import("../shared/ipc").IPC;

const api: StockResearchApi = {
  getBootstrap: async () => await ipcRenderer.invoke(IPC.getBootstrap),
  chooseReportDirectory: async () => await ipcRenderer.invoke(IPC.chooseReportDirectory),
  getResearchSpec: async () => await ipcRenderer.invoke(IPC.getResearchSpec),
  saveResearchSpec: async (spec) => await ipcRenderer.invoke(IPC.saveResearchSpec, { spec }),
  resetResearchSpec: async () => await ipcRenderer.invoke(IPC.resetResearchSpec),
  startResearch: async (stockName) => await ipcRenderer.invoke(IPC.startResearch, { stockName }),
  cancelResearch: async () => await ipcRenderer.invoke(IPC.cancelResearch),
  listHistory: async () => await ipcRenderer.invoke(IPC.listHistory),
  readReport: async (id) => await ipcRenderer.invoke(IPC.readReport, { id }),
  openPdf: async (id) => await ipcRenderer.invoke(IPC.openPdf, { id }),
  retryPdf: async (id) => await ipcRenderer.invoke(IPC.retryPdf, { id }),
  redetectCodex: async () => await ipcRenderer.invoke(IPC.redetectCodex),
  getModelProviderSettings: async () => await ipcRenderer.invoke(IPC.getModelProviderSettings),
  setModelProviderSettings: async (settings) => await ipcRenderer.invoke(IPC.setModelProviderSettings, settings),
  getWatchTree: async () => await ipcRenderer.invoke(IPC.getWatchTree),
  saveWatchTree: async (config) => await ipcRenderer.invoke(IPC.saveWatchTree, { config }),
  getWatchQuotes: async (secids) => await ipcRenderer.invoke(IPC.getWatchQuotes, { secids }),
  getWatchMarketData: async (secids, options) => await ipcRenderer.invoke(IPC.getWatchMarketData, { secids, ...options }),
  refreshWatchMarketData: async (secids, options) => await ipcRenderer.invoke(IPC.refreshWatchMarketData, { secids, ...options }),
  searchStocks: async (query) => await ipcRenderer.invoke(IPC.searchStocks, { query }),
  exportWatchData: async () => await ipcRenderer.invoke(IPC.exportWatchData),
  importWatchData: async () => await ipcRenderer.invoke(IPC.importWatchData),
  analyzeWatchStockNews: async (stock) => await ipcRenderer.invoke(IPC.analyzeWatchStockNews, stock),
  analyzeHoldingWatchNews: async () => await ipcRenderer.invoke(IPC.analyzeHoldingWatchNews),
  getWatchNewsDebugRun: async (secid) => await ipcRenderer.invoke(IPC.getWatchNewsDebugRun, { secid }),
  listWatchNews: async (secids) => await ipcRenderer.invoke(IPC.listWatchNews, { secids }),
  markWatchNewsRead: async (secid, messageIds) => await ipcRenderer.invoke(IPC.markWatchNewsRead, { secid, messageIds }),
  getWatchNewsSettings: async () => await ipcRenderer.invoke(IPC.getWatchNewsSettings),
  setWatchNewsSettings: async (settings) => await ipcRenderer.invoke(IPC.setWatchNewsSettings, settings),
  setWatchMarketProvider: async (providerId) => await ipcRenderer.invoke(IPC.setWatchMarketProvider, { providerId }),
  onOpenWatchNewsSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.openWatchNewsSettings, listener);
    return () => ipcRenderer.removeListener(IPC.openWatchNewsSettings, listener);
  },
  onOpenModelProviderSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.openModelProviderSettings, listener);
    return () => ipcRenderer.removeListener(IPC.openModelProviderSettings, listener);
  },
  onOpenWatchMarketProviderSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.openWatchMarketProviderSettings, listener);
    return () => ipcRenderer.removeListener(IPC.openWatchMarketProviderSettings, listener);
  },
  onWatchMarketProviderChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.watchMarketProviderChanged, listener);
    return () => ipcRenderer.removeListener(IPC.watchMarketProviderChanged, listener);
  },
  onWatchNewsUpdated: (callback) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.watchNewsUpdated, listener);
    return () => ipcRenderer.removeListener(IPC.watchNewsUpdated, listener);
  },
  onResearchEvent: (callback) => {
    const listener = (_event: unknown, progress: ResearchProgressEvent) => callback(progress);
    ipcRenderer.on(IPC.researchEvent, listener);
    return () => ipcRenderer.removeListener(IPC.researchEvent, listener);
  }
};

contextBridge.exposeInMainWorld("stockResearch", api);
