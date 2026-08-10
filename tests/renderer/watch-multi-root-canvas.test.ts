import { describe, expect, it, vi } from "vitest";
import type { WatchTreeCategoryNode, WatchTreeConfig } from "../../src/shared/types";
import { renderWatchTree } from "../../src/renderer/features/watch/watch-view";

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
