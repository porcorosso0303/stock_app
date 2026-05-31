import type { CodexLauncher } from "../shared/types";

export function getCodexLauncherOverride(
  env: NodeJS.ProcessEnv = process.env
): CodexLauncher | undefined {
  const executablePath = env.STOCK_TOOL_CODEX_EXECUTABLE?.trim();
  return executablePath
    ? { kind: "native", executablePath }
    : undefined;
}
