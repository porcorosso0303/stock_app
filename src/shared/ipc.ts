import type {
  AppBootstrap,
  CodexEnvironmentStatus,
  ResearchProgressEvent,
  ResearchRecord
} from "./types";

export const IPC = {
  getBootstrap: "app:get-bootstrap",
  chooseReportDirectory: "config:choose-report-directory",
  startResearch: "research:start",
  cancelResearch: "research:cancel",
  listHistory: "history:list",
  readReport: "history:read-report",
  openPdf: "history:open-pdf",
  retryPdf: "history:retry-pdf",
  redetectCodex: "codex:redetect",
  researchEvent: "research:event"
} as const;

export interface StockResearchApi {
  getBootstrap(): Promise<AppBootstrap>;
  chooseReportDirectory(): Promise<string | undefined>;
  startResearch(stockName: string): Promise<ResearchRecord>;
  cancelResearch(): Promise<void>;
  listHistory(): Promise<ResearchRecord[]>;
  readReport(id: string): Promise<string>;
  openPdf(id: string): Promise<void>;
  retryPdf(id: string): Promise<ResearchRecord>;
  redetectCodex(): Promise<CodexEnvironmentStatus>;
  onResearchEvent(callback: (event: ResearchProgressEvent) => void): () => void;
}
