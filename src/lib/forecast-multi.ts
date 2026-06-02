// Multi-product forecasting for Serbia power.
// Re-uses ARIMA-lite from ./forecast for hourly DA, and adds weekly/monthly
// aggregation helpers + blending with EEX market anchors and fundamentals.

import { forecastPrices, type ForecastPoint } from "./forecast";

export type Product = "da" | "week" | "month";
export type LoadType = "baseload" | "peak" | "offpeak";

export interface HourlyPoint { ts: string; price: number }

const PEAK_START = 8;  // 08:00 CET
const PEAK_END = 20;   // 20:00 CET (exclusive)

function isPeakHour(iso: string): boolean {
  // EEX/SEEPEX peak = 08:00..20:00 CET, Mon-Fri.
  const d = new Date(iso);
  const utcH = d.getUTCHours();
  // Approx CET offset (treat winter +1 / summer +2). Use Europe/Belgrade via Intl.
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade", hour: "2-digit", weekday: "short", hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const h = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
    const wd = parts.find(p => p.type === "weekday")?.value ?? "";
    const weekday = !["Sat", "Sun"].includes(wd);
    return weekday && h >= PEAK_START && h < PEAK_END;
  } catch {
    return utcH >= PEAK_START && utcH < PEAK_END;
  }
}

export function filterByLoadType(points: HourlyPoint[], lt: LoadType): HourlyPoint[] {
  if (lt === "baseload") return points;
  if (lt === "peak") return points.filter(p => isPeakHour(p.ts));
  return points.filter(p => !isPeakHour(p.ts));
}

// Aggregate hourly into daily averages of the chosen load type.
export function toDaily(points: HourlyPoint[], lt: LoadType): HourlyPoint[] {
  const filtered = filterByLoadType(points, lt);
  const map = new Map<string, { sum: number; n: number }>();
  for (const p of filtered) {
    const day = p.ts.slice(0, 10);
    const cur = map.get(day) ?? { sum: 0, n: 0 };
    cur.sum += p.price; cur.n += 1;
    map.set(day, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([day, v]) => ({ ts: `${day}T00:00:00Z`, price: v.sum / v.n }));
}

// Aggregate daily into ISO weekly averages.
export function toWeekly(daily: HourlyPoint[]): HourlyPoint[] {
  const map = new Map<string, { sum: number; n: number; start: string }>();
  for (const d of daily) {
    const date = new Date(d.ts);
    // ISO week key
    const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400_000) + 1) / 7);
    const key = `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    // week start (Monday)
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const cur = map.get(key) ?? { sum: 0, n: 0, start: monday.toISOString().slice(0, 10) };
    cur.sum += d.price; cur.n += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([, v]) => ({ ts: `${v.start}T00:00:00Z`, price: v.sum / v.n }));
}

// Aggregate daily into monthly averages.
export function toMonthly(daily: HourlyPoint[]): HourlyPoint[] {
  const map = new Map<string, { sum: number; n: number }>();
  for (const d of daily) {
    const key = d.ts.slice(0, 7); // YYYY-MM
    const cur = map.get(key) ?? { sum: 0, n: 0 };
    cur.sum += d.price; cur.n += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a < b ? -1 : 1)
    .map(([m, v]) => ({ ts: `${m}-01T00:00:00Z`, price: v.sum / v.n }));
}

// Generic AR(1)+drift forecast for short non-seasonal weekly/monthly series.
export function arForecast(series: number[], horizon: number): { fc: number[]; resid_std: number } {
  if (series.length < 3) {
    const last = series[series.length - 1] ?? 0;
    return { fc: Array.from({ length: horizon }, () => last), resid_std: 5 };
  }
  const n = series.length;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 1; i < n; i++) {
    num += (series[i] - mean) * (series[i - 1] - mean);
    den += (series[i - 1] - mean) ** 2;
  }
  const phi = den > 0 ? Math.max(-0.95, Math.min(0.95, num / den)) : 0;
  const drift = (series[n - 1] - series[0]) / (n - 1);
  // residuals
  const resid: number[] = [];
  for (let i = 1; i < n; i++) {
    const pred = mean + phi * (series[i - 1] - mean);
    resid.push(series[i] - pred);
  }
  const m = resid.reduce((a, b) => a + b, 0) / Math.max(1, resid.length);
  const v = resid.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, resid.length - 1);
  const std = Math.sqrt(Math.max(v, 0));
  let prev = series[n - 1];
  const fc: number[] = [];
  for (let i = 0; i < horizon; i++) {
    const next = mean + phi * (prev - mean) + drift * 0.3;
    fc.push(next); prev = next;
  }
  return { fc, resid_std: std };
}

// Build forecast points with ISO timestamps for week/month products.
export function buildForecastPoints(lastTs: string, stepDays: number, fc: number[], rstd: number): ForecastPoint[] {
  const t0 = new Date(lastTs).getTime();
  const z = 1.28;
  return fc.map((v, i) => ({
    ts: new Date(t0 + (i + 1) * stepDays * 86400_000).toISOString(),
    forecast: v,
    lo80: v - z * rstd,
    hi80: v + z * rstd,
  }));
}

export interface Driver {
  key: string; label: string;
  value: string; trend: "up" | "down" | "flat";
  impact: "bullish" | "bearish" | "neutral";
  explain: string;
}

// Blend statistical forecast with EEX anchor and fundamental drift.
// Weights are normalised based on availability.
export function blend(args: {
  statistical: number[];          // per-step statistical forecast
  eexAnchor: number | null;       // single EEX futures price (€/MWh)
  fundamentalAdj: number;         // €/MWh shift from fundamentals (load/outages/danube/weather)
  eexFresh: boolean;
  statConfidence: "low" | "medium" | "high";
}): { blended: number[]; weights: { stat: number; eex: number; fund: number } } {
  const wStatBase = args.statConfidence === "high" ? 0.5 : args.statConfidence === "medium" ? 0.4 : 0.3;
  const wEexBase = args.eexAnchor != null && args.eexFresh ? 0.45 : 0;
  const wFundBase = 0.15;
  const sum = wStatBase + wEexBase + wFundBase;
  const wStat = wStatBase / sum;
  const wEex = wEexBase / sum;
  const wFund = wFundBase / sum;
  const blended = args.statistical.map(v =>
    wStat * v + wEex * (args.eexAnchor ?? v) + wFund * (v + args.fundamentalAdj)
  );
  return { blended, weights: { stat: wStat, eex: wEex, fund: wFund } };
}

// DA forecast: re-use the hourly ARIMA-lite cascade.
export function forecastDA(hourly: HourlyPoint[], horizonHours: number) {
  return forecastPrices(hourly, horizonHours);
}
