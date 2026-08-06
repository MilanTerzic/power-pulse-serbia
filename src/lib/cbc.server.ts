// Server-only helpers for the CBC capacity resale dashboard.
// Ported from cbc_capacity_resale_dashboard.py (ENTSO-E A25 explicit allocations).
import { fetchExplicitAllocation } from "./entsoe.server";
import type { ZoneCode, ProductType } from "./markets";
import {
  monthWindows,
  DIRECTIONAL_BORDERS,
  type BorderCompareRow,
  type CbcPosition,
  type MonthWindow,
  type PnlRow,
  type RecommendationRow,
  type ResaleMode,
} from "./cbc-types";

async function bounded<T>(tasks: Array<() => Promise<T>>, concurrency = 6): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return out;
}

const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

function stdev(v: number[]) {
  if (v.length < 2) return null;
  const m = avg(v)!;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

function normalCdf(x: number) {
  // Abramowitz & Stegun erf approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

async function price(from: ZoneCode, to: ZoneCode, product: ProductType, day: string) {
  try {
    const r = await fetchExplicitAllocation(from, to, product, day);
    return {
      price: r.data.price_eur_mwh,
      offered: r.data.offered_mw,
      allocated: r.data.allocated_mw,
      source: r.source,
    };
  } catch {
    return { price: null, offered: null, allocated: null, source: "error" };
  }
}

function dailySampleDays(win: MonthWindow) {
  const start = new Date(`${win.start}T00:00:00Z`).getTime();
  const end = new Date(`${win.end}T00:00:00Z`).getTime();
  const out: string[] = [];
  for (let t = start; t <= end && out.length < 4; t += 7 * 86400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Monthly + daily observed prices for one border across the month windows. */
async function borderMonthSeries(from: ZoneCode, to: ZoneCode, months: MonthWindow[]) {
  const results = await bounded(
    months.map((win) => async () => {
      const monthly = await price(from, to, "monthly", `${win.month}-01`);
      const dailies = await bounded(
        dailySampleDays(win).map((d) => () => price(from, to, "daily", d)),
        3,
      );
      const dailyVals = dailies.map((d) => d.price).filter((p): p is number => p != null);
      return {
        month: win.month,
        monthly: monthly.price,
        daily: avg(dailyVals),
        offered: monthly.offered,
        allocated: monthly.allocated,
        source: monthly.source,
      };
    }),
    3,
  );
  return results;
}

export async function buildComparison(start: string, end: string, borderFilter?: string) {
  const months = monthWindows(start, end);
  const borders = DIRECTIONAL_BORDERS.filter(([a, b]) =>
    !borderFilter || borderFilter === "all" ? true : a === borderFilter || b === borderFilter,
  );
  const rows = await bounded(
    borders.map(([from, to]) => async () => {
      const annual = await price(from, to, "annual", start);
      const series = await borderMonthSeries(from, to, months);
      const monthlyVals = series.map((s) => s.monthly).filter((p): p is number => p != null);
      const dailyVals = series.map((s) => s.daily).filter((p): p is number => p != null);
      const monthlyAvg = avg(monthlyVals);
      const dailyAvg = avg(dailyVals);
      const status: BorderCompareRow["status"] =
        annual.price == null && monthlyAvg == null && dailyAvg == null
          ? "missing"
          : monthlyVals.length === months.length && dailyVals.length === months.length
            ? "ok"
            : "partial";
      const row: BorderCompareRow = {
        key: `${from}_${to}`,
        from,
        to,
        border: `${from}→${to}`,
        annual_price: annual.price,
        monthly_price: monthlyAvg,
        daily_price: dailyAvg,
        offered_mw: annual.offered ?? series.find((s) => s.offered != null)?.offered ?? null,
        allocated_mw: annual.allocated ?? series.find((s) => s.allocated != null)?.allocated ?? null,
        monthly_resale_spread:
          monthlyAvg != null && annual.price != null ? monthlyAvg - annual.price : null,
        daily_resale_spread:
          dailyAvg != null && annual.price != null ? dailyAvg - annual.price : null,
        monthly_series: series.map((s) => ({ month: s.month, monthly: s.monthly, daily: s.daily })),
        status,
        source: annual.source,
        message: `annual=${annual.source}, monthly points=${monthlyVals.length}/${months.length}, daily points=${dailyVals.length}/${months.length}`,
      };
      return row;
    }),
    4,
  );
  return { start, end, months, rows };
}

export async function buildPnl(
  positions: CbcPosition[],
  start: string,
  end: string,
  modes: Record<string, ResaleMode>,
) {
  const months = monthWindows(start, end);
  const perPosition = await bounded(
    positions.map((pos) => async () => {
      const annualMarket = await price(pos.from, pos.to, "annual", start);
      const annualCost = pos.annual_booked_price ?? annualMarket.price;
      const series = await borderMonthSeries(pos.from, pos.to, months);
      const rows: PnlRow[] = months.map((win, i) => {
        const s = series[i];
        const mode: ResaleMode = modes[`${pos.id}:${win.month}`] ?? "monthly";
        const resale = mode === "daily" ? s.daily : s.monthly;
        const pnl =
          resale != null && annualCost != null ? (resale - annualCost) * pos.mw * win.hours : null;
        const pnlMonthly =
          s.monthly != null && annualCost != null
            ? (s.monthly - annualCost) * pos.mw * win.hours
            : null;
        const pnlDaily =
          s.daily != null && annualCost != null ? (s.daily - annualCost) * pos.mw * win.hours : null;
        let bestMode: ResaleMode | null = null;
        let bestPnl: number | null = null;
        if (pnlMonthly != null || pnlDaily != null) {
          bestMode = (pnlDaily ?? -Infinity) > (pnlMonthly ?? -Infinity) ? "daily" : "monthly";
          bestPnl = bestMode === "daily" ? pnlDaily : pnlMonthly;
        }
        return {
          position_id: pos.id,
          label: pos.label,
          border: `${pos.from}→${pos.to}`,
          month: win.month,
          mw: pos.mw,
          hours: win.hours,
          annual_price: annualCost,
          monthly_price: s.monthly,
          daily_price: s.daily,
          mode,
          resale_price: resale,
          pnl,
          best_mode: bestMode,
          best_pnl: bestPnl,
        } satisfies PnlRow;
      });
      return {
        position: pos,
        annual_market_price: annualMarket.price,
        annual_cost_price: annualCost,
        rows,
      };
    }),
    2,
  );
  return { start, end, months, positions: perPosition };
}

/** Historical monthly price series (YYYY-MM -> price) for a product over N past years. */
async function historyMonths(
  from: ZoneCode,
  to: ZoneCode,
  product: Extract<ProductType, "monthly" | "daily">,
  years: number,
) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const series: Record<string, number> = {};
  const targets: string[] = [];
  for (let y = currentYear - years; y < currentYear; y++) {
    for (let m = 1; m <= 12; m++) targets.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  await bounded(
    targets.map((ym) => async () => {
      if (product === "monthly") {
        const r = await price(from, to, "monthly", `${ym}-01`);
        if (r.price != null) series[ym] = r.price;
        return;
      }
      const samples = await bounded(
        [`${ym}-05`, `${ym}-15`, `${ym}-25`].map((d) => () => price(from, to, "daily", d)),
        3,
      );
      const vals = samples.map((s) => s.price).filter((p): p is number => p != null);
      const m = avg(vals);
      if (m != null) series[ym] = m;
    }),
    6,
  );
  return series;
}

function weightedMonthForecast(series: Record<string, number>, targetMonth: number) {
  const entries = Object.entries(series).sort(([a], [b]) => a.localeCompare(b));
  const same = entries
    .filter(([ym]) => Number(ym.split("-")[1]) === targetMonth)
    .map(([, v]) => v);
  if (!same.length) return { forecast: null as number | null, samples: 0 };
  const weights = same.map((_, i) => i + 1);
  const seasonal =
    same.reduce((s, v, i) => s + v * weights[i], 0) / weights.reduce((a, b) => a + b, 0);
  const recentVals = entries.slice(-12).map(([, v]) => v);
  const recent = recentVals.length ? avg(recentVals)! : seasonal;
  const prevVals = entries.slice(-24, -12).map(([, v]) => v);
  const trend = prevVals.length && recentVals.length ? recent - avg(prevVals)! : 0;
  return { forecast: 0.72 * seasonal + 0.28 * recent + 0.2 * trend, samples: same.length };
}

export async function buildRecommendations(
  positions: CbcPosition[],
  start: string,
  end: string,
  years = 3,
) {
  const months = monthWindows(start, end);
  const perPos = await bounded(
    positions.map((pos) => async () => {
      const [annualRes, monthlyHist, dailyHist] = await Promise.all([
        price(pos.from, pos.to, "annual", start),
        historyMonths(pos.from, pos.to, "monthly", years),
        historyMonths(pos.from, pos.to, "daily", years),
      ]);
      const annual = pos.annual_booked_price ?? annualRes.price;
      const diffsByMonth: Record<number, number[]> = {};
      for (const [ym, d] of Object.entries(dailyHist)) {
        const m = monthlyHist[ym];
        if (m == null) continue;
        const key = Number(ym.split("-")[1]);
        (diffsByMonth[key] ??= []).push(d - m);
      }
      const rows: RecommendationRow[] = months.map((win) => {
        const monthNo = Number(win.month.split("-")[1]);
        const mFc = weightedMonthForecast(monthlyHist, monthNo);
        const dFcRaw = weightedMonthForecast(dailyHist, monthNo);
        const base = {
          position_id: pos.id,
          label: pos.label,
          border: `${pos.from}→${pos.to}`,
          month: win.month,
          mw: pos.mw,
          hours: win.hours,
          annual_price: annual,
        };
        if (mFc.forecast == null || dFcRaw.forecast == null) {
          return {
            ...base,
            monthly_fc: mFc.forecast,
            daily_fc: dFcRaw.forecast,
            recommendation: "missing",
            probability: null,
            confidence: null,
            expected_pnl: null,
            incremental_vs_other: null,
            reason: "Insufficient historical monthly or daily auction data for this calendar month.",
          } satisfies RecommendationRow;
        }
        const diffSamples = diffsByMonth[monthNo] ?? [];
        const histDiff = avg(diffSamples);
        let modelDiff = dFcRaw.forecast - mFc.forecast;
        let dailyFc = dFcRaw.forecast;
        if (histDiff != null) {
          modelDiff = 0.65 * modelDiff + 0.35 * histDiff;
          dailyFc = mFc.forecast + modelDiff;
        }
        const sigma = stdev(diffSamples) ?? Math.max(Math.abs(modelDiff), 0.5);
        const probDaily = sigma > 0 ? normalCdf(modelDiff / sigma) : modelDiff > 0 ? 1 : 0;
        const useDaily = modelDiff > 0;
        const resale = useDaily ? dailyFc : mFc.forecast;
        const other = useDaily ? mFc.forecast : dailyFc;
        const expected = annual != null ? (resale - annual) * pos.mw * win.hours : null;
        const prob = useDaily ? probDaily : 1 - probDaily;
        return {
          ...base,
          monthly_fc: mFc.forecast,
          daily_fc: dailyFc,
          recommendation: useDaily ? "daily" : "monthly",
          probability: prob * 100,
          confidence: Math.abs(prob - 0.5) * 200,
          expected_pnl: expected,
          incremental_vs_other: Math.abs(resale - other) * pos.mw * win.hours,
          reason: `${years}y same-month seasonality + recent level/trend. Samples: monthly=${mFc.samples}, daily=${dFcRaw.samples}, daily−monthly pairs=${diffSamples.length}.`,
        } satisfies RecommendationRow;
      });
      return { position: pos, annual_price: annual, rows };
    }),
    2,
  );
  const all = perPos.flatMap((p) => p.rows);
  return {
    start,
    end,
    method:
      "Weighted same-month seasonality over the last 3 years + recent 12-month level and trend; daily-vs-monthly probability from historical same-month spread volatility.",
    summary: {
      rows: all.length,
      daily_count: all.filter((r) => r.recommendation === "daily").length,
      monthly_count: all.filter((r) => r.recommendation === "monthly").length,
      missing: all.filter((r) => r.recommendation === "missing").length,
      total_expected_pnl: all.reduce((s, r) => s + (r.expected_pnl ?? 0), 0),
      total_incremental: all.reduce((s, r) => s + (r.incremental_vs_other ?? 0), 0),
    },
    positions: perPos,
  };
}
