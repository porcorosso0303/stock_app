import { describe, expect, it } from "vitest";
import type { StockQuote } from "../../src/shared/types";
import {
  calculateSectorStrengthIndex,
  calculateSuddenStockMove
} from "../../src/shared/data-calc-helper";

describe("sector strength index algorithm", () => {
  it("keeps normal stock moves visible when no stock reaches its limit", () => {
    const result = calculateSectorStrengthIndex([
      quote("1.600001", 5),
      quote("1.600002", 3)
    ]);

    expect(result.changeStrengthScore).toBe(40);
    expect(result.absoluteSeverityScore).toBeCloseTo(74.1716, 4);
    expect(result.magnitudeScore).toBeCloseTo(58.7944, 4);
    expect(result.breadthScore).toBe(100);
    expect(result.breadthWeight).toBeCloseTo(0.2974, 4);
    expect(result.baseScore).toBeCloseTo(71.0504, 4);
    expect(result.limitImpactScore).toBe(0);
    expect(result.score).toBeCloseTo(71.0504, 4);
  });

  it("separates fully declining sectors by absolute decline severity", () => {
    const milderDecline = calculateSectorStrengthIndex([
      quote("1.600001", -3.02),
      quote("1.600002", -3.46)
    ]);
    const deeperDecline = calculateSectorStrengthIndex([
      quote("1.600003", -3.07),
      quote("1.688001", -4.94),
      quote("1.600004", -5.57)
    ]);

    expect(milderDecline.breadthScore).toBe(-100);
    expect(deeperDecline.breadthScore).toBe(-100);
    expect(milderDecline.score).toBeCloseTo(-65.8174, 4);
    expect(deeperDecline.score).toBeCloseTo(-72.4442, 4);
    expect((milderDecline.score ?? 0) - (deeperDecline.score ?? 0)).toBeGreaterThan(6);
  });

  it("adds a visible positive event impact when a limit-up stock appears", () => {
    const result = calculateSectorStrengthIndex([
      quote("1.600001", 10),
      quote("1.600002", 1),
      quote("1.600003", 1),
      quote("1.600004", 1),
      quote("1.600005", 1),
      quote("1.600006", -1),
      quote("1.600007", -1),
      quote("1.600008", -1),
      quote("1.600009", -1),
      quote("1.600010", -1)
    ]);

    expect(result.limitUp).toBe(1);
    expect(result.limitDown).toBe(0);
    expect(result.baseScore).toBeCloseTo(5.2347, 4);
    expect(result.limitImpactScore).toBe(20);
    expect(result.score).toBeCloseTo(25.2347, 4);
  });

  it("adds a symmetric negative event impact when a limit-down stock appears", () => {
    const result = calculateSectorStrengthIndex([
      quote("1.600001", -10),
      quote("1.600002", -1),
      quote("1.600003", -1),
      quote("1.600004", -1),
      quote("1.600005", -1),
      quote("1.600006", 1),
      quote("1.600007", 1),
      quote("1.600008", 1),
      quote("1.600009", 1),
      quote("1.600010", 1)
    ]);

    expect(result.limitUp).toBe(0);
    expect(result.limitDown).toBe(1);
    expect(result.baseScore).toBeCloseTo(-5.2347, 4);
    expect(result.limitImpactScore).toBe(-20);
    expect(result.score).toBeCloseTo(-25.2347, 4);
  });

  it("caps the limit event impact so extreme breadth does not dominate the score", () => {
    const result = calculateSectorStrengthIndex([
      quote("1.600001", 10),
      quote("1.600002", 10),
      quote("1.600003", 10),
      quote("1.600004", 10),
      quote("1.600005", 10),
      quote("1.600006", 1),
      quote("1.600007", 1),
      quote("1.600008", 1),
      quote("1.600009", 1),
      quote("1.600010", 1)
    ]);

    expect(result.limitUp).toBe(5);
    expect(result.limitImpactScore).toBe(35);
    expect(result.score).toBe(100);
  });
});

describe("sudden stock move algorithm", () => {
  it("detects a sudden upward move over the recent intraday window", () => {
    expect(calculateSuddenStockMove([
      { time: "09:30", changePercent: 0.1 },
      { time: "09:31", changePercent: 0.3 },
      { time: "09:34", changePercent: 1.6 }
    ])).toEqual({
      direction: "up",
      deltaPercent: 1.5
    });
  });

  it("detects a sudden downward move over the recent intraday window", () => {
    expect(calculateSuddenStockMove([
      { time: "10:00", changePercent: 1.2 },
      { time: "10:02", changePercent: 0.5 },
      { time: "10:05", changePercent: -0.4 }
    ])).toEqual({
      direction: "down",
      deltaPercent: -1.6
    });
  });

  it("ignores normal noise below the sudden move threshold", () => {
    expect(calculateSuddenStockMove([
      { time: "13:01", changePercent: 2.0 },
      { time: "13:03", changePercent: 2.4 },
      { time: "13:06", changePercent: 2.8 }
    ])).toBeUndefined();
  });
});

function quote(secid: string, changePercent: number): StockQuote {
  return {
    secid,
    changePercent,
    fetchedAt: "2026-06-08T07:00:00.000Z"
  };
}
