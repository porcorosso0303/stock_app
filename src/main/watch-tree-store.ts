import type { WatchTreeConfig } from "../shared/types";
import { validateWatchTreeConfig } from "../shared/watch-tree";
import { JsonStore } from "./json-store";

export class WatchTreeStore {
  private readonly store: JsonStore<WatchTreeConfig>;

  constructor(path: string) {
    this.store = new JsonStore(path, () => ({}));
  }

  async get(): Promise<WatchTreeConfig> {
    return validateWatchTreeConfig(await this.store.read());
  }

  async set(value: unknown): Promise<WatchTreeConfig> {
    const config = validateWatchTreeConfig(value);
    await this.store.write(config);
    return config;
  }
}
