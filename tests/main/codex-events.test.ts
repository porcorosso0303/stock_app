import { describe, expect, it } from "vitest";
import { CodexJsonlParser } from "../../src/main/codex-events";

describe("CodexJsonlParser", () => {
  it("parses lines split across stdout chunks", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('{"type":"item.completed","item":{"type":"reasoning","text":"调')).toEqual([]);
    expect(parser.push('研中"}}\n')).toEqual([
      expect.objectContaining({ text: "调研中", level: "info" })
    ]);
  });

  it("hides invalid JSON without interrupting later readable lines", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('broken\n{"message":"继续"}\n')).toEqual([
      expect.objectContaining({ text: "继续", level: "info" })
    ]);
  });

  it("hides unknown runtime events", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('{"type":"unknown","count":2}\n')).toEqual([]);
  });

  it("translates web searches into a Chinese progress message", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('{"type":"item.started","item":{"type":"web_search","query":"贵州茅台 年报"}}\n'))
      .toEqual([expect.objectContaining({ text: "正在搜索：贵州茅台 年报" })]);
  });

  it("hides command execution output even when it contains Chinese text", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('{"type":"item.completed","item":{"type":"command_execution","text":"命令执行完成"}}\n'))
      .toEqual([]);
  });

  it("hides generic English runtime messages", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('{"message":"turn started"}\n')).toEqual([]);
  });

  it("wraps errors in a Chinese user-facing message", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('{"type":"turn.failed","error":{"message":"network error"}}\n'))
      .toEqual([expect.objectContaining({
        text: "调研过程中出现错误：network error",
        level: "error"
      })]);
  });

  it("flushes a final line without a newline", () => {
    const parser = new CodexJsonlParser();
    parser.push('{"text":"最终输出"}');

    expect(parser.flush()).toEqual([
      expect.objectContaining({ text: "最终输出" })
    ]);
  });
});
