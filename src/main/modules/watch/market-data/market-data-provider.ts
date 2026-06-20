import type {
  StockQuote,
  StockSearchResult,
  StockTrend,
  WatchMarketProviderId
} from "../../../../shared/types";

export interface MarketDataProvider {
  readonly id: WatchMarketProviderId;
  readonly label: string;
  readonly cacheBehavior?: "standard" | "ephemeral";
  listQuotes(secids: string[]): Promise<StockQuote[]>;
  listTrends(secids: string[]): Promise<StockTrend[]>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
}
