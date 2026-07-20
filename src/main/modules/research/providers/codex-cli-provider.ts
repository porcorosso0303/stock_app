import type {
  CodexEnvironmentStatus,
  CodexLauncher
} from "../../../../shared/types";
import type { CodexRunResult } from "../../../codex-runner";
import type { CodexDisplayEvent } from "../../../codex-events";
import { buildResearchPrompt } from "../../../codex-prompt";
import type {
  ResearchProvider,
  ResearchProviderRequest,
  ResearchProviderResult
} from "./research-provider";

interface CodexLocatorLike {
  detect(): Promise<CodexEnvironmentStatus>;
}

interface CodexRunnerLike {
  run(prompt: string): Promise<CodexRunResult>;
  cancel(): void;
}

interface RunnerOptions {
  launcher: CodexLauncher;
  runDirectory: string;
  onEvent: (text: string, event: CodexDisplayEvent) => void;
}

interface ResearchSkillPreparerLike {
  prepare(runDirectory: string): Promise<void>;
}

export interface CodexCliResearchProviderDependencies {
  codexLocator: CodexLocatorLike;
  createRunner: (options: RunnerOptions) => CodexRunnerLike;
  researchSkillPreparer: ResearchSkillPreparerLike;
}

export class CodexCliResearchProvider implements ResearchProvider {
  readonly id = "codex-cli";
  readonly label = "Codex CLI";

  private activeRunner?: CodexRunnerLike;

  constructor(private readonly dependencies: CodexCliResearchProviderDependencies) {}

  async detect(): Promise<CodexEnvironmentStatus> {
    return normalizeCodexStatus(await this.dependencies.codexLocator.detect());
  }

  async run(request: ResearchProviderRequest): Promise<ResearchProviderResult> {
    const codex = await this.detect();
    const launcher = requireCodexLauncher(codex);
    await this.dependencies.researchSkillPreparer.prepare(request.runDirectory);
    const runner = this.dependencies.createRunner({
      launcher,
      runDirectory: request.runDirectory,
      onEvent: (text) => request.onOutput({ kind: "status", mode: "line", text })
    });
    this.activeRunner = runner;
    try {
      return await runner.run(buildResearchPrompt(request.stockName, request.researchDate));
    } finally {
      this.activeRunner = undefined;
    }
  }

  cancel(): void {
    this.activeRunner?.cancel();
  }
}

function requireCodexLauncher(status: CodexEnvironmentStatus): CodexLauncher {
  if (!status.available || !status.launcher) {
    throw new Error(status.message ?? "Codex CLI 不可用");
  }
  if (!status.loggedIn) {
    throw new Error(status.message ?? "Codex CLI 尚未登录，请在终端执行 codex login。");
  }
  return status.launcher;
}

function normalizeCodexStatus(status: CodexEnvironmentStatus): CodexEnvironmentStatus {
  if (status.available && status.loggedIn === false && !status.message) {
    return {
      ...status,
      message: "Codex CLI 尚未登录，请在终端执行 codex login。"
    };
  }
  if ((!status.available || !status.launcher) && !status.message) {
    return {
      ...status,
      available: false,
      message: "Codex CLI 不可用"
    };
  }
  return status;
}
