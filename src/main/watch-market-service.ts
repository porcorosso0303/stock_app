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
    if (cache && coversSecids(cache, secids)) {
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
    const normalizedTrends = normalizeTrendChangePercents(trends, quotes);
    const updatedAt = this.now().toISOString();
    await this.cacheStore.write({
      tradingDate,
      quotes,
      trends: normalizedTrends,
      updatedAt
    });
    return {
      quotes,
      trends: normalizedTrends,
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
    const missingTrendSecids = quotes
      .map((quote) => quote.secid)
      .filter((secid) => !trendsBySecid.has(secid));
    if (missingTrendSecids.length > 0) {
      const missingTrends = await this.quoteService.trends(missingTrendSecids);
      for (const trend of normalizeTrendChangePercents(missingTrends, quotes)) {
        trendsBySecid.set(trend.secid, trend);
      }
    }
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

function coversSecids(cache: WatchMarketCache, secids: string[]): boolean {
  const quoteSecids = new Set(cache.quotes.map((quote) => quote.secid));
  const trendSecids = new Set(
    cache.trends
      .filter((trend) => trend.points.every((point) => typeof point.price === "number"))
      .map((trend) => trend.secid)
  );
  return secids.every((secid) => quoteSecids.has(secid) && trendSecids.has(secid));
}

function normalizeTrendChangePercents(
  trends: StockTrend[],
  quotes: StockQuote[]
): StockTrend[] {
  const quotesBySecid = new Map(quotes.map((quote) => [quote.secid, quote]));
  return trends.map((trend) => {
    const quote = quotesBySecid.get(trend.secid);
    const previousClose = derivePreviousClose(quote);
    if (previousClose === undefined) {
      return trend;
    }
    return {
      ...trend,
      points: trend.points.map((point) => ({
        ...point,
        changePercent: point.price === undefined
          ? point.changePercent
          : ((point.price - previousClose) / previousClose) * 100
      }))
    };
  });
}

function derivePreviousClose(quote: StockQuote | undefined): number | undefined {
  if (
    quote?.price === undefined ||
    quote.changePercent === undefined ||
    quote.changePercent <= -100
  ) {
    return undefined;
  }
  const previousClose = quote.price / (1 + quote.changePercent / 100);
  return Number.isFinite(previousClose) && previousClose > 0 ? previousClose : undefined;
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
