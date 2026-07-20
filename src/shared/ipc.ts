import type {
  AppBootstrap,
  AppConfig,
  CodexEnvironmentStatus,
  ModelProviderSettingsView,
  ResearchProgressEvent,
  ResearchRecord,
  SaveModelProviderSettingsRequest,
  StockQuote,
  StockSearchResult,
  WatchDataTransferResult,
  WatchMarketData,
  WatchMarketRequestOptions,
  WatchMarketProviderId,
  WatchNewsAnalysisResult,
  WatchNewsDebugRun,
  WatchNewsMessage,
  WatchNewsSettings,
  WatchTreeConfig
} from "./types";

export const IPC = {
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
} as const;

export interface WatchMarketRefreshOptions extends WatchMarketRequestOptions {
  forceLatest?: boolean;
}

export interface StockResearchApi {
  getBootstrap(): Promise<AppBootstrap>;
  chooseReportDirectory(): Promise<string | undefined>;
  getResearchSpec(): Promise<string>;
  saveResearchSpec(spec: string): Promise<void>;
  resetResearchSpec(): Promise<string>;
  startResearch(stockName: string): Promise<ResearchRecord>;
  cancelResearch(): Promise<void>;
  listHistory(): Promise<ResearchRecord[]>;
  readReport(id: string): Promise<string>;
  openPdf(id: string): Promise<void>;
  retryPdf(id: string): Promise<ResearchRecord>;
  redetectCodex(): Promise<CodexEnvironmentStatus>;
  getModelProviderSettings(): Promise<ModelProviderSettingsView>;
  setModelProviderSettings(settings: SaveModelProviderSettingsRequest): Promise<ModelProviderSettingsView>;
  getWatchTree(): Promise<WatchTreeConfig>;
  saveWatchTree(config: WatchTreeConfig): Promise<WatchTreeConfig>;
  getWatchQuotes(secids: string[]): Promise<StockQuote[]>;
  getWatchMarketData(secids: string[], options?: WatchMarketRequestOptions): Promise<WatchMarketData>;
  refreshWatchMarketData(secids: string[], options?: WatchMarketRefreshOptions): Promise<WatchMarketData>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
  exportWatchData(): Promise<WatchDataTransferResult | undefined>;
  importWatchData(): Promise<WatchDataTransferResult | undefined>;
  analyzeWatchStockNews(stock: { secid: string; stockName: string }): Promise<WatchNewsAnalysisResult>;
  analyzeHoldingWatchNews(): Promise<WatchNewsAnalysisResult>;
  getWatchNewsDebugRun(secid?: string): Promise<WatchNewsDebugRun | undefined>;
  listWatchNews(secids?: string[]): Promise<WatchNewsMessage[]>;
  markWatchNewsRead(secid: string, messageIds?: string[]): Promise<WatchNewsMessage[]>;
  getWatchNewsSettings(): Promise<WatchNewsSettings>;
  setWatchNewsSettings(settings: WatchNewsSettings): Promise<AppConfig>;
  setWatchMarketProvider(providerId: WatchMarketProviderId): Promise<AppConfig>;
  onOpenWatchNewsSettings(callback: () => void): () => void;
  onOpenModelProviderSettings(callback: () => void): () => void;
  onOpenWatchMarketProviderSettings(callback: () => void): () => void;
  onWatchMarketProviderChanged(callback: () => void): () => void;
  onWatchNewsUpdated(callback: () => void): () => void;
  onResearchEvent(callback: (event: ResearchProgressEvent) => void): () => void;
}
