import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  WatchDataTransferResult,
  WatchMarketHistoryCache,
  WatchTreeConfig
} from "../shared/types";
import { collectWatchTreeConfigSecids, validateWatchTreeConfig } from "../shared/watch-tree";

interface WatchTreeStoreLike {
  get(): Promise<WatchTreeConfig>;
  set(value: unknown): Promise<WatchTreeConfig>;
}

interface WatchMarketCacheStoreLike {
  getHistory(): Promise<WatchMarketHistoryCache>;
  replaceHistory(value: unknown): Promise<WatchMarketHistoryCache>;
}

export class WatchDataTransferService {
  constructor(
    private readonly watchTreeStore: WatchTreeStoreLike,
    private readonly watchMarketCacheStore: WatchMarketCacheStoreLike,
    private readonly now: () => Date = () => new Date()
  ) {}

  async exportToDirectory(directory: string): Promise<WatchDataTransferResult> {
    await mkdir(directory, { recursive: true });
    const [tree, history] = await Promise.all([
      this.watchTreeStore.get(),
      this.watchMarketCacheStore.getHistory()
    ]);
    await Promise.all([
      writeJson(join(directory, "watch-tree.json"), tree),
      writeJson(join(directory, "watch-market-history.json"), history),
      writeJson(join(directory, "metadata.json"), {
        format: "watch-data-v1",
        exportedAt: this.now().toISOString(),
        files: ["watch-tree.json", "watch-market-history.json"]
      })
    ]);
    return summarize(directory, tree, history);
  }

  async importFromDirectory(directory: string): Promise<WatchDataTransferResult> {
    const [treeContent, historyContent] = await Promise.all([
      readJson(join(directory, "watch-tree.json")),
      readJson(join(directory, "watch-market-history.json"))
    ]);
    const tree = validateWatchTreeConfig(treeContent);
    const history = validateHistory(historyContent);
    await this.watchTreeStore.set(tree);
    const normalizedHistory = await this.watchMarketCacheStore.replaceHistory(history);
    return summarize(directory, tree, normalizedHistory);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function summarize(
  directory: string,
  tree: WatchTreeConfig,
  history: WatchMarketHistoryCache
): WatchDataTransferResult {
  return {
    directory,
    tradingDates: history.days.map((day) => day.tradingDate),
    stockCount: collectWatchTreeConfigSecids(tree).length
  };
}

function validateHistory(value: unknown): WatchMarketHistoryCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("盯盘行情历史数据格式错误");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 2 || !Array.isArray(record.days)) {
    throw new Error("盯盘行情历史数据格式错误");
  }
  return {
    version: 2,
    days: record.days as WatchMarketHistoryCache["days"]
  };
}
