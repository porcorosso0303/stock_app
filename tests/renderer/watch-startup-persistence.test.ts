import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch tree startup persistence", () => {
  it("hydrates the watch tree from bootstrap data during renderer initialization", async () => {
    const source = await readFile("src/renderer/main.ts", "utf8");
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(source).toContain("watchController.hydrate(state.watchTree);");
    expect(controller).toContain("loaded = true;");
  });
});
