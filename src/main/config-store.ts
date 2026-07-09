import type { AppConfig, WatchMarketProviderId } from "../shared/types";
import { JsonStore } from "./json-store";

export class ConfigStore {
  private readonly store: JsonStore<AppConfig>;

  constructor(path: string) {
    this.store = new JsonStore(path, () => ({}));
  }

  get(): Promise<AppConfig> {
    return this.store.read();
  }

  async setReportDirectory(reportDirectory: string): Promise<AppConfig> {
    const config = { ...await this.get(), reportDirectory };
    await this.store.write(config);
    return config;
  }

  async setWatchMarketProviderId(watchMarketProviderId: WatchMarketProviderId): Promise<AppConfig> {
    const config = { ...await this.get(), watchMarketProviderId };
    await this.store.write(config);
    return config;
  }

  async setWatchNewsIntervalHours(watchNewsIntervalHours: number): Promise<AppConfig> {
    if (!Number.isFinite(watchNewsIntervalHours) || watchNewsIntervalHours <= 0) {
      throw new Error("持仓股消息周期必须大于 0 小时");
    }
    const config = { ...await this.get(), watchNewsIntervalHours };
    await this.store.write(config);
    return config;
  }
}
