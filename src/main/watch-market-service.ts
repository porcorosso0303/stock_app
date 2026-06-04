import type {
  StockQuote,
  StockTrend,
  WatchMarketCache,
  WatchMarketData
} from "../shared/types";
import { mergeQuoteIntoTrend } from "../shared/watch-tree";

interface WatchMarketCacheStoreLike {
  getForDate(date: string): Promise<WatchMarketCache | undefined>;
  write(cache: WatchMarketCache): Promise<void>;
}

interface QuoteServiceLike {
  list(secids: string[]): Promise<StockQuote[]>;
  trends(secids: string[]): Promise<StockTrend[]>;
}

export class WatchMarketService {
  constructor(
    private readonly cacheStore: WatchMarketCacheStoreLike,
    private readonly quoteService: QuoteServiceLike,
    private readonly now: () => Date = () => new Date()
  ) {}

  async get(secids: string[]): Promise<WatchMarketData> {
    const tradingDate = formatChinaDate(this.now());
    const cache = await this.cacheStore.getForDate(tradingDate);
    if (cache) {
      return {
        quotes: cache.quotes,
        trends: cache.trends,
        updatedAt: cache.updatedAt,
        fromCache: true
      };
    }

    const [quotes, trends] = await Promise.all([
      this.quoteService.list(secids),
      this.quoteService.trends(secids)
    ]);
    const updatedAt = this.now().toISOString();
    await this.cacheStore.write({
      tradingDate,
      quotes,
      trends,
      updatedAt
    });
    return {
      quotes,
      trends,
      updatedAt,
      fromCache: false
    };
  }

  async refresh(secids: string[]): Promise<WatchMarketData> {
    const tradingDate = formatChinaDate(this.now());
    const cache = await this.cacheStore.getForDate(tradingDate);
    if (!cache) {
      return await this.get(secids);
    }

    const quotes = await this.quoteService.list(secids);
    const trendsBySecid = new Map(cache.trends.map((trend) => [trend.secid, trend]));
    const trends = quotes.map((quote) => mergeQuoteIntoTrend(trendsBySecid.get(quote.secid), quote));
    const updatedAt = this.now().toISOString();
    await this.cacheStore.write({
      tradingDate,
      quotes,
      trends,
      updatedAt
    });
    return {
      quotes,
      trends,
      updatedAt,
      fromCache: false
    };
  }
}

function formatChinaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}
