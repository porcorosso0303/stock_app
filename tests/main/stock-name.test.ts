import { describe, expect, it } from "vitest";
import {
  buildPdfFileName,
  sanitizeWindowsFilePart,
  validateStockName
} from "../../src/main/stock-name";

describe("validateStockName", () => {
  it("trims a valid stock name", () => {
    expect(validateStockName(" 贵州茅台 ")).toBe("贵州茅台");
  });

  it("rejects an empty stock name", () => {
    expect(() => validateStockName("   ")).toThrow("请输入A股标的名称");
  });

  it("rejects an excessively long stock name", () => {
    expect(() => validateStockName("A".repeat(81))).toThrow("不能超过80个字符");
  });
});

describe("sanitizeWindowsFilePart", () => {
  it("replaces invalid Windows filename characters", () => {
    expect(sanitizeWindowsFilePart('A/B:C*D?"E<F>G|')).toBe("A_B_C_D__E_F_G_");
  });

  it("removes trailing dots and spaces", () => {
    expect(sanitizeWindowsFilePart("贵州茅台... ")).toBe("贵州茅台");
  });
});

describe("buildPdfFileName", () => {
  it("uses a sanitized stock name with local date and time", () => {
    const date = new Date(2026, 4, 31, 14, 30, 25);
    expect(buildPdfFileName("贵州/茅台", date)).toBe(
      "贵州_茅台_2026-05-31_143025.pdf"
    );
  });
});
