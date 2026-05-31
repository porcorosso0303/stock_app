import { access } from "node:fs/promises";
import { delimiter, join, win32 } from "node:path";
import type {
  CodexEnvironmentStatus,
  CodexLauncher
} from "../shared/types";
import {
  appendPathEntry,
  PowerShellUserPathStore,
  runFileCommand,
  type RunCommand
} from "./windows-user-path";
import { buildCmdWrapperCommand } from "./windows-command";

interface UserPathStore {
  read(): Promise<string>;
  write(value: string): Promise<void>;
}

interface CodexLocatorOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => Promise<boolean>;
  run?: RunCommand;
  userPathStore?: UserPathStore;
}

export class CodexLocator {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly fileExists: (path: string) => Promise<boolean>;
  private readonly run: RunCommand;
  private readonly userPathStore: UserPathStore;

  constructor(options: CodexLocatorOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.fileExists = options.fileExists ?? pathExists;
    this.run = options.run ?? runFileCommand;
    this.userPathStore = options.userPathStore ?? new PowerShellUserPathStore(this.run);
  }

  async detect(): Promise<CodexEnvironmentStatus> {
    const located = await this.findLauncher();
    if (!located) {
      return {
        available: false,
        message: "未找到 Codex CLI，请先安装 Codex CLI 后重新检测。"
      };
    }

    const repairedUserPath = await this.repairUserPathIfNeeded(located.directory);
    const version = await this.runLauncher(located.launcher, ["--version"]);
    if (version.exitCode !== 0) {
      return {
        available: false,
        launcher: located.launcher,
        repairedUserPath,
        message: `Codex CLI 无法运行：${version.stderr.trim() || "未知错误"}`
      };
    }

    const login = await this.runLauncher(located.launcher, ["login", "status"]);
    return {
      available: true,
      launcher: located.launcher,
      version: version.stdout.trim(),
      loggedIn: login.exitCode === 0,
      repairedUserPath,
      message: login.exitCode === 0
        ? undefined
        : "Codex CLI 尚未登录，请在终端执行 codex login。"
    };
  }

  private async findLauncher(): Promise<{
    launcher: CodexLauncher;
    directory: string;
  } | undefined> {
    const separator = this.platform === "win32" ? ";" : delimiter;
    const pathDirectories = (this.env.PATH ?? "").split(separator).filter(Boolean);
    const directories = [...pathDirectories];

    if (this.platform === "win32" && this.env.APPDATA) {
      directories.push(win32.join(this.env.APPDATA, "npm"));
    }

    for (const directory of uniqueCaseInsensitive(directories)) {
      const native = joinForPlatform(this.platform, directory, "codex.exe");
      if (await this.fileExists(native)) {
        return { launcher: { kind: "native", executablePath: native }, directory };
      }

      const wrapper = joinForPlatform(this.platform, directory, this.platform === "win32"
        ? "codex.cmd"
        : "codex");
      if (await this.fileExists(wrapper)) {
        const packagedNative = await this.findPackagedNative(directory);
        return {
          launcher: packagedNative
            ? { kind: "native", executablePath: packagedNative }
            : { kind: "cmd-wrapper", executablePath: wrapper },
          directory
        };
      }
    }

    return undefined;
  }

  private async findPackagedNative(wrapperDirectory: string): Promise<string | undefined> {
    if (this.platform !== "win32") {
      return undefined;
    }

    const packageRoot = win32.join(wrapperDirectory, "node_modules", "@openai", "codex");
    const candidates = [
      win32.join(
        packageRoot,
        "node_modules",
        "@openai",
        "codex-win32-x64",
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe"
      ),
      win32.join(
        packageRoot,
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe"
      )
    ];

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private async repairUserPathIfNeeded(directory: string): Promise<boolean> {
    if (this.platform !== "win32") {
      return false;
    }
    const currentProcessPath = this.env.PATH ?? "";
    const updatedProcessPath = appendPathEntry(currentProcessPath, directory);
    if (updatedProcessPath === currentProcessPath) {
      return false;
    }

    const userPath = await this.userPathStore.read();
    await this.userPathStore.write(appendPathEntry(userPath, directory));
    this.env.PATH = updatedProcessPath;
    return true;
  }

  private async runLauncher(
    launcher: CodexLauncher,
    args: string[]
  ) {
    if (launcher.kind === "cmd-wrapper" && this.platform === "win32") {
      const command = buildCmdWrapperCommand(
        launcher.executablePath,
        args,
        this.env.ComSpec
      );
      return await this.run(command.file, command.args);
    }
    return await this.run(launcher.executablePath, args);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function joinForPlatform(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === "win32" ? win32.join(...parts) : join(...parts);
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}
