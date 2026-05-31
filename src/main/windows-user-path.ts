import { execFile } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandOptions {
  env?: NodeJS.ProcessEnv;
}

export type RunCommand = (
  file: string,
  args: string[],
  options?: CommandOptions
) => Promise<CommandResult>;

export function appendPathEntry(
  existingPath: string,
  entry: string,
  separator = ";"
): string {
  const entries = existingPath.split(separator).filter(Boolean);
  const normalizedEntry = normalizeWindowsPath(entry);
  if (entries.some((value) => normalizeWindowsPath(value) === normalizedEntry)) {
    return entries.join(separator);
  }
  return [...entries, entry].join(separator);
}

export class PowerShellUserPathStore {
  constructor(private readonly run: RunCommand = runFileCommand) {}

  async read(): Promise<string> {
    const result = await this.run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "[Environment]::GetEnvironmentVariable('Path', 'User')"
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`读取 Windows 用户 PATH 失败：${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  async write(value: string): Promise<void> {
    const result = await this.run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Environment]::SetEnvironmentVariable('Path', $env:STOCK_TOOL_USER_PATH, 'User')"
      ],
      {
        env: {
          ...process.env,
          STOCK_TOOL_USER_PATH: value
        }
      }
    );
    if (result.exitCode !== 0) {
      throw new Error(`更新 Windows 用户 PATH 失败：${result.stderr.trim()}`);
    }
  }
}

export function runFileCommand(
  file: string,
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        env: options.env,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolve({
          stdout,
          stderr,
          exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0
        });
      }
    );
  });
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/[\\/]+$/, "").toLowerCase();
}
