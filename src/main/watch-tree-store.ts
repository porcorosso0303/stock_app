import type { WatchTreeConfig } from "../shared/types";
import { ensureWatchWorkspaceConfig } from "../shared/watch-tree";
import { JsonStore } from "./json-store";

export class WatchTreeStore {
  private readonly store: JsonStore<WatchTreeConfig>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.store = new JsonStore(path, () => ({}));
  }

  async get(): Promise<WatchTreeConfig> {
    return ensureWatchWorkspaceConfig(await this.store.read());
  }

  async set(value: unknown): Promise<WatchTreeConfig> {
    const config = ensureWatchWorkspaceConfig(value);
    const pending = this.writeQueue.then(() => this.store.write({
      ...config,
      activeWorkspaceId: config.workspaces?.[0]?.id
    }));
    this.writeQueue = pending.then(() => undefined, () => undefined);
    await pending;
    return config;
  }
}
