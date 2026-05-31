import type { AppConfig } from "../shared/types";
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
}
