import { describe, expect, it, vi } from "vitest";
import {
  appendPathEntry,
  PowerShellUserPathStore,
  runFileCommand
} from "../../src/main/windows-user-path";

describe("appendPathEntry", () => {
  it("does not add a Windows path twice with different casing", () => {
    expect(appendPathEntry("C:\\A;C:\\B", "c:\\a", ";")).toBe("C:\\A;C:\\B");
  });

  it("appends a missing path", () => {
    expect(appendPathEntry("C:\\A", "C:\\B", ";")).toBe("C:\\A;C:\\B");
  });
});

describe("PowerShellUserPathStore", () => {
  it("writes a user-level path without embedding its value into the script", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const store = new PowerShellUserPathStore(run);

    await store.write("C:\\Users\\demo\\AppData\\Roaming\\npm");

    expect(run).toHaveBeenCalledWith(
      "powershell.exe",
      expect.arrayContaining(["-Command", expect.stringContaining("'User'")]),
      expect.objectContaining({
        env: expect.objectContaining({
          STOCK_TOOL_USER_PATH: "C:\\Users\\demo\\AppData\\Roaming\\npm"
        })
      })
    );
    expect(run.mock.calls[0][1].join(" ")).not.toContain("AppData");
  });
});

describe("runFileCommand", () => {
  it("stops an external command that exceeds its timeout", async () => {
    const startedAt = Date.now();

    const result = await runFileCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 10_000)"],
      { timeoutMs: 20 }
    );

    expect(result.exitCode).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
