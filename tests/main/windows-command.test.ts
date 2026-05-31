import { describe, expect, it } from "vitest";
import {
  buildTrustedCmdWrapperInvocation,
  buildWindowsTaskkillCommand
} from "../../src/main/windows-command";

describe("buildTrustedCmdWrapperInvocation", () => {
  it("quotes the trusted wrapper path and appends fixed arguments", () => {
    expect(buildTrustedCmdWrapperInvocation(
      "C:\\Users\\demo user\\npm\\codex.cmd",
      ["--version"]
    )).toBe('"C:\\Users\\demo user\\npm\\codex.cmd" --version');
  });

  it("rejects unsafe dynamic command arguments", () => {
    expect(() => buildTrustedCmdWrapperInvocation("C:\\codex.cmd", ["a&b"]))
      .toThrow("不支持");
  });
});

describe("buildWindowsTaskkillCommand", () => {
  it("terminates the entire Windows child process tree", () => {
    expect(buildWindowsTaskkillCommand(42)).toEqual({
      file: "taskkill.exe",
      args: ["/pid", "42", "/t", "/f"]
    });
  });
});
