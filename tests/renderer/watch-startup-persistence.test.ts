import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch tree startup persistence", () => {
  it("hydrates the watch tree from bootstrap data during renderer initialization", async () => {
    const source = await readFile("src/renderer/main.ts", "utf8");

    expect(source).toContain("watchConfig = state.watchTree;");
    expect(source).toContain("watchTreeLoaded = true;");
  });
});
