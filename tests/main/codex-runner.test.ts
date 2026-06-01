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
  delete process.env.FAKE_CODEX_MODE;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

async function createRunner(onEvent = (_text: string) => {}): Promise<{
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
      onEvent
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
    process.env.FAKE_CODEX_MODE = "failure";
    const { runner } = await createRunner();

    await expect(runner.run("研究失败")).resolves.toEqual({
      status: "failed",
      errorMessage: "network error"
    });
  });

  it("hides an invalid JSONL line and keeps running", async () => {
    process.env.FAKE_CODEX_MODE = "invalid-jsonl";
    const events: string[] = [];
    const { runner } = await createRunner((text) => events.push(text));

    await expect(runner.run("研究坏行")).resolves.toMatchObject({ status: "success" });
    expect(events).toEqual(["开始调研", "完成调研"]);
  });

  it("cancels an active run", async () => {
    process.env.FAKE_CODEX_MODE = "slow";
    const { runner } = await createRunner();

    const running = runner.run("等待停止");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
    runner.cancel();

    await expect(running).resolves.toEqual({ status: "cancelled" });
  });
});
