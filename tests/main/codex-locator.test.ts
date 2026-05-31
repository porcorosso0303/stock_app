import { win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CodexLocator } from "../../src/main/codex-locator";

function createHarness(existingPaths: string[], path = "") {
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
      PATH: path,
      APPDATA: "C:\\Users\\demo\\AppData\\Roaming"
    },
    fileExists: async (value) => files.has(win32.normalize(value).toLowerCase()),
    run,
    userPathStore: {
      read: async () => path,
      write: writeUserPath
    }
  });

  return { locator, run, writeUserPath };
}

describe("CodexLocator", () => {
  it("prefers codex.exe found in the current PATH", async () => {
    const { locator } = createHarness(["C:\\tools\\codex.exe"], "C:\\tools");

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

  it("returns a clear status when Codex is missing", async () => {
    const { locator } = createHarness([]);

    await expect(locator.detect()).resolves.toMatchObject({
      available: false,
      message: expect.stringContaining("未找到")
    });
  });
});
