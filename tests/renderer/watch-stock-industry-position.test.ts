import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch stock industry position", () => {
  it("adds an industry position selector to stock node editing", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const dom = await readFile("src/renderer/app/dom.ts", "utf8");
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(html).toContain('id="watch-node-industry-position"');
    expect(html).toContain("龙头一");
    expect(html).toContain("龙头二");
    expect(html).toContain("龙头三");
    expect(dom).toContain('watchNodeIndustryPosition: getElement<HTMLSelectElement>("watch-node-industry-position")');
    expect(controller).toContain("industryPosition: readIndustryPosition(elements.watchNodeIndustryPosition.value)");
    expect(controller).toContain("existing?.type === \"stock\" ? existing.industryPosition ?? \"\" : \"\"");
  });

  it("renders industry position stars and extra quote metrics for stock nodes", async () => {
    const view = await readFile("src/renderer/features/watch/watch-view.ts", "utf8");
    const css = await readFile("src/renderer/styles.css", "utf8");

    expect(view).toContain("renderIndustryPositionStar(node.industryPosition)");
    expect(view).toContain("TTM市盈率");
    expect(view).toContain("换手率");
    expect(view).toContain("流通市值");
    expect(css).toContain(".watch-industry-star");
    expect(css).toContain(".watch-industry-star.leader1");
    expect(css).toContain(".watch-industry-star.leader2");
    expect(css).toContain(".watch-industry-star.leader3");
  });
});
