import { describe, expect, it } from "vitest";
import { renderWatchTree } from "../../src/renderer/features/watch/watch-view";
import type { WatchNewsMessage, WatchTreeCategoryNode } from "../../src/shared/types";

describe("watch news alert", () => {
  it("renders an unread news alert on holding stock names", () => {
    const container = { innerHTML: "" } as HTMLElement;

    renderWatchTree(container, {
      config: { root: root() },
      quotes: new Map(),
      trends: new Map(),
      marketHistory: [],
      newsBySecid: new Map([["1.600001", [message({ readAt: undefined })]]]),
      collapsedNodes: new Set()
    }, () => undefined);

    expect(container.innerHTML).toContain("watch-news-alert");
    expect(container.innerHTML).toContain('data-watch-news-secid="1.600001"');
  });

  it("hides the alert after the message is read", () => {
    const container = { innerHTML: "" } as HTMLElement;

    renderWatchTree(container, {
      config: { root: root() },
      quotes: new Map(),
      trends: new Map(),
      marketHistory: [],
      newsBySecid: new Map([["1.600001", [message({ readAt: "2026-07-09T10:00:00.000Z" })]]]),
      collapsedNodes: new Set()
    }, () => undefined);

    expect(container.innerHTML).not.toContain("watch-news-alert");
  });
});

function root(): WatchTreeCategoryNode {
  return {
    id: "root",
    type: "category",
    name: "root",
    children: [{
      id: "stock",
      type: "stock",
      name: "持仓股",
      secid: "1.600001",
      isHolding: true
    }]
  };
}

function message(overrides: Partial<WatchNewsMessage>): WatchNewsMessage {
  return {
    id: "news-1",
    secid: "1.600001",
    stockName: "持仓股",
    title: "订单公告",
    summary: "公司公告新订单。",
    sourceName: "公司官网",
    fetchedAt: "2026-07-09T09:00:00.000Z",
    analysis: "偏利好。",
    confidence: "medium",
    dedupeKey: "1.600001|订单公告",
    ...overrides
  };
}
