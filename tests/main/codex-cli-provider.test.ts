import { describe, expect, it, vi } from "vitest";
import type { CodexDisplayEvent } from "../../src/main/codex-events";
import { CodexCliResearchProvider } from "../../src/main/modules/research/providers/codex-cli-provider";

describe("CodexCliResearchProvider", () => {
  it("maps Codex display events to structured line output", async () => {
    const createRunner = vi.fn((options: {
      onEvent(text: string, event: CodexDisplayEvent): void;
    }) => ({
      run: async () => {
        options.onEvent("正在搜索：中控技术公告", {
          raw: "{}",
          text: "正在搜索：中控技术公告",
          level: "info"
        });
        return { status: "success" as const, reportMarkdown: "# 报告" };
      },
      cancel: vi.fn()
    }));
    const provider = new CodexCliResearchProvider({
      codexLocator: {
        detect: async () => ({
          available: true,
          loggedIn: true,
          launcher: { kind: "native", executablePath: "codex" }
        })
      },
      createRunner,
      researchSkillPreparer: { prepare: vi.fn() }
    });
    const onOutput = vi.fn();

    await provider.run({
      stockName: "中控技术",
      runDirectory: "/tmp/run",
      researchDate: "2026年7月20日",
      onOutput
    });

    expect(onOutput).toHaveBeenCalledWith({
      kind: "status",
      mode: "line",
      text: "正在搜索：中控技术公告"
    });
  });
});
