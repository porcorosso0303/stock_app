import { describe, expect, it } from "vitest";
import {
  canRetryPdf,
  codexStatusMessage,
  DEEPSEEK_CUSTOM_MODEL_OPTION,
  formatElapsedTime,
  initializationErrorMessage,
  primaryActionLabel,
  resolveDeepSeekModelForm,
  resolveDeepSeekModelValue,
  researchRecordStatusMessage,
  sortHistory
} from "../../src/renderer/view-model";
import type { ResearchRecord } from "../../src/shared/types";

function record(id: string, createdAt: string): ResearchRecord {
  return {
    id,
    stockName: id,
    createdAt,
    updatedAt: createdAt,
    status: "completed",
    reportMarkdownPath: "report.md",
    eventsPath: "events.jsonl",
    stderrPath: "stderr.log"
  };
}

describe("primaryActionLabel", () => {
  it("shows stop while research is running", () => {
    expect(primaryActionLabel(true)).toBe("停止调研");
    expect(primaryActionLabel(false)).toBe("调研");
  });
});

describe("sortHistory", () => {
  it("returns newest history records first", () => {
    expect(sortHistory([
      record("old", "2026-05-30T00:00:00.000Z"),
      record("new", "2026-05-31T00:00:00.000Z")
    ]).map(({ id }) => id)).toEqual(["new", "old"]);
  });
});

describe("canRetryPdf", () => {
  it("allows retry only after PDF export failure", () => {
    expect(canRetryPdf({ ...record("one", ""), status: "completed_pdf_failed" })).toBe(true);
    expect(canRetryPdf(record("two", ""))).toBe(false);
  });
});

describe("codexStatusMessage", () => {
  it("distinguishes missing Codex from a missing login", () => {
    expect(codexStatusMessage({ available: false })).toContain("未检测到");
    expect(codexStatusMessage({ available: true, loggedIn: false })).toContain("codex login");
    expect(codexStatusMessage({
      available: true,
      loggedIn: true,
      version: "codex-cli 0.135.0"
    })).toContain("0.135.0");
  });
});

describe("initializationErrorMessage", () => {
  it("turns preload and bootstrap failures into visible messages", () => {
    expect(initializationErrorMessage(new Error("preload failed"))).toContain("preload failed");
  });
});

describe("researchRecordStatusMessage", () => {
  it("includes the CLI error for failed research records", () => {
    expect(researchRecordStatusMessage({
      ...record("failed", ""),
      status: "failed",
      errorMessage: "unexpected argument '-a'"
    })).toContain("unexpected argument '-a'");
  });
});

describe("formatElapsedTime", () => {
  it("formats elapsed research time as minutes and seconds", () => {
    expect(formatElapsedTime(0)).toBe("00:00");
    expect(formatElapsedTime(65_900)).toBe("01:05");
  });
});

describe("DeepSeek model selection", () => {
  it("maps official models directly to the preset select", () => {
    expect(resolveDeepSeekModelForm("deepseek-v4-pro")).toEqual({
      preset: "deepseek-v4-pro",
      custom: ""
    });
    expect(resolveDeepSeekModelForm("deepseek-v4-flash")).toEqual({
      preset: "deepseek-v4-flash",
      custom: ""
    });
  });

  it("preserves an existing custom model name", () => {
    expect(resolveDeepSeekModelForm("gateway-reasoner")).toEqual({
      preset: DEEPSEEK_CUSTOM_MODEL_OPTION,
      custom: "gateway-reasoner"
    });
  });

  it("submits the selected official model or trimmed custom model", () => {
    expect(resolveDeepSeekModelValue("deepseek-v4-flash", "ignored")).toBe("deepseek-v4-flash");
    expect(resolveDeepSeekModelValue(DEEPSEEK_CUSTOM_MODEL_OPTION, "  local-model  ")).toBe("local-model");
  });

  it("uses a fallback only when a custom model is empty", () => {
    expect(resolveDeepSeekModelValue(DEEPSEEK_CUSTOM_MODEL_OPTION, "  ")).toBe("");
    expect(resolveDeepSeekModelValue(DEEPSEEK_CUSTOM_MODEL_OPTION, "  ", "deepseek-v4-pro"))
      .toBe("deepseek-v4-pro");
  });
});
