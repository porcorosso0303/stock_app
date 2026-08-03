import type { StockTrend, WatchMarketCache, WatchMarketHistoryCache } from "../shared/types";
import { JsonStore } from "./json-store";

const MAX_TRADING_DAYS = 5;

export class WatchMarketCacheStore {
  private readonly store: JsonStore<WatchMarketHistoryCache>;

  constructor(path: string) {
    this.store = new JsonStore(path, () => ({ version: 2, days: [] }));
  }

  async getForDate(date: string): Promise<WatchMarketCache | undefined> {
    const history = await this.getHistory();
    return history.days.find((cache) => cache.tradingDate === date);
  }

  async write(cache: WatchMarketCache): Promise<void> {
    const history = await this.getHistory();
    const daysByDate = new Map(history.days.map((day) => [day.tradingDate, day]));
    const existing = daysByDate.get(cache.tradingDate);
    daysByDate.set(cache.tradingDate, mergeCacheDay(existing ?? {
      tradingDate: cache.tradingDate,
      updatedAt: cache.updatedAt,
      quotes: [],
      trends: []
    }, cache));
    await this.replaceHistory({
      version: 2,
      days: sortAndLimitDays([...daysByDate.values()])
    });
  }

  async getHistory(): Promise<WatchMarketHistoryCache> {
    try {
      return validateHistory(await this.store.read());
    } catch (error) {
      if (error instanceof Error && error.message.includes("行情历史缓存")) {
        return { version: 2, days: [] };
      }
      throw error;
    }
  }

  async replaceHistory(value: unknown): Promise<WatchMarketHistoryCache> {
    const history = validateHistory(value);
    const normalized = {
      version: 2 as const,
      days: sortAndLimitDays(history.days)
    };
    await this.store.write(normalized);
    return normalized;
  }
}

function mergeCacheDay(existing: WatchMarketCache, incoming: WatchMarketCache): WatchMarketCache {
  const existingQuotes = new Map(existing.quotes.map((quote) => [quote.secid, quote]));
  const existingTrends = new Map(existing.trends.map((trend) => [trend.secid, trend]));
  const incomingQuotes = new Map(incoming.quotes.map((quote) => [quote.secid, quote]));
  const incomingTrends = new Map(incoming.trends.map((trend) => [trend.secid, trend]));
  const secids = new Set([
    ...existingQuotes.keys(),
    ...existingTrends.keys(),
    ...incomingQuotes.keys(),
    ...incomingTrends.keys()
  ]);
  const quotes: WatchMarketCache["quotes"] = [];
  const trends: WatchMarketCache["trends"] = [];

  for (const secid of secids) {
    const incomingQuote = incomingQuotes.get(secid);
    const incomingTrend = incomingTrends.get(secid);
    if (incomingQuote && incomingTrend && isCompleteCacheSnapshot(incomingQuote, incomingTrend, incoming.tradingDate)) {
      quotes.push(incomingQuote);
      trends.push(incomingTrend);
      continue;
    }

    const existingQuote = existingQuotes.get(secid);
    const existingTrend = existingTrends.get(secid);
    if (existingQuote && existingTrend && isCompleteCacheSnapshot(existingQuote, existingTrend, existing.tradingDate)) {
      quotes.push(existingQuote);
      trends.push(existingTrend);
      continue;
    }

  }

  return {
    tradingDate: incoming.tradingDate,
    updatedAt: incoming.updatedAt,
    quotes,
    trends
  };
}

function isCompleteCacheSnapshot(
  quote: WatchMarketCache["quotes"][number],
  trend: StockTrend,
  tradingDate: string
): boolean {
  return quote.changePercent !== undefined &&
    !quote.errorMessage &&
    trend.tradingDate === tradingDate &&
    trend.points.length > 0 &&
    !trend.errorMessage;
}

function sortAndLimitDays(days: WatchMarketCache[]): WatchMarketCache[] {
  return [...days]
    .sort((left, right) => right.tradingDate.localeCompare(left.tradingDate))
    .slice(0, MAX_TRADING_DAYS);
}

function validateHistory(value: unknown): WatchMarketHistoryCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("行情历史缓存格式错误");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 2 || !Array.isArray(record.days)) {
    throw new Error("行情历史缓存格式错误");
  }
  return {
    version: 2,
    days: record.days.map(validateCacheDay)
  };
}

function validateCacheDay(value: unknown): WatchMarketCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("行情历史缓存日期格式错误");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.tradingDate !== "string" ||
    typeof record.updatedAt !== "string" ||
    !Array.isArray(record.quotes) ||
    !Array.isArray(record.trends)
  ) {
    throw new Error("行情历史缓存日期格式错误");
  }
  const tradingDate = record.tradingDate;
  return {
    tradingDate,
    updatedAt: record.updatedAt,
    quotes: record.quotes as WatchMarketCache["quotes"],
    trends: record.trends.map((trend) => validateTrend(trend, tradingDate))
  };
}

function validateTrend(value: unknown, tradingDate: string): StockTrend {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("行情历史缓存走势格式错误");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.secid !== "string" ||
    typeof record.tradingDate !== "string" ||
    record.tradingDate !== tradingDate ||
    typeof record.fetchedAt !== "string" ||
    !Array.isArray(record.points)
  ) {
    throw new Error("行情历史缓存走势格式错误");
  }
  return record as unknown as StockTrend;
}
