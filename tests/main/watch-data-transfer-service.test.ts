import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WatchDataTransferService } from "../../src/main/watch-data-transfer-service";
import { WatchMarketCacheStore } from "../../src/main/watch-market-cache-store";
import { WatchTreeStore } from "../../src/main/watch-tree-store";
import type { WatchTreeConfig } from "../../src/shared/types";

describe("WatchDataTransferService", () => {
  it("exports the watch tree and five-day market history to a selected directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-data-transfer-"));
    try {
      const userData = join(directory, "user-data");
      const exportDirectory = join(directory, "export");
      const treeStore = new WatchTreeStore(join(userData, "watch-tree.json"));
      const cacheStore = new WatchMarketCacheStore(join(userData, "watch-quotes-cache.json"));
      await treeStore.set(watchTree());
      await cacheStore.write(day("2026-06-05"));
      const service = new WatchDataTransferService(treeStore, cacheStore, () => new Date("2026-06-05T15:30:00.000Z"));

      await expect(service.exportToDirectory(exportDirectory)).resolves.toEqual({
        directory: exportDirectory,
        tradingDates: ["2026-06-05"],
        stockCount: 1
      });

      await expect(readJson(join(exportDirectory, "watch-tree.json"))).resolves.toEqual(watchTree());
      await expect(readJson(join(exportDirectory, "watch-market-history.json"))).resolves.toMatchObject({
        version: 2,
        days: [{ tradingDate: "2026-06-05" }]
      });
      await expect(readJson(join(exportDirectory, "metadata.json"))).resolves.toMatchObject({
        exportedAt: "2026-06-05T15:30:00.000Z",
        format: "watch-data-v1"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("imports a watch data directory into the local stores", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-data-transfer-"));
    try {
      const userData = join(directory, "user-data");
      const importDirectory = join(directory, "import");
      const treeStore = new WatchTreeStore(join(userData, "watch-tree.json"));
      const cacheStore = new WatchMarketCacheStore(join(userData, "watch-quotes-cache.json"));
      await mkdir(importDirectory, { recursive: true });
      await writeFile(join(importDirectory, "watch-tree.json"), JSON.stringify(watchTree()), "utf8");
      await writeFile(join(importDirectory, "watch-market-history.json"), JSON.stringify({
        version: 2,
        days: [day("2026-06-05"), day("2026-06-04")]
      }), "utf8");
      const service = new WatchDataTransferService(treeStore, cacheStore);

      await expect(service.importFromDirectory(importDirectory)).resolves.toEqual({
        directory: importDirectory,
        tradingDates: ["2026-06-05", "2026-06-04"],
        stockCount: 1
      });

      await expect(treeStore.get()).resolves.toEqual(watchTree());
      await expect(cacheStore.getHistory()).resolves.toMatchObject({
        days: [{ tradingDate: "2026-06-05" }, { tradingDate: "2026-06-04" }]
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("counts unique stocks across all exported watch workspaces", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-data-transfer-"));
    try {
      const userData = join(directory, "user-data");
      const exportDirectory = join(directory, "export");
      const treeStore = new WatchTreeStore(join(userData, "watch-tree.json"));
      const cacheStore = new WatchMarketCacheStore(join(userData, "watch-quotes-cache.json"));
      await treeStore.set({
        activeWorkspaceId: "first",
        workspaces: [{
          id: "first",
          name: "第一",
          root: watchTree().root
        }, {
          id: "second",
          name: "第二",
          root: {
            id: "second-root",
            type: "category",
            name: "第二组",
            children: [{
              id: "other-stock",
              type: "stock",
              name: "中控技术",
              secid: "1.688777"
            }]
          }
        }]
      });
      await cacheStore.write(day("2026-06-05"));
      const service = new WatchDataTransferService(treeStore, cacheStore);

      await expect(service.exportToDirectory(exportDirectory)).resolves.toMatchObject({
        stockCount: 2
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function watchTree(): WatchTreeConfig {
  return {
    root: {
      id: "root",
      type: "category",
      name: "自选股",
      children: [{
        id: "stock",
        type: "stock",
        name: "兆易创新",
        secid: "1.603986"
      }]
    }
  };
}

function day(tradingDate: string) {
  return {
    tradingDate,
    updatedAt: `${tradingDate}T15:00:00.000Z`,
    quotes: [{
      secid: "1.603986",
      fetchedAt: `${tradingDate}T15:00:00.000Z`,
      price: 529.31,
      changePercent: 7.53
    }],
    trends: [{
      secid: "1.603986",
      tradingDate,
      fetchedAt: `${tradingDate}T15:00:00.000Z`,
      points: [{ time: "15:00", price: 529.31, changePercent: 7.53 }]
    }]
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
