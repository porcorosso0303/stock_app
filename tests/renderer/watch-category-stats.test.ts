import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch category stats", () => {
  it("renders average change percent and up/down count for category nodes", async () => {
    const view = await readFile("src/renderer/features/watch/watch-view.ts", "utf8");
    const css = await readFile("src/renderer/styles.css", "utf8");

    expect(view).toContain("countUpDownStocks");
    expect(view).toContain("watch-category-stats");
    expect(view).toContain("watch-category-up-down");
    expect(view).toContain("categoryStrengthHistory");
    expect(view).toContain("watch-sector-strength-row");
    expect(view).toContain("watch-sector-strength-index");
    expect(view).toContain("formatStrengthScore(strength.score)");
    expect(view).toContain("formatChangePercent(average)");
    expect(css).toContain(".watch-category-stats");
    expect(css).toContain(".watch-sector-strength-index");
    expect(css).toContain(".watch-up-count");
    expect(css).toContain(".watch-down-count");
  });
});
