import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch workspace tabs", () => {
  it("renders workspace tab controls in the watch toolbar", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const dom = await readFile("src/renderer/app/dom.ts", "utf8");
    const css = await readFile("src/renderer/styles.css", "utf8");

    expect(html).toContain('id="watch-workspace-tabs"');
    expect(html).toContain('id="add-watch-workspace"');
    expect(dom).toContain('watchWorkspaceTabs: getElement<HTMLElement>("watch-workspace-tabs")');
    expect(dom).toContain('addWatchWorkspace: getElement<HTMLButtonElement>("add-watch-workspace")');
    expect(css).toContain(".watch-workspace-tabs");
    expect(css).toContain(".watch-workspace-tab.active");
  });

  it("wires workspace helpers, tab events and Ctrl+A/Ctrl+D shortcuts in the controller", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(controller).toContain("ensureWatchWorkspaceConfig");
    expect(controller).toContain("getActiveWatchRoot");
    expect(controller).toContain("appendWatchWorkspace");
    expect(controller).toContain("deleteWatchWorkspace");
    expect(controller).toContain("renameWatchWorkspace");
    expect(controller).toContain("switchWatchWorkspace");
    expect(controller).toContain('event.key.toLowerCase()');
    expect(controller).toContain('key === "a" ? -1 : 1');
    expect(controller).toContain('data-watch-workspace-action="switch"');
    expect(controller).toContain("persistTree(false)");
  });
});
