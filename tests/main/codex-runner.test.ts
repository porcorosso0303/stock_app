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
  timeoutMs?: number,
  mode = "success"
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
      timeoutMs,
      env: { ...process.env, FAKE_CODEX_MODE: mode }
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
    const { runner } = await createRunner(undefined, undefined, "failure");

    await expect(runner.run("研究失败")).resolves.toEqual({
      status: "failed",
      errorMessage: "network error"
    });
  });

  it("hides an invalid JSONL line and keeps running", async () => {
    const events: string[] = [];
    const { runner } = await createRunner((text) => events.push(text), undefined, "invalid-jsonl");

    await expect(runner.run("研究坏行")).resolves.toMatchObject({ status: "success" });
    expect(events).toEqual(["开始调研", "完成调研"]);
  });

  it("cancels an active run", async () => {
    const { runner } = await createRunner(undefined, undefined, "slow");

    const running = runner.run("等待停止");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    runner.cancel();

    await expect(running).resolves.toEqual({ status: "cancelled" });
  });

  it("fails a run that exceeds its configured timeout", async () => {
    const { runner } = await createRunner(undefined, 30, "slow");

    await expect(runner.run("等待超时")).resolves.toEqual({
      status: "failed",
      errorMessage: "Codex CLI 运行超时（1 秒）"
    });
  });
});
