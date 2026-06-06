import type { StockTrendPoint } from "../../../../shared/types";

export interface RawIntradayTrendPoint {
  time: string;
  price?: number;
}

export function calculateChangePercent(
  price: number | undefined,
  previousClose: number | undefined
): number | undefined {
  if (
    price === undefined ||
    previousClose === undefined ||
    !Number.isFinite(price) ||
    !Number.isFinite(previousClose) ||
    previousClose <= 0
  ) {
    return undefined;
  }
  return ((price - previousClose) / previousClose) * 100;
}

export function normalizeIntradayTrendPoints(
  points: RawIntradayTrendPoint[],
  previousClose: number | undefined
): StockTrendPoint[] {
  return points
    .flatMap((point) => {
      const changePercent = calculateChangePercent(point.price, previousClose);
      return changePercent === undefined || point.price === undefined
        ? []
        : [{
            time: point.time,
            price: point.price,
            changePercent
          }];
    })
    .sort((left, right) => trendMinute(left.time) - trendMinute(right.time));
}

function trendMinute(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}
