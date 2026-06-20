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
    expect(html).toContain('<label id="watch-node-holding-label" for="watch-node-holding">持仓股</label>');
    expect(html).toContain('<select id="watch-node-holding">');
    expect(html).toContain('<option value="false">否</option>');
    expect(html).toContain('<option value="true">是</option>');
    expect(dom).toContain('watchNodeIndustryPosition: getElement<HTMLSelectElement>("watch-node-industry-position")');
    expect(dom).toContain('watchNodeHoldingLabel: getElement<HTMLElement>("watch-node-holding-label")');
    expect(dom).toContain('watchNodeHolding: getElement<HTMLSelectElement>("watch-node-holding")');
    expect(controller).toContain("industryPosition: readIndustryPosition(elements.watchNodeIndustryPosition.value)");
    expect(controller).toContain("existing?.type === \"stock\" ? existing.industryPosition ?? \"\" : \"\"");
    expect(controller).toContain('elements.watchNodeHolding.value = existing?.type === "stock" && existing.isHolding ? "true" : "false"');
    expect(controller).toContain("elements.watchNodeHoldingLabel.hidden = !isStock");
    expect(controller).toContain("elements.watchNodeHolding.hidden = !isStock");
    expect(controller).toContain('...(elements.watchNodeHolding.value === "true" ? { isHolding: true } : {})');
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
