import type {
  StockQuote,
  StockSearchResult,
  StockTrend,
  WatchMarketRequestOptions,
  WatchMarketProviderId
} from "../../../../shared/types";

export interface MarketDataProvider {
  readonly id: WatchMarketProviderId;
  readonly label: string;
  readonly cacheBehavior?: "standard" | "ephemeral";
  listQuotes(secids: string[]): Promise<StockQuote[]>;
  listTrends(secids: string[], options?: WatchMarketRequestOptions): Promise<StockTrend[]>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
}
