import type { StockLimitStatus, StockTrendPoint } from "./types";

export interface RawIntradayTrendPoint {
  time: string;
  price?: number;
}

export interface SectorStrengthQuoteInput {
  secid: string;
  changePercent?: number;
  limitRate?: number;
  limitStatus?: StockLimitStatus;
}

export interface SectorStrengthIndex {
  total: number;
  available: number;
  up: number;
  down: number;
  flat: number;
  limitUp: number;
  limitDown: number;
  changeStrengthScore?: number;
  absoluteSeverityScore?: number;
  magnitudeScore?: number;
  breadthScore?: number;
  breadthWeight?: number;
  baseScore?: number;
  limitImpactScore?: number;
  score?: number;
}

export interface SuddenStockMove {
  direction: "up" | "down";
  deltaPercent: number;
}

const LIMIT_EVENT_BASE_IMPACT = 12;
const LIMIT_EVENT_DIFFUSION_MULTIPLIER = 80;
const LIMIT_EVENT_IMPACT_CAP = 35;
const LIMIT_RELATIVE_MAGNITUDE_WEIGHT = 0.45;
const ABSOLUTE_SEVERITY_MAGNITUDE_WEIGHT = 0.55;
const ABSOLUTE_SEVERITY_SCALE_PERCENT = 4;
const MIN_BREADTH_WEIGHT = 0.25;
const BREADTH_SAMPLE_WEIGHT_BONUS = 0.15;
const BREADTH_SAMPLE_REFERENCE_SIZE = 20;
const LIMIT_STATUS_THRESHOLD = 0.995;
const SUDDEN_MOVE_WINDOW_MINUTES = 5;
const SUDDEN_MOVE_THRESHOLD_PERCENT = 1.2;

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

export function hasCompleteIntradayCoverage(
  points: Pick<StockTrendPoint, "time">[],
  tradingDate: string,
  now: Date = new Date()
): boolean {
  const requiredMinute = requiredIntradayCoverageMinute(tradingDate, now);
  const pointTimes = new Set(points.map((point) => point.time));
  return requiredTradingMinutes(requiredMinute).every((time) => pointTimes.has(time));
}

export function calculateSectorStrengthIndex(
  quotes: SectorStrengthQuoteInput[]
): SectorStrengthIndex {
  const result: SectorStrengthIndex = {
    total: quotes.length,
    available: 0,
    up: 0,
    down: 0,
    flat: 0,
    limitUp: 0,
    limitDown: 0
  };
  const availableQuotes = quotes.flatMap((quote) => {
    const changePercent = quote.changePercent;
    if (changePercent === undefined || !Number.isFinite(changePercent)) {
      return [];
    }
    const limitRate = resolveLimitRate(quote);
    const normalizedChange = clamp(changePercent / limitRate, -1, 1);
    const absoluteSeverity = Math.tanh(changePercent / ABSOLUTE_SEVERITY_SCALE_PERCENT);
    const limitStatus = resolveLimitStatus(quote, limitRate);
    return [{ changePercent, normalizedChange, absoluteSeverity, limitStatus }];
  });

  if (availableQuotes.length === 0) {
    return result;
  }

  const counts = availableQuotes.reduce((next, quote) => {
    const direction = quote.changePercent === 0 ? "flat" : quote.changePercent > 0 ? "up" : "down";
    const limitDirection = quote.limitStatus;
    return {
      up: next.up + (direction === "up" ? 1 : 0),
      down: next.down + (direction === "down" ? 1 : 0),
      flat: next.flat + (direction === "flat" ? 1 : 0),
      limitUp: next.limitUp + (limitDirection === "up" ? 1 : 0),
      limitDown: next.limitDown + (limitDirection === "down" ? 1 : 0)
    };
  }, {
    up: 0,
    down: 0,
    flat: 0,
    limitUp: 0,
    limitDown: 0
  });

  const available = availableQuotes.length;
  const changeStrengthScore = (
    availableQuotes.reduce((sum, quote) => sum + quote.normalizedChange, 0) / available
  ) * 100;
  const absoluteSeverityScore = (
    availableQuotes.reduce((sum, quote) => sum + quote.absoluteSeverity, 0) / available
  ) * 100;
  const magnitudeScore = (
    changeStrengthScore * LIMIT_RELATIVE_MAGNITUDE_WEIGHT +
    absoluteSeverityScore * ABSOLUTE_SEVERITY_MAGNITUDE_WEIGHT
  );
  const breadthScore = ((counts.up - counts.down) / available) * 100;
  const breadthWeight = calculateBreadthWeight(available);
  const baseScore = magnitudeScore * (1 - breadthWeight) + breadthScore * breadthWeight;
  const limitImpactScore = calculateLimitEventImpact(
    counts.limitUp,
    counts.limitDown,
    available
  );

  return {
    ...result,
    ...counts,
    available,
    changeStrengthScore,
    absoluteSeverityScore,
    magnitudeScore,
    breadthScore,
    breadthWeight,
    baseScore,
    limitImpactScore,
    score: clamp(baseScore + limitImpactScore, -100, 100)
  };
}

export function calculateSuddenStockMove(
  points: StockTrendPoint[],
  windowMinutes = SUDDEN_MOVE_WINDOW_MINUTES,
  thresholdPercent = SUDDEN_MOVE_THRESHOLD_PERCENT
): SuddenStockMove | undefined {
  const orderedPoints = [...points]
    .filter((point) => Number.isFinite(point.changePercent))
    .sort((left, right) => trendMinute(left.time) - trendMinute(right.time));
  if (orderedPoints.length < 2 || windowMinutes <= 0 || thresholdPercent <= 0) {
    return undefined;
  }

  const latest = orderedPoints.at(-1);
  if (!latest) {
    return undefined;
  }
  const startMinute = trendMinute(latest.time) - windowMinutes;
  const baseline = findBaselinePoint(orderedPoints, startMinute) ?? orderedPoints[0];
  if (baseline === latest) {
    return undefined;
  }

  const deltaPercent = roundPercentDelta(latest.changePercent - baseline.changePercent);
  if (Math.abs(deltaPercent) < thresholdPercent) {
    return undefined;
  }
  return {
    direction: deltaPercent > 0 ? "up" : "down",
    deltaPercent
  };
}

function findBaselinePoint(
  points: StockTrendPoint[],
  startMinute: number
): StockTrendPoint | undefined {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point && trendMinute(point.time) <= startMinute) {
      return point;
    }
  }
  return undefined;
}

function calculateLimitEventImpact(limitUp: number, limitDown: number, total: number): number {
  const netLimit = limitUp - limitDown;
  if (netLimit === 0 || total <= 0) {
    return 0;
  }
  const direction = Math.sign(netLimit);
  const baseImpact = LIMIT_EVENT_BASE_IMPACT * direction;
  const diffusionImpact = LIMIT_EVENT_DIFFUSION_MULTIPLIER * (netLimit / total);
  return clamp(baseImpact + diffusionImpact, -LIMIT_EVENT_IMPACT_CAP, LIMIT_EVENT_IMPACT_CAP);
}

function calculateBreadthWeight(available: number): number {
  const sampleRatio = Math.sqrt(Math.min(available, BREADTH_SAMPLE_REFERENCE_SIZE) / BREADTH_SAMPLE_REFERENCE_SIZE);
  return MIN_BREADTH_WEIGHT + BREADTH_SAMPLE_WEIGHT_BONUS * sampleRatio;
}

function resolveLimitStatus(
  quote: SectorStrengthQuoteInput,
  limitRate: number
): StockLimitStatus {
  if (quote.limitStatus) {
    return quote.limitStatus;
  }
  const changePercent = quote.changePercent;
  if (changePercent === undefined || !Number.isFinite(changePercent) || limitRate <= 0) {
    return "none";
  }
  const normalized = changePercent / limitRate;
  if (normalized >= LIMIT_STATUS_THRESHOLD) {
    return "up";
  }
  if (normalized <= -LIMIT_STATUS_THRESHOLD) {
    return "down";
  }
  return "none";
}

function resolveLimitRate(quote: SectorStrengthQuoteInput): number {
  if (quote.limitRate !== undefined && Number.isFinite(quote.limitRate) && quote.limitRate > 0) {
    return quote.limitRate;
  }
  return inferStockLimitRate(quote.secid);
}

function inferStockLimitRate(secid: string): number {
  const code = secid.split(".")[1] ?? "";
  if (/^(300|301|688|689)/.test(code)) {
    return 20;
  }
  if (/^(4|8|920)/.test(code)) {
    return 30;
  }
  return 10;
}

function trendMinute(time: string): number {
  const [hour = "0", minute = "0"] = time.split(":");
  return Number(hour) * 60 + Number(minute);
}

function requiredIntradayCoverageMinute(tradingDate: string, now: Date): string {
  const currentDate = formatChinaDate(now);
  if (tradingDate !== currentDate) {
    return "15:00";
  }
  const currentMinute = formatChinaMinute(now);
  if (currentMinute < "09:30") {
    return "15:00";
  }
  if (currentMinute <= "11:30") {
    return currentMinute;
  }
  if (currentMinute < "13:00") {
    return "11:30";
  }
  if (currentMinute <= "15:00") {
    return currentMinute;
  }
  return "15:00";
}

function requiredTradingMinutes(endTime: string): string[] {
  const endMinute = trendMinute(endTime);
  return [
    ...tradingSessionMinutes("09:30", "11:30"),
    ...tradingSessionMinutes("13:01", "15:00")
  ].filter((time) => trendMinute(time) <= endMinute);
}

function tradingSessionMinutes(startTime: string, endTime: string): string[] {
  const minutes: string[] = [];
  for (let minute = trendMinute(startTime); minute <= trendMinute(endTime); minute += 1) {
    const hour = Math.floor(minute / 60);
    const minuteWithinHour = minute % 60;
    minutes.push(`${String(hour).padStart(2, "0")}:${String(minuteWithinHour).padStart(2, "0")}`);
  }
  return minutes;
}

function formatChinaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function formatChinaMinute(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("hour")}:${byType.get("minute")}`;
}

function roundPercentDelta(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
