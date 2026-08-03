import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WatchMarketCacheStore } from "../../src/main/watch-market-cache-store";

describe("WatchMarketCacheStore", () => {
  it("returns same-day cache and hides stale cache from the five-day history", async () => {
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
          tradingDate: "2026-06-04",
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

  it("keeps only the latest five trading days", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-market-cache-"));
    try {
      const path = join(directory, "watch-quotes-cache.json");
      const store = new WatchMarketCacheStore(path);
      for (const day of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-08"]) {
        await store.write({
          tradingDate: day,
          updatedAt: `${day}T15:00:00.000Z`,
          quotes: [{
            secid: "1.600519",
            fetchedAt: `${day}T15:00:00.000Z`,
            changePercent: 1
          }],
          trends: [{
            secid: "1.600519",
            tradingDate: day,
            fetchedAt: `${day}T15:00:00.000Z`,
            points: [{ time: "15:00", changePercent: 1 }]
          }]
        });
      }

      await expect(store.getHistory()).resolves.toMatchObject({
        version: 2,
        days: [
          { tradingDate: "2026-06-08" },
          { tradingDate: "2026-06-05" },
          { tradingDate: "2026-06-04" },
          { tradingDate: "2026-06-03" },
          { tradingDate: "2026-06-02" }
        ]
      });
      expect(await readFile(path, "utf8")).toContain('"version": 2');
      await expect(store.getForDate("2026-06-01")).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not replace a valid same-day stock snapshot with a failed refresh", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-market-cache-"));
    try {
      const store = new WatchMarketCacheStore(join(directory, "watch-quotes-cache.json"));
      await store.write({
        tradingDate: "2026-08-03",
        updatedAt: "2026-08-03T01:31:00.000Z",
        quotes: [
          { secid: "1.600001", fetchedAt: "2026-08-03T01:31:00.000Z", changePercent: 1.2 },
          { secid: "1.600002", fetchedAt: "2026-08-03T01:31:00.000Z", changePercent: -0.8 }
        ],
        trends: [
          {
            secid: "1.600001",
            tradingDate: "2026-08-03",
            fetchedAt: "2026-08-03T01:31:00.000Z",
            points: [{ time: "09:31", changePercent: 1.2 }]
          },
          {
            secid: "1.600002",
            tradingDate: "2026-08-03",
            fetchedAt: "2026-08-03T01:31:00.000Z",
            points: [{ time: "09:31", changePercent: -0.8 }]
          }
        ]
      });

      await store.write({
        tradingDate: "2026-08-03",
        updatedAt: "2026-08-03T01:32:00.000Z",
        quotes: [
          { secid: "1.600001", fetchedAt: "2026-08-03T01:32:00.000Z", changePercent: 1.5 },
          { secid: "1.600002", fetchedAt: "2026-08-03T01:32:00.000Z", changePercent: -1.1 }
        ],
        trends: [
          {
            secid: "1.600001",
            tradingDate: "2026-08-03",
            fetchedAt: "2026-08-03T01:32:00.000Z",
            points: [{ time: "09:32", changePercent: 1.5 }]
          },
          {
            secid: "1.600002",
            tradingDate: "2026-08-03",
            fetchedAt: "2026-08-03T01:32:00.000Z",
            points: [],
            errorMessage: "net::ERR_EMPTY_RESPONSE"
          }
        ]
      });

      const cache = await store.getForDate("2026-08-03");
      expect(cache?.quotes.find((quote) => quote.secid === "1.600001")?.changePercent).toBe(1.5);
      const retainedQuote = cache?.quotes.find((quote) => quote.secid === "1.600002");
      const retainedTrend = cache?.trends.find((trend) => trend.secid === "1.600002");
      expect(retainedQuote).toMatchObject({ changePercent: -0.8 });
      expect(retainedQuote?.errorMessage).toBeUndefined();
      expect(retainedTrend).toMatchObject({ points: [{ time: "09:31", changePercent: -0.8 }] });
      expect(retainedTrend?.errorMessage).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps same-day stocks omitted by a later workspace-scoped write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-market-cache-"));
    try {
      const store = new WatchMarketCacheStore(join(directory, "watch-quotes-cache.json"));
      await store.write({
        tradingDate: "2026-08-03",
        updatedAt: "2026-08-03T01:31:00.000Z",
        quotes: [{ secid: "1.600002", fetchedAt: "2026-08-03T01:31:00.000Z", changePercent: -0.8 }],
        trends: [{
          secid: "1.600002",
          tradingDate: "2026-08-03",
          fetchedAt: "2026-08-03T01:31:00.000Z",
          points: [{ time: "09:31", changePercent: -0.8 }]
        }]
      });

      await store.write({
        tradingDate: "2026-08-03",
        updatedAt: "2026-08-03T01:32:00.000Z",
        quotes: [{ secid: "1.600001", fetchedAt: "2026-08-03T01:32:00.000Z", changePercent: 1.5 }],
        trends: [{
          secid: "1.600001",
          tradingDate: "2026-08-03",
          fetchedAt: "2026-08-03T01:32:00.000Z",
          points: [{ time: "09:32", changePercent: 1.5 }]
        }]
      });

      await expect(store.getForDate("2026-08-03")).resolves.toMatchObject({
        quotes: expect.arrayContaining([
          expect.objectContaining({ secid: "1.600001" }),
          expect.objectContaining({ secid: "1.600002" })
        ]),
        trends: expect.arrayContaining([
          expect.objectContaining({ secid: "1.600001" }),
          expect.objectContaining({ secid: "1.600002" })
        ])
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("never combines quote and trend from different incomplete writes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-market-cache-"));
    try {
      const store = new WatchMarketCacheStore(join(directory, "watch-quotes-cache.json"));
      await store.write({
        tradingDate: "2026-08-03",
        updatedAt: "2026-08-03T01:31:00.000Z",
        quotes: [{ secid: "1.600001", fetchedAt: "2026-08-03T01:31:00.000Z", changePercent: 1.2 }],
        trends: []
      });
      await store.write({
        tradingDate: "2026-08-03",
        updatedAt: "2026-08-03T01:32:00.000Z",
        quotes: [],
        trends: [{
          secid: "1.600001",
          tradingDate: "2026-08-03",
          fetchedAt: "2026-08-03T01:32:00.000Z",
          points: [{ time: "09:32", changePercent: 1.5 }]
        }]
      });

      await expect(store.getForDate("2026-08-03")).resolves.toMatchObject({
        quotes: [],
        trends: []
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
