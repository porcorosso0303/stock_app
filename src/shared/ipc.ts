import type {
  AppBootstrap,
  CodexEnvironmentStatus,
  ResearchProgressEvent,
  ResearchRecord,
  StockQuote,
  StockSearchResult,
  WatchDataTransferResult,
  WatchMarketData,
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
  getWatchTree: "watch-tree:get",
  saveWatchTree: "watch-tree:save",
  getWatchQuotes: "watch-quotes:get",
  getWatchMarketData: "watch-market:get",
  refreshWatchMarketData: "watch-market:refresh",
  searchStocks: "watch-stocks:search",
  exportWatchData: "watch-data:export",
  importWatchData: "watch-data:import",
  researchEvent: "research:event"
} as const;

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
  getWatchTree(): Promise<WatchTreeConfig>;
  saveWatchTree(config: WatchTreeConfig): Promise<WatchTreeConfig>;
  getWatchQuotes(secids: string[]): Promise<StockQuote[]>;
  getWatchMarketData(secids: string[]): Promise<WatchMarketData>;
  refreshWatchMarketData(secids: string[]): Promise<WatchMarketData>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
  exportWatchData(): Promise<WatchDataTransferResult | undefined>;
  importWatchData(): Promise<WatchDataTransferResult | undefined>;
  onResearchEvent(callback: (event: ResearchProgressEvent) => void): () => void;
}
