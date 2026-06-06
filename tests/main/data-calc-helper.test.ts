import { describe, expect, it } from "vitest";
import {
  calculateChangePercent,
  normalizeIntradayTrendPoints
} from "../../src/main/modules/watch/market-data/data-calc-helper";

describe("data calc helper", () => {
  it("calculates change percent from price and previous close", () => {
    expect(calculateChangePercent(105, 100)).toBe(5);
    expect(calculateChangePercent(98, 100)).toBe(-2);
  });

  it("returns undefined for invalid previous close or price", () => {
    expect(calculateChangePercent(105, 0)).toBeUndefined();
    expect(calculateChangePercent(105, -1)).toBeUndefined();
    expect(calculateChangePercent(undefined, 100)).toBeUndefined();
  });

  it("normalizes intraday trend points with change percent", () => {
    expect(normalizeIntradayTrendPoints([
      { time: "09:31", price: 102 },
      { time: "09:30", price: 101 },
      { time: "09:32" }
    ], 100)).toEqual([
      { time: "09:30", price: 101, changePercent: 1 },
      { time: "09:31", price: 102, changePercent: 2 }
    ]);
  });
});
