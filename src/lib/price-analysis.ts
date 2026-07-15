import { MARKET_PRESETS, PRICE_MARKETS, type PriceMarketCode } from "./price-markets";
import {
  completenessForSeries,
  expectedIntervalsForBelgradeDay,
  type PricePoint,
} from "./trading-calculations";

export interface PriceMarketStats {
  market: PriceMarketCode;
  baseloadAverage: number | null;
  peakAverage: number | null;
  offPeakAverage: number | null;
  minimum: number | null;
  maximum: number | null;
  volatility: number | null;
  negativePriceIntervals: number;
  averageSpreadVsSerbia: number | null;
  minSpreadVsSerbia: number | null;
  maxSpreadVsSerbia: number | null;
  pctAboveSerbia: number | null;
  pctBelowSerbia: number | null;
  correlationWithSerbia: number | null;
  receivedIntervals: number;
  expectedIntervals: number;
  completenessPct: number;
  status: "Current" | "Partial" | "Unavailable";
  reason?: string;
}

export function matchedSpreadPoints(
  marketPoints: PricePoint[],
  serbiaPoints: PricePoint[],
): Array<{ ts: string; spread: number; marketPrice: number; serbiaPrice: number }> {
  const serbiaByTs = new Map(serbiaPoints.map((point) => [point.ts, point.price]));
  return marketPoints.flatMap((point) => {
    const serbiaPrice = serbiaByTs.get(point.ts);
    if (serbiaPrice == null || !Number.isFinite(serbiaPrice) || !Number.isFinite(point.price)) {
      return [];
    }
    return [
      {
        ts: point.ts,
        spread: point.price - serbiaPrice,
        marketPrice: point.price,
        serbiaPrice,
      },
    ];
  });
}

export function resolveMarketPreset(preset: keyof typeof MARKET_PRESETS): PriceMarketCode[] {
  return MARKET_PRESETS[preset].filter((code) => code in PRICE_MARKETS);
}

export function marketAvailabilityStatus(
  points: PricePoint[],
  days: string[],
  reason?: string,
): Pick<
  PriceMarketStats,
  "status" | "receivedIntervals" | "expectedIntervals" | "completenessPct" | "reason"
> {
  const completeness = completenessForSeries(points, days);
  if (!points.length) {
    return {
      status: "Unavailable",
      receivedIntervals: 0,
      expectedIntervals: completeness.expectedIntervals,
      completenessPct: 0,
      reason: reason ?? "No ENTSO-E data",
    };
  }
  return {
    status: completeness.completenessPct >= 98 ? "Current" : "Partial",
    receivedIntervals: completeness.receivedIntervals,
    expectedIntervals: completeness.expectedIntervals,
    completenessPct: completeness.completenessPct,
    reason,
  };
}

export function calculatePriceMarketStats({
  market,
  points,
  serbiaPoints,
  days,
  reason,
}: {
  market: PriceMarketCode;
  points: PricePoint[];
  serbiaPoints: PricePoint[];
  days: string[];
  reason?: string;
}): PriceMarketStats {
  const values = points.map((point) => point.price).filter((value) => Number.isFinite(value));
  const baseloadAverage = mean(values);
  const peakValues: number[] = [];
  const offPeakValues: number[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.price)) continue;
    const hour = belgradeHour(point.ts);
    const weekday = belgradeWeekday(point.ts);
    const isPeak = weekday !== "Sat" && weekday !== "Sun" && hour >= 8 && hour < 20;
    (isPeak ? peakValues : offPeakValues).push(point.price);
  }
  const spreads = market === "RS" ? [] : matchedSpreadPoints(points, serbiaPoints);
  const spreadValues = spreads.map((point) => point.spread);
  const availability = marketAvailabilityStatus(points, days, reason);
  return {
    market,
    baseloadAverage,
    peakAverage: mean(peakValues),
    offPeakAverage: mean(offPeakValues),
    minimum: values.length ? Math.min(...values) : null,
    maximum: values.length ? Math.max(...values) : null,
    volatility:
      baseloadAverage != null && values.length > 1
        ? Math.sqrt(
            values.reduce((sum, value) => sum + (value - baseloadAverage) ** 2, 0) / values.length,
          )
        : null,
    negativePriceIntervals: values.filter((value) => value < 0).length,
    averageSpreadVsSerbia: mean(spreadValues),
    minSpreadVsSerbia: spreadValues.length ? Math.min(...spreadValues) : null,
    maxSpreadVsSerbia: spreadValues.length ? Math.max(...spreadValues) : null,
    pctAboveSerbia: spreadValues.length
      ? (spreadValues.filter((spread) => spread > 0).length / spreadValues.length) * 100
      : null,
    pctBelowSerbia: spreadValues.length
      ? (spreadValues.filter((spread) => spread < 0).length / spreadValues.length) * 100
      : null,
    correlationWithSerbia:
      spreads.length >= 3
        ? correlation(
            spreads.map((point) => point.marketPrice),
            spreads.map((point) => point.serbiaPrice),
          )
        : null,
    ...availability,
  };
}

export function expectedIntervalsForDays(days: string[], stepMinutes = 60): number {
  return days.reduce((sum, day) => sum + expectedIntervalsForBelgradeDay(day, stepMinutes), 0);
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function correlation(a: number[], b: number[]) {
  if (a.length !== b.length || a.length < 3) return null;
  const ma = mean(a);
  const mb = mean(b);
  if (ma == null || mb == null) return null;
  const numerator = a.reduce((sum, value, index) => sum + (value - ma) * (b[index] - mb), 0);
  const da = Math.sqrt(a.reduce((sum, value) => sum + (value - ma) ** 2, 0));
  const db = Math.sqrt(b.reduce((sum, value) => sum + (value - mb) ** 2, 0));
  return da && db ? numerator / (da * db) : null;
}

function belgradeHour(ts: string) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(ts)),
  );
}

function belgradeWeekday(ts: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    weekday: "short",
  }).format(new Date(ts));
}
