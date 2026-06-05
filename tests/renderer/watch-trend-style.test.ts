import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch trend styles", () => {
  it("uses a thinner sparkline and a darker zero axis", async () => {
    const css = await readFile("src/renderer/styles.css", "utf8");

    expect(css).toContain(".watch-trend-zero-axis { stroke: #7f8b8e; stroke-width: 1; stroke-dasharray: 4 4; }");
    expect(css).toContain(".watch-trend-line { fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }");
  });
});
