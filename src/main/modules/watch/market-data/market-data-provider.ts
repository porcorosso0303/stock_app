import type {
  StockQuote,
  StockSearchResult,
  StockTrend
} from "../../../../shared/types";

export interface MarketDataProvider {
  readonly id: string;
  readonly label: string;
  listQuotes(secids: string[]): Promise<StockQuote[]>;
  listTrends(secids: string[]): Promise<StockTrend[]>;
  searchStocks(query: string): Promise<StockSearchResult[]>;
}
