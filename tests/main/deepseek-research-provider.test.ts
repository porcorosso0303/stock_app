import { describe, expect, it, vi } from "vitest";
import {
  DeepSeekResearchProvider,
  buildDeepSeekResearchPrompts
} from "../../src/main/modules/research/providers/deepseek-provider";
import type { DeepSeekAgentProgress } from "../../src/main/deepseek-agent-runner";

function createHarness(options: { result?: string; error?: Error } = {}) {
  let onProgress: ((event: DeepSeekAgentProgress) => void) | undefined;
  const run = vi.fn().mockImplementation(async () => {
    if (options.error) throw options.error;
    return options.result ?? "# DeepSeek 调研报告";
  });
  const cancel = vi.fn();
  const createAgent = vi.fn((callback: (event: DeepSeekAgentProgress) => void) => {
    onProgress = callback;
    return { run, cancel };
  });
  const getSpec = vi.fn().mockResolvedValue("用户调研规范：检查最近四期财报");
  const provider = new DeepSeekResearchProvider({
    model: "deepseek-v4-pro",
    researchSpecStore: { get: getSpec },
    createAgent
  });
  return { provider, run, cancel, createAgent, getSpec, emit: (event: DeepSeekAgentProgress) => onProgress?.(event) };
}

describe("DeepSeekResearchProvider", () => {
  it("reports an available immutable DeepSeek model", async () => {
    const { provider } = createHarness();

    await expect(provider.detect()).resolves.toMatchObject({
      available: true,
      loggedIn: true,
      version: "deepseek-v4-pro"
    });
  });

  it("uses the stock name and current user research specification", async () => {
    const { provider, run, getSpec } = createHarness();

    await expect(provider.run({
      stockName: "兆易创新",
      runDirectory: "/tmp/run",
      onOutput: vi.fn()
    })).resolves.toEqual({ status: "success", reportMarkdown: "# DeepSeek 调研报告" });

    expect(getSpec).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringContaining("官方公告"),
      userPrompt: expect.stringMatching(/兆易创新[\s\S]*最近四期财报/)
    }));
    const request = run.mock.calls[0][0];
    expect(request.systemPrompt).toContain("事实与推断");
    expect(request.systemPrompt).toContain("来源链接");
    expect(request.systemPrompt).toContain("Markdown");
  });

  it("forwards visible output and labeled status progress", async () => {
    const { provider, emit } = createHarness();
    const onOutput = vi.fn();
    const running = provider.run({ stockName: "兆易创新", runDirectory: "/tmp/run", onOutput });

    emit({ kind: "status", text: "执行工具 web_search" });
    emit({ kind: "output", text: "报告正文" });
    await running;

    expect(onOutput).toHaveBeenCalledWith(expect.stringContaining("执行工具 web_search"));
    expect(onOutput).toHaveBeenCalledWith("报告正文");
  });

  it("maps cancellation and failures to the common provider result", async () => {
    const cancelled = createHarness({ error: new Error("DeepSeek 任务已取消") });
    const failed = createHarness({ error: new Error("DeepSeek 请求失败") });

    const cancelledRun = cancelled.provider.run({ stockName: "A", runDirectory: "/tmp/a", onOutput: vi.fn() });
    cancelled.provider.cancel();

    await expect(cancelledRun).resolves.toEqual({ status: "cancelled" });
    expect(cancelled.cancel).toHaveBeenCalledOnce();
    await expect(failed.provider.run({ stockName: "B", runDirectory: "/tmp/b", onOutput: vi.fn() }))
      .resolves.toEqual({ status: "failed", errorMessage: "DeepSeek 请求失败" });
  });

  it("builds a provider-neutral research workflow prompt", () => {
    const prompts = buildDeepSeekResearchPrompts("中控技术", "自定义规范");

    expect(prompts.systemPrompt).not.toContain("Codex");
    expect(prompts.systemPrompt).not.toContain("skill");
    expect(prompts.userPrompt).toContain("中控技术");
    expect(prompts.userPrompt).toContain("自定义规范");
    expect(prompts.systemPrompt).toContain("矛盾证据");
  });
});
