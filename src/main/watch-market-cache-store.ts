import type { WatchMarketCache, WatchMarketHistoryCache } from "../shared/types";
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
    daysByDate.set(cache.tradingDate, cache);
    await this.replaceHistory({
      version: 2,
      days: sortAndLimitDays([...daysByDate.values()])
    });
  }

  async getHistory(): Promise<WatchMarketHistoryCache> {
    try {
      return validateHistory(await this.store.read());
    } catch (error) {
      if (error instanceof Error && error.message.includes("行情历史缓存格式错误")) {
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
  return {
    tradingDate: record.tradingDate,
    updatedAt: record.updatedAt,
    quotes: record.quotes as WatchMarketCache["quotes"],
    trends: record.trends as WatchMarketCache["trends"]
  };
}
