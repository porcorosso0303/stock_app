import type { WatchMarketCache } from "../shared/types";
import { JsonStore } from "./json-store";

export class WatchMarketCacheStore {
  private readonly store: JsonStore<WatchMarketCache | undefined>;

  constructor(path: string) {
    this.store = new JsonStore(path, () => undefined);
  }

  async getForDate(date: string): Promise<WatchMarketCache | undefined> {
    const cache = await this.store.read();
    if (!cache || cache.tradingDate !== date) {
      return undefined;
    }
    return cache;
  }

  async write(cache: WatchMarketCache): Promise<void> {
    await this.store.write(cache);
  }
}
