import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("renderer module boundaries", () => {
  it("delegates shell and research behavior out of the renderer entrypoint", async () => {
    const source = await readFile("src/renderer/main.ts", "utf8");

    expect(source).toContain("createShellController");
    expect(source).toContain("createResearchController");
    expect(source).not.toContain("async function handlePrimaryAction");
    expect(source).toContain("createWatchController");
    expect(source).not.toContain("function renderWatchTree");
    expect(source).not.toContain("function drawWatchConnectors");
  });
});
