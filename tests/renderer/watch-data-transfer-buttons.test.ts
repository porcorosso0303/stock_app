import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch data import and export controls", () => {
  it("adds export and import buttons beside refresh quotes", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const dom = await readFile("src/renderer/app/dom.ts", "utf8");
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");
    const ipc = await readFile("src/shared/ipc.ts", "utf8");

    expect(html).toContain('id="export-watch-data"');
    expect(html).toContain('id="import-watch-data"');
    expect(dom).toContain('exportWatchData: getElement<HTMLButtonElement>("export-watch-data")');
    expect(dom).toContain('importWatchData: getElement<HTMLButtonElement>("import-watch-data")');
    expect(controller).toContain("api.exportWatchData()");
    expect(controller).toContain("api.importWatchData()");
    expect(ipc).toContain("exportWatchData");
    expect(ipc).toContain("importWatchData");
  });
});
