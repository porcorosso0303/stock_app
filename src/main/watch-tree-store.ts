import type { WatchTreeConfig } from "../shared/types";
import { ensureWatchWorkspaceConfig } from "../shared/watch-tree";
import { JsonStore } from "./json-store";

export class WatchTreeStore {
  private readonly store: JsonStore<WatchTreeConfig>;

  constructor(path: string) {
    this.store = new JsonStore(path, () => ({}));
  }

  async get(): Promise<WatchTreeConfig> {
    return ensureWatchWorkspaceConfig(await this.store.read());
  }

  async set(value: unknown): Promise<WatchTreeConfig> {
    const config = ensureWatchWorkspaceConfig(value);
    await this.store.write(config);
    return config;
  }
}
