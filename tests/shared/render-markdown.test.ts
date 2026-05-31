import { describe, expect, it } from "vitest";
import { renderMarkdown, renderReportHtml } from "../../src/shared/render-markdown";

describe("renderMarkdown", () => {
  it("renders headings, lists and links", () => {
    const html = renderMarkdown("# 标题\n\n- 一项\n\n[来源](https://example.com)");

    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<li>一项</li>");
    expect(html).toContain('href="https://example.com"');
  });

  it("does not render raw scripts", () => {
    const html = renderMarkdown("<script>alert(1)</script>");

    expect(html).not.toContain("<script>");
  });

  it("does not render javascript links", () => {
    const html = renderMarkdown("[危险](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
  });
});

describe("renderReportHtml", () => {
  it("wraps the Markdown report in printable UTF-8 HTML", () => {
    const html = renderReportHtml("# 报告");

    expect(html).toContain('<meta charset="UTF-8"');
    expect(html).toContain("<h1>报告</h1>");
    expect(html).toContain("@media print");
  });
});
