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
  watchNewsIntervalHours?: number;
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
  isHolding?: boolean;
}

export type WatchTreeNode = WatchTreeCategoryNode | WatchTreeStockNode;
export type WatchIndustryPosition = "leader1" | "leader2" | "leader3";

export interface WatchTreeWorkspace {
  id: string;
  name: string;
  root?: WatchTreeCategoryNode;
}

export interface WatchTreeConfig {
  activeWorkspaceId?: string;
  workspaces?: WatchTreeWorkspace[];
  /**
   * Legacy single-workspace mirror. New code should use workspaces plus activeWorkspaceId.
   */
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

export interface WatchMarketRequestOptions {
  tradingDate?: string;
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

export type WatchNewsConfidence = "high" | "medium" | "low";

export interface WatchNewsMessage {
  id: string;
  secid: string;
  stockName: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl?: string;
  occurredAt?: string;
  fetchedAt: string;
  analysis: string;
  confidence: WatchNewsConfidence;
  dedupeKey: string;
  readAt?: string;
}

export interface WatchNewsHistory {
  version: 1;
  messages: WatchNewsMessage[];
}

export interface WatchNewsSettings {
  intervalHours: number;
}

export interface WatchNewsAnalysisResult {
  stockCount: number;
  newMessageCount: number;
  messages: WatchNewsMessage[];
  errors: Array<{
    secid: string;
    stockName: string;
    errorMessage: string;
  }>;
}

export interface WatchNewsDebugEvent {
  text: string;
  level: "info" | "warning" | "error";
  raw?: string;
}

export interface WatchNewsDebugRun {
  runId: string;
  runDirectory: string;
  secid: string;
  stockName?: string;
  createdAt: string;
  status: "running" | "completed" | "failed";
  prompt: string;
  events: WatchNewsDebugEvent[];
  rawEvents: string;
  stderr: string;
  reportMarkdown?: string;
  errorMessage?: string;
}

export interface StockSearchResult {
  secid: string;
  code: string;
  name: string;
  marketName?: string;
}
