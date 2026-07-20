import { describe, expect, it } from "vitest";
import {
  buildResearchPrompt,
  CODEX_EXEC_ARGS
} from "../../src/main/codex-prompt";

describe("buildResearchPrompt", () => {
  it("requires the single-stock research skill and a full Markdown report", () => {
    const prompt = buildResearchPrompt("贵州茅台", "2026年7月20日");

    expect(prompt).toContain("$research-a-share-stock");
    expect(prompt).toContain(".agents/skills/research-a-share-stock");
    expect(prompt).toContain("references/stock_research_spec.md");
    expect(prompt).toContain("贵州茅台");
    expect(prompt).toContain("2026年7月20日");
    expect(prompt).toContain("报告日期");
    expect(prompt).toContain("完整 Markdown");
    expect(prompt).toContain("不要修改");
  });
});

describe("CODEX_EXEC_ARGS", () => {
  it("enables search and enforces a non-interactive read-only run", () => {
    expect(CODEX_EXEC_ARGS).toEqual([
      "--search",
      "-s",
      "read-only",
      "-a",
      "never",
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-o",
      "report.md",
      "-"
    ]);
  });
});
