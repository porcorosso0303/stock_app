import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CodexRunner } from "../../src/main/codex-runner";

const fixture = resolve("tests/fixtures/fake-codex.cjs");
const directories: string[] = [];

beforeAll(async () => {
  await chmod(fixture, 0o755);
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

async function createRunner(
  onEvent = (_text: string) => {},
  options: {
    idleTimeoutMs?: number;
    maxRuntimeMs?: number;
    mode?: string;
  } = {}
): Promise<{
  directory: string;
  runner: CodexRunner;
}> {
  const directory = await mkdtemp(join(tmpdir(), "stock-tool-runner-"));
  directories.push(directory);
  return {
    directory,
    runner: new CodexRunner({
      launcher: { kind: "native", executablePath: fixture },
      runDirectory: directory,
      onEvent,
      idleTimeoutMs: options.idleTimeoutMs,
      maxRuntimeMs: options.maxRuntimeMs,
      env: { ...process.env, FAKE_CODEX_MODE: options.mode ?? "success" }
    })
  };
}

describe("CodexRunner", () => {
  it("streams events, writes logs and returns the final Markdown", async () => {
    const events: string[] = [];
    const { directory, runner } = await createRunner((text) => events.push(text));

    const result = await runner.run("研究贵州茅台");

    expect(result).toEqual({
      status: "success",
      reportMarkdown: "# 调研报告\n\n完成"
    });
    await expect(readFile(join(directory, "prompt.txt"), "utf8")).resolves.toBe("研究贵州茅台");
    await expect(readFile(join(directory, "events.jsonl"), "utf8")).resolves.toContain("开始调研");
    await expect(readFile(join(directory, "stderr.log"), "utf8")).resolves.toBe("");
    expect(events).toEqual(["开始调研", "完成调研"]);
  });

  it("returns stderr when Codex fails", async () => {
    const { runner } = await createRunner(undefined, { mode: "failure" });

    await expect(runner.run("研究失败")).resolves.toEqual({
      status: "failed",
      errorMessage: "network error"
    });
  });

  it("returns a readable usage-limit error from JSONL when stderr is empty", async () => {
    const { runner } = await createRunner(undefined, { mode: "usage-limit" });

    await expect(runner.run("研究中控技术")).resolves.toEqual({
      status: "failed",
      errorMessage: "GPT/Codex 使用额度已耗尽，请在 10:54 PM 后重试，或前往 Codex 设置补充额度。"
    });
  });

  it("hides an invalid JSONL line and keeps running", async () => {
    const events: string[] = [];
    const { runner } = await createRunner((text) => events.push(text), { mode: "invalid-jsonl" });

    await expect(runner.run("研究坏行")).resolves.toMatchObject({ status: "success" });
    expect(events).toEqual(["开始调研", "完成调研"]);
  });

  it("cancels an active run", async () => {
    const { runner } = await createRunner(undefined, { mode: "slow" });

    const running = runner.run("等待停止");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    runner.cancel();

    await expect(running).resolves.toEqual({ status: "cancelled" });
  });

  it("fails after the configured idle period without progress", async () => {
    const { runner } = await createRunner(undefined, {
      mode: "slow",
      idleTimeoutMs: 30,
      maxRuntimeMs: 200
    });

    await expect(runner.run("等待超时")).resolves.toEqual({
      status: "failed",
      errorMessage: "Codex CLI 连续 1 秒无进度，已自动结束"
    });
  });

  it("resets the idle timeout when model progress events continue", async () => {
    const { runner } = await createRunner(undefined, {
      mode: "progress-success",
      idleTimeoutMs: 30,
      maxRuntimeMs: 200
    });

    await expect(runner.run("持续分析")).resolves.toMatchObject({ status: "success" });
  });

  it("stops at the maximum runtime even while progress continues", async () => {
    const { runner } = await createRunner(undefined, {
      mode: "progress-forever",
      idleTimeoutMs: 30,
      maxRuntimeMs: 80
    });

    await expect(runner.run("持续分析到上限")).resolves.toEqual({
      status: "failed",
      errorMessage: "Codex CLI 达到最长运行时间（1 秒），已自动结束"
    });
  });
});
