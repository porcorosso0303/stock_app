import { describe, expect, it } from "vitest";
import type { StockTrend, WatchTreeCategoryNode } from "../../src/shared/types";
import { renderWatchTree } from "../../src/renderer/features/watch/watch-view";

describe("watch sudden move alert", () => {
  it("renders a flashing arrow on a visible stock with a sudden move", () => {
    const container = { innerHTML: "" } as HTMLElement;

    renderWatchTree(container, {
      config: { root: tree },
      quotes: new Map(),
      trends: new Map<string, StockTrend>([
        ["1.600001", {
          secid: "1.600001",
          tradingDate: "2026-06-17",
          fetchedAt: "2026-06-17T02:00:00.000Z",
          points: [
            { time: "09:30", changePercent: 0.2 },
            { time: "09:34", changePercent: 1.7 }
          ]
        }]
      ]),
      marketHistory: [],
      collapsedNodes: new Set()
    }, () => undefined);

    expect(container.innerHTML).toContain("watch-stock-name");
    expect(container.innerHTML).toContain("watch-sudden-move-arrow up");
    expect(container.innerHTML).toContain("异动上涨");
    expect(container.innerHTML).toContain(">↗</span>");
  });

  it("renders a downward arrow for a sudden downward move", () => {
    const container = { innerHTML: "" } as HTMLElement;

    renderWatchTree(container, {
      config: { root: tree },
      quotes: new Map(),
      trends: new Map<string, StockTrend>([
        ["1.600001", {
          secid: "1.600001",
          tradingDate: "2026-06-17",
          fetchedAt: "2026-06-17T02:00:00.000Z",
          points: [
            { time: "09:30", changePercent: 0.8 },
            { time: "09:34", changePercent: -0.7 }
          ]
        }]
      ]),
      marketHistory: [],
      collapsedNodes: new Set()
    }, () => undefined);

    expect(container.innerHTML).toContain("watch-sudden-move-arrow down");
    expect(container.innerHTML).toContain("异动下跌");
    expect(container.innerHTML).toContain(">↘</span>");
  });

  it("renders an alert on a collapsed category that hides a sudden moving stock", () => {
    const container = { innerHTML: "" } as HTMLElement;

    renderWatchTree(container, {
      config: { root: tree },
      quotes: new Map(),
      trends: new Map<string, StockTrend>([
        ["1.600001", {
          secid: "1.600001",
          tradingDate: "2026-06-17",
          fetchedAt: "2026-06-17T02:00:00.000Z",
          points: [
            { time: "10:00", changePercent: 1.1 },
            { time: "10:05", changePercent: -0.3 }
          ]
        }]
      ]),
      marketHistory: [],
      collapsedNodes: new Set(["root"])
    }, () => undefined);

    expect(container.innerHTML).toContain("watch-category-anomaly-alert");
    expect(container.innerHTML).toContain("隐藏股票异动");
    expect(container.innerHTML).not.toContain("watch-sudden-move-arrow");
  });
});

const tree: WatchTreeCategoryNode = {
  id: "root",
  type: "category",
  name: "分类",
  children: [{
    id: "stock",
    type: "stock",
    name: "测试股",
    secid: "1.600001"
  }]
};
