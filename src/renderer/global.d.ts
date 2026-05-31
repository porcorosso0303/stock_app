import type { StockResearchApi } from "../shared/ipc";

declare global {
  interface Window {
    stockResearch: StockResearchApi;
  }
}

export {};
