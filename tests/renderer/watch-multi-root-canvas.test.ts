import { describe, expect, it, vi } from "vitest";
import type { WatchTreeCategoryNode, WatchTreeConfig } from "../../src/shared/types";
import { renderWatchTree } from "../../src/renderer/features/watch/watch-view";
import {
  measureWatchCanvas,
  watchConnectorPath
} from "../../src/renderer/features/watch/watch-connectors";
import { resolveAvailableWatchRootPosition } from "../../src/renderer/features/watch/watch-controller";

describe("watch multi-root canvas", () => {
  it("renders every root at its persisted logical position", () => {
    const container = { innerHTML: "" } as HTMLElement;
    const schedule = vi.fn();

    renderWatchTree(container, viewState(config([
      category("root-a", "第一棵树"),
      category("root-b", "第二棵树")
    ], {
      "root-a": { x: 24, y: 32 },
      "root-b": { x: 480, y: 180 }
    })), schedule);

    expect(container.innerHTML).toContain('class="watch-canvas-spacer"');
    expect(container.innerHTML).toContain('class="watch-canvas-layer"');
    expect(container.innerHTML).toContain('data-watch-root-id="root-a"');
    expect(container.innerHTML).toContain('style="left: 24px; top: 32px;"');
    expect(container.innerHTML).toContain('data-watch-root-id="root-b"');
    expect(container.innerHTML).toContain('style="left: 480px; top: 180px;"');
    expect(container.innerHTML).toContain("第一棵树");
    expect(container.innerHTML).toContain("第二棵树");
    expect((container.innerHTML.match(/data-watch-is-root="true"/g) ?? [])).toHaveLength(2);
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("renders only the blank-canvas instruction when the workspace has no roots", () => {
    const container = { innerHTML: "" } as HTMLElement;

    renderWatchTree(container, viewState(config([], {})), () => undefined);

    expect(container.innerHTML).toContain("在空白区域点击鼠标右键创建分类");
    expect(container.innerHTML).not.toContain("watch-canvas-layer");
  });

  it("measures a logical canvas that contains every positioned root", () => {
    expect(measureWatchCanvas([
      { x: 24, y: 32, width: 300, height: 180 },
      { x: 480, y: 180, width: 420, height: 260 }
    ], 40)).toEqual({ width: 940, height: 480 });
  });

  it("converts scaled screen rectangles into a logical connector path", () => {
    expect(watchConnectorPath(
      { left: 100, right: 300, top: 80, height: 40 },
      { left: 500, right: 700, top: 200, height: 40 },
      { left: 100, top: 40 },
      2
    )).toBe("M 100 30 C 155 30, 145 90, 200 90");
  });

  it("offsets a new root until it no longer overlaps an existing tree", () => {
    expect(resolveAvailableWatchRootPosition(
      { x: 250, y: 160 },
      [{ x: 24, y: 24, width: 400, height: 300 }]
    )).toEqual({ x: 442, y: 352 });
  });
});

function config(
  roots: WatchTreeCategoryNode[],
  rootPositions: Record<string, { x: number; y: number }>
): WatchTreeConfig {
  return {
    activeWorkspaceId: "default",
    workspaces: [{ id: "default", name: "默认", roots, rootPositions }]
  };
}

function category(id: string, name: string): WatchTreeCategoryNode {
  return { id, type: "category", name, children: [] };
}

function viewState(configValue: WatchTreeConfig) {
  return {
    config: configValue,
    quotes: new Map(),
    trends: new Map(),
    marketHistory: [],
    collapsedNodes: new Set<string>()
  };
}
