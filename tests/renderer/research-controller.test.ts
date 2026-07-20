import { describe, expect, it } from "vitest";
import type { ResearchProgressEvent } from "../../src/shared/types";
import { ResearchLiveOutputWriter } from "../../src/renderer/features/research/research-controller";

function output(
  outputKind: "status" | "reasoning" | "answer",
  mode: "line" | "stream",
  text: string,
  occurredAt: string
): Extract<ResearchProgressEvent, { type: "output" }> {
  return {
    type: "output",
    recordId: "run-id",
    outputKind,
    mode,
    text,
    occurredAt
  };
}

describe("ResearchLiveOutputWriter", () => {
  it("concatenates stream tokens verbatim and only prefixes a new typed segment", () => {
    const writer = new ResearchLiveOutputWriter();

    expect(writer.append(output("status", "line", "DeepSeek 请求开始", "2026-07-20T12:00:01.000Z")))
      .toBe("[20:00:01] [状态] DeepSeek 请求开始\n");
    expect(writer.append(output("reasoning", "stream", "第", "2026-07-20T12:00:02.000Z")))
      .toBe("[20:00:02] [推理] 第");
    expect(writer.append(output("reasoning", "stream", "二步\n获取财务明细", "2026-07-20T12:00:02.100Z")))
      .toBe("二步\n获取财务明细");
    expect(writer.append(output("answer", "stream", "# 报告", "2026-07-20T12:00:03.000Z")))
      .toBe("\n[20:00:03] [回答] # 报告");
  });

  it("resets the active stream when a new research task starts", () => {
    const writer = new ResearchLiveOutputWriter();
    writer.append(output("reasoning", "stream", "旧任务", "2026-07-20T12:00:01.000Z"));

    writer.reset();

    expect(writer.append(output("reasoning", "stream", "新任务", "2026-07-20T12:00:02.000Z")))
      .toBe("[20:00:02] [推理] 新任务");
  });
});
