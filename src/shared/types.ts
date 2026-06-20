export type ResearchStatus =
  | "running"
  | "completed"
  | "completed_pdf_failed"
  | "failed"
  | "cancelled";

export interface AppConfig {
  reportDirectory?: string;
  watchMarketProviderId?: WatchMarketProviderId;
  researchProviderId?: string;
}

export type WatchMarketProviderId = "east-money" | "mock-cache";

export interface ResearchRecord {
  id: string;
  stockName: string;
  createdAt: string;
  updatedAt: string;
  status: ResearchStatus;
  reportMarkdownPath: string;
  eventsPath: string;
  stderrPath: string;
  pdfPath?: string;
  errorMessage?: string;
}

export interface CodexLauncher {
  kind: "native" | "cmd-wrapper";
  executablePath: string;
}

export interface CodexEnvironmentStatus {
  available: boolean;
  launcher?: CodexLauncher;
  version?: string;
  loggedIn?: boolean;
  repairedUserPath?: boolean;
  message?: string;
}

export interface ResearchProgressEvent {
  type: "output" | "status";
  recordId: string;
  text?: string;
  status?: ResearchStatus;
}

export interface AppBootstrap {
  config: AppConfig;
  history: ResearchRecord[];
  codex: CodexEnvironmentStatus;
  watchTree: WatchTreeConfig;
}

export interface WatchTreeCategoryNode {
  id: string;
  type: "category";
  name: string;
  children: WatchTreeNode[];
}

export interface WatchTreeStockNode {
  id: string;
  type: "stock";
  name: string;
  secid: string;
  industryPosition?: WatchIndustryPosition;
}

export type WatchTreeNode = WatchTreeCategoryNode | WatchTreeStockNode;
export type WatchIndustryPosition = "leader1" | "leader2" | "leader3";

export interface WatchTreeConfig {
  root?: WatchTreeCategoryNode;
}

export interface StockQuote {
  secid: string;
  stockName?: string;
  price?: number;
  changePercent?: number;
  peTtm?: number;
  turnoverRate?: number;
  floatMarketCap?: number;
  limitRate?: number;
  limitStatus?: StockLimitStatus;
  fetchedAt: string;
  errorMessage?: string;
}

export type StockLimitStatus = "up" | "down" | "none";

export interface StockTrendPoint {
  time: string;
  price?: number;
  changePercent: number;
}

export interface StockTrend {
  secid: string;
  tradingDate: string;
  points: StockTrendPoint[];
  fetchedAt: string;
  errorMessage?: string;
}

export interface WatchMarketData {
  tradingDate?: string;
  quotes: StockQuote[];
  trends: StockTrend[];
  history?: WatchMarketCache[];
  updatedAt: string;
  fromCache: boolean;
}

export interface WatchMarketCache {
  tradingDate: string;
  quotes: StockQuote[];
  trends: StockTrend[];
  updatedAt: string;
}

export interface WatchMarketHistoryCache {
  version: 2;
  days: WatchMarketCache[];
}

export interface WatchDataTransferResult {
  directory: string;
  tradingDates: string[];
  stockCount: number;
}

export interface StockSearchResult {
  secid: string;
  code: string;
  name: string;
  marketName?: string;
}
