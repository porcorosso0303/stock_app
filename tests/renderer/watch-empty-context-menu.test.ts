import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch empty-space context menu", () => {
  it("removes the configuration bar from the watch workspace", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const css = await readFile("src/renderer/styles.css", "utf8");

    expect(html).not.toContain("watch-config-bar");
    expect(html).not.toContain("create-watch-root");
    expect(css).not.toContain("watch-config-bar");
  });

  it("opens a create-root menu from empty watch panel space", async () => {
    const source = await readFile("src/renderer/main.ts", "utf8");

    expect(source).toContain('elements.watchPanel.addEventListener("contextmenu", handleWatchPanelContextMenu);');
    expect(source).toContain('data-watch-menu-action="create-root"');
    expect(source).toContain('openWatchNodeDialog({ kind: "create-root" });');
  });
});
