import { win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CodexLocator } from "../../src/main/codex-locator";

function createHarness(existingPaths: string[], options: {
  processPath?: string;
  userPath?: string;
  readUserPathError?: Error;
} = {}) {
  const processPath = options.processPath ?? "";
  const userPath = options.userPath ?? processPath;
  const files = new Set(existingPaths.map((value) => win32.normalize(value).toLowerCase()));
  const writeUserPath = vi.fn().mockResolvedValue(undefined);
  const run = vi.fn().mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes("--version")) {
      return { stdout: "codex-cli 0.135.0\n", stderr: "", exitCode: 0 };
    }
    if (args.includes("status")) {
      return { stdout: "Logged in\n", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  });

  const locator = new CodexLocator({
    platform: "win32",
    env: {
      PATH: processPath,
      APPDATA: "C:\\Users\\demo\\AppData\\Roaming"
    },
    fileExists: async (value) => files.has(win32.normalize(value).toLowerCase()),
    run,
    userPathStore: {
      read: async () => {
        if (options.readUserPathError) {
          throw options.readUserPathError;
        }
        return userPath;
      },
      write: writeUserPath
    }
  });

  return { locator, run, writeUserPath };
}

describe("CodexLocator", () => {
  it("prefers codex.exe found in the current PATH", async () => {
    const { locator } = createHarness(["C:\\tools\\codex.exe"], {
      processPath: "C:\\tools"
    });

    await expect(locator.detect()).resolves.toMatchObject({
      available: true,
      launcher: { kind: "native", executablePath: "C:\\tools\\codex.exe" },
      loggedIn: true,
      repairedUserPath: false
    });
  });

  it("finds codex.cmd in the roaming npm directory and repairs the user PATH", async () => {
    const wrapper = "C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd";
    const { locator, run, writeUserPath } = createHarness([wrapper]);

    await expect(locator.detect()).resolves.toMatchObject({
      available: true,
      launcher: { kind: "cmd-wrapper", executablePath: wrapper },
      repairedUserPath: true
    });
    expect(writeUserPath).toHaveBeenCalledWith("C:\\Users\\demo\\AppData\\Roaming\\npm");
    expect(run).toHaveBeenCalledWith(
      "cmd.exe",
      expect.arrayContaining(["/c", expect.stringContaining("codex.cmd")])
    );
  });

  it("prefers the npm package native executable over its wrapper", async () => {
    const npm = "C:\\Users\\demo\\AppData\\Roaming\\npm";
    const wrapper = `${npm}\\codex.cmd`;
    const native = `${npm}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
    const { locator } = createHarness([wrapper, native]);

    await expect(locator.detect()).resolves.toMatchObject({
      launcher: { kind: "native", executablePath: native }
    });
  });

  it("does not rewrite the persisted user PATH when only the app process PATH is stale", async () => {
    const npm = "C:\\Users\\demo\\AppData\\Roaming\\npm";
    const wrapper = `${npm}\\codex.cmd`;
    const { locator, writeUserPath } = createHarness([wrapper], {
      processPath: "C:\\Windows",
      userPath: `C:\\Windows;${npm}`
    });

    await expect(locator.detect()).resolves.toMatchObject({
      available: true,
      repairedUserPath: true
    });
    expect(writeUserPath).not.toHaveBeenCalled();
  });

  it("continues using Codex when persisting the user PATH fails", async () => {
    const wrapper = "C:\\Users\\demo\\AppData\\Roaming\\npm\\codex.cmd";
    const { locator } = createHarness([wrapper], {
      processPath: "C:\\Windows",
      readUserPathError: new Error("PowerShell blocked")
    });

    await expect(locator.detect()).resolves.toMatchObject({
      available: true,
      loggedIn: true,
      message: expect.stringContaining("PATH")
    });
  });

  it("returns a clear status when Codex is missing", async () => {
    const { locator } = createHarness([]);

    await expect(locator.detect()).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("未找到")
    });
  });
});
