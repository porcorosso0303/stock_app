import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WatchMarketCacheStore } from "../../src/main/watch-market-cache-store";

describe("WatchMarketCacheStore", () => {
  it("returns same-day cache and hides stale cache", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-market-cache-"));
    try {
      const store = new WatchMarketCacheStore(join(directory, "watch-quotes-cache.json"));
      await store.write({
        tradingDate: "2026-06-04",
        updatedAt: "2026-06-04T09:31:00.000Z",
        quotes: [{
          secid: "1.600519",
          fetchedAt: "2026-06-04T09:31:00.000Z",
          changePercent: 1.2
        }],
        trends: [{
          secid: "1.600519",
          fetchedAt: "2026-06-04T09:31:00.000Z",
          points: [{ time: "09:31", changePercent: 1.2 }]
        }]
      });

      await expect(store.getForDate("2026-06-04")).resolves.toMatchObject({
        tradingDate: "2026-06-04",
        quotes: [{ secid: "1.600519" }]
      });
      await expect(store.getForDate("2026-06-05")).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
