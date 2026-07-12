import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import type { CodexLauncher } from "../shared/types";
import { CodexJsonlParser, type CodexDisplayEvent } from "./codex-events";
import { CODEX_EXEC_ARGS } from "./codex-prompt";
import {
  buildCmdWrapperCommand,
  buildWindowsTaskkillCommand
} from "./windows-command";

export type CodexRunResult =
  | { status: "success"; reportMarkdown: string }
  | { status: "failed"; errorMessage: string }
  | { status: "cancelled" };

interface CodexRunnerOptions {
  launcher: CodexLauncher;
  runDirectory: string;
  onEvent?: (text: string, event: CodexDisplayEvent) => void;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  idleTimeoutMs?: number;
  maxRuntimeMs?: number;
}

export class CodexRunner {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private activeProcess?: ChildProcessWithoutNullStreams;
  private cancelRequested = false;
  private timeoutErrorMessage?: string;

  constructor(private readonly options: CodexRunnerOptions) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
  }

  async run(prompt: string): Promise<CodexRunResult> {
    if (this.activeProcess) {
      throw new Error("已有 Codex 调研任务正在运行");
    }

    await mkdir(this.options.runDirectory, { recursive: true });
    const eventsPath = join(this.options.runDirectory, "events.jsonl");
    const stderrPath = join(this.options.runDirectory, "stderr.log");
    const eventsStream = createWriteStream(eventsPath, { encoding: "utf8" });
    const stderrStream = createWriteStream(stderrPath, { encoding: "utf8" });
    const parser = new CodexJsonlParser();
    const child = this.spawnCodex();
    this.activeProcess = child;
    this.cancelRequested = false;
    this.timeoutErrorMessage = undefined;
    let idleTimeout: NodeJS.Timeout | undefined;
    const stopForTimeout = (errorMessage: string): void => {
      if (this.timeoutErrorMessage) {
        return;
      }
      this.timeoutErrorMessage = errorMessage;
      this.stopActiveProcess();
    };
    const resetIdleTimeout = (): void => {
      if (!this.options.idleTimeoutMs || this.options.idleTimeoutMs <= 0) {
        return;
      }
      if (idleTimeout) {
        clearTimeout(idleTimeout);
      }
      idleTimeout = setTimeout(() => {
        stopForTimeout(
          `Codex CLI 连续 ${formatTimeoutSeconds(this.options.idleTimeoutMs)} 秒无进度，已自动结束`
        );
      }, this.options.idleTimeoutMs);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      eventsStream.write(chunk);
      for (const event of parser.push(chunk)) {
        if (event.level !== "error") {
          resetIdleTimeout();
        }
        this.options.onEvent?.(event.text, event);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderrStream.write(chunk);
    });
    child.stdin.end(prompt);

    resetIdleTimeout();
    const maxRuntimeTimeout = this.options.maxRuntimeMs && this.options.maxRuntimeMs > 0
      ? setTimeout(() => {
          stopForTimeout(
            `Codex CLI 达到最长运行时间（${formatTimeoutSeconds(this.options.maxRuntimeMs)} 秒），已自动结束`
          );
        }, this.options.maxRuntimeMs)
      : undefined;
    const exitCode = await new Promise<number>((resolve) => {
      child.once("error", () => resolve(1));
      child.once("close", (code) => resolve(code ?? 1));
    });
    if (idleTimeout) {
      clearTimeout(idleTimeout);
    }
    if (maxRuntimeTimeout) {
      clearTimeout(maxRuntimeTimeout);
    }

    for (const event of parser.flush()) {
      this.options.onEvent?.(event.text, event);
    }
    eventsStream.end();
    stderrStream.end();
    await Promise.all([finished(eventsStream), finished(stderrStream)]);
    this.activeProcess = undefined;

    if (this.cancelRequested) {
      return { status: "cancelled" };
    }
    if (this.timeoutErrorMessage) {
      return {
        status: "failed",
        errorMessage: this.timeoutErrorMessage
      };
    }
    if (exitCode !== 0) {
      const stderr = (await readFile(stderrPath, "utf8")).trim();
      return {
        status: "failed",
        errorMessage: stderr || `Codex CLI 退出码：${exitCode}`
      };
    }

    try {
      const reportMarkdown = await readFile(join(this.options.runDirectory, "report.md"), "utf8");
      return { status: "success", reportMarkdown };
    } catch {
      return {
        status: "failed",
        errorMessage: "Codex CLI 已结束，但没有生成 report.md。"
      };
    }
  }

  cancel(): void {
    if (!this.activeProcess) {
      return;
    }
    this.cancelRequested = true;
    this.stopActiveProcess();
  }

  private stopActiveProcess(): void {
    if (!this.activeProcess) {
      return;
    }
    const child = this.activeProcess;
    if (this.platform === "win32" && child.pid) {
      const command = buildWindowsTaskkillCommand(child.pid);
      const killer = spawn(command.file, command.args, {
        shell: false,
        windowsHide: true
      });
      killer.once("error", () => child.kill());
      return;
    }
    child.kill();
  }

  private spawnCodex(): ChildProcessWithoutNullStreams {
    if (this.options.launcher.kind === "cmd-wrapper" && this.platform === "win32") {
      const command = buildCmdWrapperCommand(
        this.options.launcher.executablePath,
        CODEX_EXEC_ARGS,
        this.env.ComSpec
      );
      return spawn(command.file, command.args, this.spawnOptions());
    }

    return spawn(
      this.options.launcher.executablePath,
      [...CODEX_EXEC_ARGS],
      this.spawnOptions()
    );
  }

  private spawnOptions() {
    return {
      cwd: this.options.runDirectory,
      env: this.env,
      shell: false,
      windowsHide: true
    } as const;
  }
}

function formatTimeoutSeconds(timeoutMs: number | undefined): number {
  return Math.max(1, Math.ceil((timeoutMs ?? 0) / 1000));
}
