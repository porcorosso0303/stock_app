import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("research live output layout", () => {
  it("lets the output hierarchy use the full workspace width and wrap long text", async () => {
    const css = await readFile("src/renderer/styles.css", "utf8");

    expect(css).toMatch(/\.output-panel\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.live-output-scroll\s*\{[^}]*min-width:\s*0[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.live-output-scroll pre\s*\{[^}]*width:\s*100%[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*normal/s);
  });

  it("appends stream chunks without rebuilding the complete output text", async () => {
    const source = await readFile("src/renderer/features/research/research-controller.ts", "utf8");

    expect(source).toContain('insertAdjacentText("beforeend"');
    expect(source).not.toContain("liveOutput.textContent +=");
  });
});
