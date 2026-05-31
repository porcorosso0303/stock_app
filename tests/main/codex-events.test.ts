import { describe, expect, it } from "vitest";
import { CodexJsonlParser } from "../../src/main/codex-events";

describe("CodexJsonlParser", () => {
  it("parses lines split across stdout chunks", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('{"type":"item.completed","item":{"text":"调')).toEqual([]);
    expect(parser.push('研中"}}\n')).toEqual([
      expect.objectContaining({ text: "调研中", level: "info" })
    ]);
  });

  it("turns invalid JSON into a warning without interrupting later lines", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('broken\n{"message":"继续"}\n')).toEqual([
      expect.objectContaining({ text: expect.stringContaining("无法解析"), level: "warning" }),
      expect.objectContaining({ text: "继续", level: "info" })
    ]);
  });

  it("formats an unknown JSON event compactly", () => {
    const parser = new CodexJsonlParser();

    expect(parser.push('{"type":"unknown","count":2}\n')[0].text).toBe(
      '{"type":"unknown","count":2}'
    );
  });

  it("flushes a final line without a newline", () => {
    const parser = new CodexJsonlParser();
    parser.push('{"text":"最终输出"}');

    expect(parser.flush()).toEqual([
      expect.objectContaining({ text: "最终输出" })
    ]);
  });
});
