// Server functions used by the dashboard.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchDayAheadPrices,
  fetchDayAheadPricesRange,
  fetchPhysicalFlows,
  fetchExplicitAllocation,
  fetchOutages,
  fetchLoadGen,
  validatePriceMarket,
} from "./entsoe.server";
import { fetchWeather, fetchRiverDischarge } from "./openmeteo.server";
import { DANUBE_STATION_COORDS } from "./markets";

import { forecastPrices } from "./forecast";
import {
  IMPORT_ROUTES,
  EXPORT_ROUTES,
  BORDERS,
  PRODUCTS,
  ZONES,
  TECHNICAL_NTC_MW,
  type ZoneCode,
  type ProductType,
} from "./markets";
import { PRICE_MARKET_CODES } from "./price-markets";

const belgradeDateISO = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
const todayISO = () => belgradeDateISO();
const offsetISO = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return belgradeDateISO(date);
};

function belgradeHour(ts: string) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    hour: "2-digit",
    hour12: false,
  }).format(new Date(ts));
  return Number(hour);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v?: string) => (v && ISO_DATE_RE.test(v) ? v : undefined);

function expandRange(fromIn?: string, toIn?: string, dayIn?: string): string[] {
  const from = clean(fromIn);
  const to = clean(toIn);
  const day = clean(dayIn);
  if (!from && !to && !day) return [todayISO()];
  if (from && to) {
    const s = new Date(from + "T00:00:00Z").getTime();
    const e = new Date(to + "T00:00:00Z").getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [from];
    const out: string[] = [];
    const max = Math.min(e, s + 365 * 86400_000); // cap at ~1 year
    for (let t = s; t <= max; t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }
  return [day ?? from ?? to ?? todayISO()];
}

type RangeInput = { day?: string; from?: string; to?: string };

const DA_ZONES = PRICE_MARKET_CODES;

async function allSettledBounded<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 4,
): Promise<Array<PromiseSettledResult<T>>> {
  const out: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return out;
}

export const getDashboardSnapshot = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const headDay = days[0];

    const priceResults = await allSettledBounded(
      DA_ZONES.map(
        (z) => async () =>
          days.length > 1
            ? await fetchDayAheadPricesRange(z, days[0], days[days.length - 1])
            : await fetchDayAheadPrices(z, headDay),
      ),
    );
    const prices = DA_ZONES.map((z, index) => {
      const result = priceResults[index];
      if (result.status === "fulfilled") {
        return {
          zone: z,
          data: { zone: z, points: result.value.data.points },
          source: result.value.source,
          reason: result.value.reason,
          fetched_at: result.value.fetched_at,
        };
      }
      return {
        zone: z,
        data: {
          zone: z,
          points: [] as Array<{ ts: string; price: number; durationMinutes?: number }>,
        },
        source: "empty" as const,
        reason: result.reason instanceof Error ? result.reason.message : "error",
        fetched_at: new Date().toISOString(),
      };
    });

    const importRoutes = await Promise.all(
      IMPORT_ROUTES.map(async (r) => {
        const cap = await fetchExplicitAllocation(r.from, r.to, "daily", headDay);
        return { ...r, cap };
      }),
    );
    const exportRoutes = await Promise.all(
      EXPORT_ROUTES.map(async (r) => {
        const cap = await fetchExplicitAllocation(r.from, r.to, "daily", headDay);
        return { ...r, cap };
      }),
    );

    const byZone = Object.fromEntries(prices.map((p) => [p.zone, p.data.points]));

    // Probe: are tomorrow's DA prices already published? (SEEPEX gate ≈ 12:45 CET)
    const tomorrow = new Date(Date.parse(headDay + "T00:00:00Z") + 86400_000)
      .toISOString()
      .slice(0, 10);
    let tomorrowRS: {
      day: string;
      points: Array<{ ts: string; price: number }>;
      avg: number | null;
      source: string;
    } | null = null;
    let previousRS: {
      day: string;
      points: Array<{ ts: string; price: number }>;
      avg: number | null;
      source: string;
    } | null = null;
    if (days.length === 1 && headDay === todayISO()) {
      const r = await fetchDayAheadPrices("RS", tomorrow);
      const pts = r.data.points;
      const avg = pts.length ? pts.reduce((a, p) => a + p.price, 0) / pts.length : null;
      tomorrowRS = {
        day: tomorrow,
        points: pts,
        avg: pts.length >= 20 ? avg : null,
        source: r.source,
      };
    }
    if (days.length === 1) {
      const previousDate = new Date(headDay + "T12:00:00Z");
      previousDate.setUTCDate(previousDate.getUTCDate() - 1);
      const previous = previousDate.toISOString().slice(0, 10);
      const r = await fetchDayAheadPrices("RS", previous);
      const pts = r.data.points;
      const avg = pts.length ? pts.reduce((a, p) => a + p.price, 0) / pts.length : null;
      previousRS = { day: previous, points: pts, avg, source: r.source };
    }

    return {
      day: headDay,
      from: days[0],
      to: days[days.length - 1],
      prices,
      importRoutes,
      exportRoutes,
      byZone,
      tomorrowRS,
      previousRS,
    };
  });

// Hourly DA price profile (avg per hour 0..23) across the date range, per zone.
export const getAverageDAProfile = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const zones = DA_ZONES;
    const outResults = await allSettledBounded(
      zones.map((z) => async () => {
        const all = [await fetchDayAheadPricesRange(z, days[0], days[days.length - 1])];
        const sums = new Array<number>(24).fill(0);
        const counts = new Array<number>(24).fill(0);
        for (const r of all) {
          for (const p of r.data.points) {
            const h = belgradeHour(p.ts);
            if (Number.isFinite(p.price)) {
              sums[h] += p.price;
              counts[h] += 1;
            }
          }
        }
        const profile = sums.map((s, i) => (counts[i] ? s / counts[i] : null));
        return {
          zone: z,
          profile,
          source: all[0]?.source ?? "empty",
          reason: all[0]?.reason,
          fetched_at: all[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );
    const out = zones.map((z, index) => {
      const result = outResults[index];
      return result.status === "fulfilled"
        ? result.value
        : {
            zone: z,
            profile: new Array<number | null>(24).fill(null),
            source: "empty" as const,
            reason: result.reason instanceof Error ? result.reason.message : "error",
            fetched_at: new Date().toISOString(),
          };
    });
    return { from: days[0], to: days[days.length - 1], zones, rows: out };
  });

export const validatePriceMarkets = createServerFn({ method: "GET" })
  .inputValidator((data: { day?: string }) => data ?? {})
  .handler(async ({ data }) => {
    const day = clean(data?.day) ?? offsetISO(-1);
    const results = await allSettledBounded(
      PRICE_MARKET_CODES.map((market) => () => validatePriceMarket(market, day)),
    );
    return {
      day,
      rows: PRICE_MARKET_CODES.map((market, index) => {
        const result = results[index];
        return result.status === "fulfilled"
          ? result.value
          : {
              market,
              eic: "",
              intervals: 0,
              intervalResolutionMinutes: null,
              firstTimestamp: null,
              lastTimestamp: null,
              source: "empty" as const,
              reason: result.reason instanceof Error ? result.reason.message : "error",
            };
      }),
    };
  });

export const getFlows = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const routes = [...IMPORT_ROUTES, ...EXPORT_ROUTES];
    const results = await Promise.all(
      routes.map(async (r) => {
        const parts = await Promise.all(days.map((d) => fetchPhysicalFlows(r.from, r.to, d)));
        return {
          data: { from: r.from, to: r.to, points: parts.flatMap((p) => p.data.points) },
          source: parts[0]?.source ?? "empty",
          reason: parts[0]?.reason,
          fetched_at: parts[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );
    return { day: days[0], rows: routes.map((r, i) => ({ ...r, ...results[i] })) };
  });

// Cross-border flow analytics for Serbia. Both directions per border + capacity.
const RS_BORDERS: ZoneCode[] = ["HU", "RO", "BG", "HR", "ME", "MK"];

export const getFlowAnalytics = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const borders = await Promise.all(
      RS_BORDERS.map(async (neighbour) => {
        // import = neighbour -> RS, export = RS -> neighbour
        const impParts = await Promise.all(days.map((d) => fetchPhysicalFlows(neighbour, "RS", d)));
        const expParts = await Promise.all(days.map((d) => fetchPhysicalFlows("RS", neighbour, d)));
        const capImp = await fetchExplicitAllocation(neighbour, "RS", "daily", days[0]);
        const capExp = await fetchExplicitAllocation("RS", neighbour, "daily", days[0]);

        const impByTs = new Map<string, number>();
        const expByTs = new Map<string, number>();
        for (const r of impParts)
          for (const p of r.data.points)
            impByTs.set(p.ts, (impByTs.get(p.ts) ?? 0) + (Number.isFinite(p.mw) ? p.mw : 0));
        for (const r of expParts)
          for (const p of r.data.points)
            expByTs.set(p.ts, (expByTs.get(p.ts) ?? 0) + (Number.isFinite(p.mw) ? p.mw : 0));

        const allTs = Array.from(new Set([...impByTs.keys(), ...expByTs.keys()])).sort();
        const hourly = allTs.map((ts) => {
          const imp = impByTs.get(ts) ?? 0;
          const exp = expByTs.get(ts) ?? 0;
          return { ts, imp_mw: imp, exp_mw: exp, net_mw: imp - exp };
        });

        return {
          neighbour,
          hourly,
          capacity_imp_mw: capImp.data.offered_mw,
          capacity_exp_mw: capExp.data.offered_mw,
          source_imp: impParts[0]?.source ?? "empty",
          source_exp: expParts[0]?.source ?? "empty",
          cap_source: capImp.source,
          fetched_at: impParts[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );
    return {
      from: days[0],
      to: days[days.length - 1],
      borders,
      fetched_at: new Date().toISOString(),
    };
  });

// Cross-border capacity utilization: |physical flow| / technical NTC per direction.
export const getUtilization = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    // All directed pairs from BORDERS (already includes both directions).
    const pairs: Array<[ZoneCode, ZoneCode]> = BORDERS;
    const rows = await Promise.all(
      pairs.map(async ([from, to]) => {
        const parts = await Promise.all(days.map((d) => fetchPhysicalFlows(from, to, d)));
        const points = parts
          .flatMap((p) => p.data.points)
          .map((p) => ({ ts: p.ts, mw: Number.isFinite(p.mw) ? Math.abs(p.mw) : 0 }));
        const n = points.length;
        const sum = points.reduce((a, p) => a + p.mw, 0);
        const avg = n ? sum / n : null;
        const peak = n ? Math.max(...points.map((p) => p.mw)) : null;
        const ntc = TECHNICAL_NTC_MW[`${from}_${to}`] ?? null;
        const util_avg = avg != null && ntc ? avg / ntc : null;
        const util_peak = peak != null && ntc ? peak / ntc : null;
        return {
          from,
          to,
          label: `${from} → ${to}`,
          ntc_mw: ntc,
          avg_flow_mw: avg,
          peak_flow_mw: peak,
          utilization_avg: util_avg,
          utilization_peak: util_peak,
          hours: n,
          source: parts[0]?.source ?? "empty",
          fetched_at: parts[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );
    return { from: days[0], to: days[days.length - 1], rows };
  });

export const getCapacity = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const tasks: Array<
      Promise<{ key: string; row: Awaited<ReturnType<typeof fetchExplicitAllocation>> }>
    > = [];
    for (const [a, b] of BORDERS) {
      for (const p of PRODUCTS) {
        tasks.push(
          fetchExplicitAllocation(a, b, p, day).then((row) => ({ key: `${a}_${b}_${p}`, row })),
        );
      }
    }
    const res = await Promise.all(tasks);
    return { day, rows: res.map((r) => ({ key: r.key, ...r.row })) };
  });

export const getCapacityHistory = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      from?: ZoneCode;
      to?: ZoneCode;
      product?: ProductType;
      from_date?: string;
      to_date?: string;
    }) => data ?? {},
  )
  .handler(async ({ data }) => {
    const from = (data.from ?? "RS") as ZoneCode;
    const to = (data.to ?? "HU") as ZoneCode;
    const product = (data.product ?? "daily") as ProductType;
    const today = todayISO();
    const fromDate = clean(data.from_date) ?? offsetISO(-30);
    const toDate = clean(data.to_date) ?? today;
    const s = new Date(fromDate + "T00:00:00Z").getTime();
    const e = new Date(toDate + "T00:00:00Z").getTime();
    const days: string[] = [];
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      const cap = Math.min(e, s + 365 * 86400_000);
      const step =
        product === "monthly" ? 30 * 86400_000 : product === "annual" ? 90 * 86400_000 : 86400_000;
      for (let t = s; t <= cap; t += step) days.push(new Date(t).toISOString().slice(0, 10));
    } else {
      days.push(today);
    }
    const res = await Promise.all(
      days.map((d) =>
        fetchExplicitAllocation(from, to, product, d).then((r) => ({ day: d, ...r })),
      ),
    );
    return {
      from,
      to,
      product,
      from_date: fromDate,
      to_date: toDate,
      rows: res.map((r) => ({
        day: r.day,
        from: r.data.from,
        to: r.data.to,
        product: r.data.product,
        price_eur_mwh: r.data.price_eur_mwh,
        offered_mw: r.data.offered_mw,
        allocated_mw: r.data.allocated_mw,
        unit_warning: r.data.unit_warning,
        source: r.source,
        fetched_at: r.fetched_at,
      })),
    };
  });

export const getOutages = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const zones: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "ME", "MK", "AL"];
    const res = await Promise.all(zones.map((z) => fetchOutages(z, day)));
    return {
      day,
      rows: zones.flatMap((z, i) =>
        res[i].data.map((o) => ({ ...o, source: res[i].source, reason: res[i].reason })),
      ),
    };
  });

export const getWeather = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const zones: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "ME", "MK", "AL"];
    const res = await Promise.all(zones.map((z) => fetchWeather(z, day)));
    return { day, rows: zones.map((z, i) => ({ zone: z, name: ZONES[z].name, ...res[i] })) };
  });

export const getBalance = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const parts = await Promise.all(days.map((d) => fetchLoadGen("RS", d)));
    return {
      day: days[0],
      points: parts.flatMap((p) => p.data),
      source: parts[0]?.source,
      reason: parts[0]?.reason,
    };
  });

export const runForecast = createServerFn({ method: "POST" })
  .inputValidator((data: { horizon_h: number; history_days: number }) => data)
  .handler(async ({ data }) => {
    const histDays = Math.max(7, Math.min(365, data.history_days));
    const horizon = Math.max(1, Math.min(14 * 24, data.horizon_h));
    const today = new Date();
    const all: Array<{ ts: string; price: number }> = [];
    for (let i = histDays; i > 0; i--) {
      const day = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
      const r = await fetchDayAheadPrices("RS", day);
      all.push(...r.data.points);
    }
    return { ...forecastPrices(all, horizon), training_days: histDays };
  });

// ---- CBC capacity resale -----------------------------------------------------
export const getCBCComparison = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const tasks: Array<
      Promise<{
        from: ZoneCode;
        to: ZoneCode;
        product: ProductType;
        row: Awaited<ReturnType<typeof fetchExplicitAllocation>>;
      }>
    > = [];
    for (const [a, b] of BORDERS) {
      for (const p of PRODUCTS) {
        tasks.push(
          fetchExplicitAllocation(a, b, p, day).then((row) => ({
            from: a,
            to: b,
            product: p,
            row,
          })),
        );
      }
    }
    const res = await Promise.all(tasks);
    const grouped: Record<
      string,
      {
        from: ZoneCode;
        to: ZoneCode;
        annual?: number | null;
        monthly?: number | null;
        daily?: number | null;
        sources: Record<string, string>;
      }
    > = {};
    for (const r of res) {
      const key = `${r.from}_${r.to}`;
      grouped[key] ??= { from: r.from, to: r.to, sources: {} };
      grouped[key][r.product] = r.row.data.price_eur_mwh;
      grouped[key].sources[r.product] = r.row.source;
    }
    return { day, rows: Object.values(grouped) };
  });

export interface ResalePnL {
  position_id: string;
  label: string;
  from: ZoneCode;
  to: ZoneCode;
  booked_mw: number;
  annual_booked_price: number;
  monthly_price: number | null;
  daily_price: number | null;
  hours: number;
  pnl_monthly: number | null;
  pnl_daily: number | null;
  recommendation: "resell_monthly" | "resell_daily" | "keep" | "manual";
}

export const getResalePnL = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data, context }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const { supabase, userId } = context;
    const { data: positions } = await supabase
      .from("manual_capacity_positions")
      .select("*")
      .eq("user_id", userId);

    const out: ResalePnL[] = [];
    for (const pos of positions ?? []) {
      const from = pos.border_from as ZoneCode;
      const to = pos.border_to as ZoneCode;
      const monthly = await fetchExplicitAllocation(from, to, "monthly", day);
      const daily = await fetchExplicitAllocation(from, to, "daily", day);
      const hours = 24 * 30;
      const mp = monthly.data.price_eur_mwh;
      const dp = daily.data.price_eur_mwh;
      const ap = Number(pos.annual_booked_price ?? 0);
      const mw = Number(pos.booked_mw);
      const fees = Number(pos.fees ?? 0);
      const pnl_m = mp != null ? (mp - ap) * mw * hours - fees : null;
      const pnl_d = dp != null ? (dp - ap) * mw * hours - fees : null;
      let rec: ResalePnL["recommendation"] = "manual";
      if (pnl_m != null && pnl_d != null) {
        if (pnl_m <= 0 && pnl_d <= 0) rec = "keep";
        else rec = pnl_m >= pnl_d ? "resell_monthly" : "resell_daily";
      }
      out.push({
        position_id: pos.id,
        label: pos.position_name,
        from,
        to,
        booked_mw: mw,
        annual_booked_price: ap,
        monthly_price: mp,
        daily_price: dp,
        hours,
        pnl_monthly: pnl_m,
        pnl_daily: pnl_d,
        recommendation: rec,
      });
    }
    return { day, rows: out };
  });

// ---- per-month resale PnL breakdown ----------------------------------------
export interface MonthlyResaleRow {
  year: number;
  month: number; // 1..12
  monthLabel: string; // "Jan", "Feb", ...
  date_from: string; // YYYY-MM-DD (clipped to range / position window)
  date_to: string; // YYYY-MM-DD
  hours: number; // actual hours covered (24 * days)
  monthly_price: number | null;
  daily_price: number | null;
  source_monthly: string;
  source_daily: string;
}
export interface PositionBreakdown {
  position_id: string;
  label: string;
  from: ZoneCode;
  to: ZoneCode;
  booked_mw: number;
  annual_booked_price: number;
  annual_current_price: number | null; // current annual market price (for "Sell as Annual")
  source_annual: string;
  year: number;
  start_date: string;
  end_date: string;
  rows: MonthlyResaleRow[];
}

function monthsBetween(startISO: string, endISO: string) {
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  const out: Array<{
    year: number;
    month: number;
    label: string;
    from: string;
    to: string;
    hours: number;
  }> = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() + 1;
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    const firstD = new Date(Date.UTC(y, m - 1, 1));
    const lastD = new Date(Date.UTC(y, m, 1) - 86400_000);
    const effStart = firstD < start ? start : firstD;
    const effEnd = lastD > end ? end : lastD;
    const days = Math.round((effEnd.getTime() - effStart.getTime()) / 86400_000) + 1;
    out.push({
      year: y,
      month: m,
      label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
        m - 1
      ],
      from: effStart.toISOString().slice(0, 10),
      to: effEnd.toISOString().slice(0, 10),
      hours: days * 24,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export const getMonthlyResaleBreakdown = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: positions } = await supabase
      .from("manual_capacity_positions")
      .select("*")
      .eq("user_id", userId);

    const rangeFrom = clean(data?.from);
    const rangeTo = clean(data?.to);

    const out: PositionBreakdown[] = [];
    for (const pos of positions ?? []) {
      const from = pos.border_from as ZoneCode;
      const to = pos.border_to as ZoneCode;
      const posStart = pos.start_date as string;
      const posEnd = pos.end_date as string;
      const effStart = rangeFrom && rangeFrom > posStart ? rangeFrom : posStart;
      const effEnd = rangeTo && rangeTo < posEnd ? rangeTo : posEnd;
      if (effStart > effEnd) continue;

      const months = monthsBetween(effStart, effEnd);

      const annualCur = await fetchExplicitAllocation(from, to, "annual", posStart);

      const rows = await Promise.all(
        months.map(async (mo) => {
          const monthFirst = `${mo.year}-${String(mo.month).padStart(2, "0")}-01`;
          const midDay = `${mo.year}-${String(mo.month).padStart(2, "0")}-15`;
          const [monthly, daily] = await Promise.all([
            fetchExplicitAllocation(from, to, "monthly", monthFirst),
            fetchExplicitAllocation(from, to, "daily", midDay),
          ]);
          return {
            year: mo.year,
            month: mo.month,
            monthLabel: mo.label,
            date_from: mo.from,
            date_to: mo.to,
            hours: mo.hours,
            monthly_price: monthly.data.price_eur_mwh,
            daily_price: daily.data.price_eur_mwh,
            source_monthly: monthly.source,
            source_daily: daily.source,
          };
        }),
      );

      out.push({
        position_id: pos.id,
        label: pos.position_name,
        from,
        to,
        booked_mw: Number(pos.booked_mw),
        annual_booked_price: Number(pos.annual_booked_price ?? 0),
        annual_current_price: annualCur.data.price_eur_mwh,
        source_annual: annualCur.source,
        year: new Date(posStart).getUTCFullYear(),
        start_date: effStart,
        end_date: effEnd,
        rows,
      });
    }
    return { from: rangeFrom, to: rangeTo, positions: out };
  });

// ---- positions CRUD ----------------------------------------------------------
export const listPositions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("manual_capacity_positions")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id?: string;
      position_name: string;
      border_from: string;
      border_to: string;
      product_type: string;
      booked_mw: number;
      annual_booked_price: number;
      start_date: string;
      end_date: string;
      fees: number;
      preferred_resale_mode: string;
      notes?: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const payload = { ...data, user_id: context.userId };
    const q = data.id
      ? context.supabase
          .from("manual_capacity_positions")
          .update(payload)
          .eq("id", data.id)
          .select()
          .single()
      : context.supabase.from("manual_capacity_positions").insert(payload).select().single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    return row;
  });

export const deletePosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("manual_capacity_positions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- settings ---------------------------------------------------------------
export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!data) {
      const ins = await context.supabase
        .from("user_settings")
        .insert({ user_id: context.userId })
        .select()
        .single();
      return ins.data;
    }
    return data;
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      max_mw?: number;
      min_margin?: number;
      history_days?: number;
      demo_mode?: boolean;
      refresh_mode?: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("user_settings")
      .update(data)
      .eq("user_id", context.userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export { offsetISO, todayISO };

// Danube river discharge — Open-Meteo flood API, Visual Crossing precipitation as fallback proxy.
export const getDanubeDischarge = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const from = days[0];
    const to = days[days.length - 1];
    const stations = Object.entries(DANUBE_STATION_COORDS);
    const res = await Promise.all(
      stations.map(async ([name, c]) => {
        const r = await fetchRiverDischarge(c.lat, c.lon, from, to);
        return { name, ...r };
      }),
    );
    return { from, to, stations: res };
  });

// ---- Multi-product SEEPEX forecast (DA / Week / Month) ----------------------
import { fetchEexFutures, type EexProduct } from "./eex.server";
import {
  toDaily,
  toWeekly,
  toMonthly,
  arForecast,
  buildForecastPoints,
  blend,
  forecastDA,
  filterByLoadType,
  type Product,
  type LoadType,
  type Driver,
} from "./forecast-multi";

interface ForecastV2Input {
  product: Product;
  horizon: number; // DA: hours; week: weeks; month: months
  history_from?: string; // ISO date; default 2024-01-01
  history_to?: string; // optional cutoff (for backtest); default today
  load_type?: LoadType; // default baseload
  use_fundamentals?: boolean;
}

async function fetchSeepexHistory(
  fromISO: string,
  toISO: string,
  maxDays = 180,
): Promise<Array<{ ts: string; price: number }>> {
  const from = new Date(fromISO + "T00:00:00Z").getTime();
  const to = new Date(toISO + "T00:00:00Z").getTime();
  const days: string[] = [];
  for (let t = from; t <= to; t += 86400_000) days.push(new Date(t).toISOString().slice(0, 10));
  // Cap range to keep server function under the worker timeout.
  const useDays = days.length > maxDays ? days.slice(-maxDays) : days;
  const BATCH = 60;
  const out: Array<{ ts: string; price: number }> = [];
  for (let i = 0; i < useDays.length; i += BATCH) {
    const chunk = useDays.slice(i, i + BATCH);
    const res = await Promise.all(
      chunk.map((d) =>
        fetchDayAheadPrices("RS", d).catch(() => ({
          data: { points: [] as Array<{ ts: string; price: number }> },
        })),
      ),
    );
    for (const r of res) out.push(...r.data.points);
  }
  return out.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

export const runForecastV2 = createServerFn({ method: "POST" })
  .inputValidator((data: ForecastV2Input) => data)
  .handler(async ({ data }) => {
    const product = data.product;
    const historyFrom =
      data.history_from && /^\d{4}-\d{2}-\d{2}$/.test(data.history_from)
        ? data.history_from
        : "2024-01-01";
    const historyTo =
      data.history_to && /^\d{4}-\d{2}-\d{2}$/.test(data.history_to) ? data.history_to : todayISO();
    const loadType: LoadType = data.load_type ?? "baseload";
    const useFund = data.use_fundamentals ?? true;
    const horizon = Math.max(
      1,
      Math.min(product === "da" ? 14 * 24 : product === "week" ? 8 : 6, data.horizon),
    );

    const warnings: string[] = [];

    // 1. Fetch SEEPEX history, fundamentals, and EEX in parallel.
    const maxDays = 365;
    const historyP = fetchSeepexHistory(historyFrom, historyTo, maxDays);

    const balanceP = useFund
      ? fetchLoadGen("RS", historyTo).catch(() => null)
      : Promise.resolve(null);
    const outagesP = useFund
      ? fetchOutages("RS", historyTo).catch(() => null)
      : Promise.resolve(null);
    // Use Zemun (Belgrade area) as the Danube reference station.
    const danubeStation = DANUBE_STATION_COORDS["Zemun"];
    const danubeP =
      useFund && danubeStation
        ? fetchRiverDischarge(
            danubeStation.lat,
            danubeStation.lon,
            new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10),
            historyTo,
          ).catch(() => null)
        : Promise.resolve(null);
    const weatherP = useFund
      ? fetchWeather("RS", historyTo).catch(() => null)
      : Promise.resolve(null);
    const eexP = fetchEexFutures().catch(() => ({
      source: "unavailable" as const,
      reason: "fetch failed",
      anchor_zone: "HU" as const,
      prices: [] as Array<{
        zone: "HU" | "CZ" | "PL" | "SK";
        product: EexProduct;
        period_label: string;
        price_eur_mwh: number;
        fetched_at: string;
      }>,
      fetched_at: new Date().toISOString(),
    }));

    const [history, balance, outRes, danube, wx, eex] = await Promise.all([
      historyP,
      balanceP,
      outagesP,
      danubeP,
      weatherP,
      eexP,
    ]);

    if (!history.length) {
      return {
        product,
        loadType,
        horizon,
        historyFrom,
        historyTo,
        error: "SEEPEX history unavailable for the selected range.",
        warnings,
        history: [],
        forecast: [],
        drivers: [],
        diagnostics: null,
        latest_actual: null,
        eex: {
          source: "unavailable",
          reason: "skipped",
          prices: [],
          fetched_at: new Date().toISOString(),
        },
        eex_anchor: null,
        weights: { stat: 1, eex: 0, fund: 0 },
        fundamental_adj: 0,
      };
    }
    const latest = history[history.length - 1];

    // 2. Build driver cards from the fundamentals fetched above.
    const drivers: Driver[] = [];
    let fundamentalAdj = 0;

    if (useFund) {
      if (balance?.data?.length) {
        const last = balance.data.slice(-24);
        const avgLoad = last.reduce((s, p) => s + (p.load_mw ?? 0), 0) / Math.max(1, last.length);
        const prevDay = balance.data.slice(-48, -24);
        const prevLoad =
          prevDay.reduce((s, p) => s + (p.load_mw ?? 0), 0) / Math.max(1, prevDay.length);
        const delta = prevLoad ? (avgLoad - prevLoad) / prevLoad : 0;
        drivers.push({
          key: "load",
          label: "Load trend (RS, last 24h vs prev)",
          value: `${avgLoad.toFixed(0)} MW`,
          trend: delta > 0.02 ? "up" : delta < -0.02 ? "down" : "flat",
          impact: delta > 0.02 ? "bullish" : delta < -0.02 ? "bearish" : "neutral",
          explain: `${(delta * 100).toFixed(1)}% vs previous day`,
        });
        fundamentalAdj += delta * 8;
      } else {
        drivers.push({
          key: "load",
          label: "Load",
          value: "—",
          trend: "flat",
          impact: "neutral",
          explain: "no data",
        });
      }

      if (outRes?.data?.length) {
        const total = outRes.data.reduce((s, o) => s + (o.mw ?? 0), 0);
        drivers.push({
          key: "outages",
          label: "Generation outages (RS)",
          value: `${total.toFixed(0)} MW unavailable`,
          trend: total > 500 ? "up" : "flat",
          impact: total > 500 ? "bullish" : "neutral",
          explain: `${outRes.data.length} active outage records`,
        });
        fundamentalAdj += Math.min(8, total / 250);
      } else {
        drivers.push({
          key: "outages",
          label: "Outages",
          value: "—",
          trend: "flat",
          impact: "neutral",
          explain: "no data",
        });
      }

      const series = (danube?.data ?? [])
        .map((d) => d.discharge_m3s)
        .filter((v): v is number => Number.isFinite(v));
      if (series.length >= 2) {
        const last = series[series.length - 1];
        const avg = series.reduce((a, b) => a + b, 0) / series.length;
        const dev = avg > 0 ? (last - avg) / avg : 0;
        drivers.push({
          key: "danube",
          label: "Danube discharge (Belgrade, 7d)",
          value: `${last.toFixed(0)} m³/s`,
          trend: dev > 0.05 ? "up" : dev < -0.05 ? "down" : "flat",
          impact: dev > 0.05 ? "bearish" : dev < -0.05 ? "bullish" : "neutral",
          explain: `${(dev * 100).toFixed(1)}% vs 7d avg (more water → more hydro → softer prices)`,
        });
        fundamentalAdj += -dev * 5;
      } else {
        drivers.push({
          key: "danube",
          label: "Danube",
          value: "—",
          trend: "flat",
          impact: "neutral",
          explain: "no data",
        });
      }

      const temps = (wx?.data ?? [])
        .map((p) => p.temp_c)
        .filter((v): v is number => Number.isFinite(v));
      if (temps.length) {
        const t = Math.max(...temps);
        const baseTemp = 18;
        const dd = t < baseTemp ? baseTemp - t : t - 24;
        drivers.push({
          key: "weather",
          label: "Belgrade peak temp (today)",
          value: `${t.toFixed(1)} °C`,
          trend: t > 26 ? "up" : t < 5 ? "up" : "flat",
          impact: dd > 5 ? "bullish" : "neutral",
          explain:
            dd > 5 ? `Strong ${t < baseTemp ? "heating" : "cooling"} demand` : "Mild conditions",
        });
        fundamentalAdj += Math.max(0, dd - 5) * 0.5;
      } else {
        drivers.push({
          key: "weather",
          label: "Weather",
          value: "—",
          trend: "flat",
          impact: "neutral",
          explain: "no data",
        });
      }
    }

    // Calendar driver (always available)
    const today = new Date(historyTo);
    const isWeekend = today.getUTCDay() === 0 || today.getUTCDay() === 6;
    drivers.push({
      key: "calendar",
      label: "Calendar",
      value: isWeekend ? "Weekend" : "Weekday",
      trend: "flat",
      impact: isWeekend ? "bearish" : "neutral",
      explain: isWeekend
        ? "Weekend demand typically lower"
        : `Month ${today.getUTCMonth() + 1}, weekday`,
    });

    // 3. EEX/PXE futures anchor (Hungary baseload = proxy for SEEPEX)
    //    Maps DA→front month, week→front month, month→front month, with
    //    fallback to nearest quarter / Cal if month row is missing.
    const anchorZone = eex.anchor_zone ?? "HU";
    const anchorRows = eex.prices.filter((p) => p.zone === anchorZone);
    const pickAnchor = (): { price: number; label: string } | null => {
      const order: EexProduct[] =
        product === "month" || product === "week" || product === "da"
          ? ["month", "quarter", "year"]
          : ["year", "quarter", "month"];
      for (const prod of order) {
        const row = anchorRows.find((p) => p.product === prod);
        if (row) return { price: row.price_eur_mwh, label: `${row.zone} ${row.period_label}` };
      }
      return null;
    };
    const liveAnchor = pickAnchor();
    const liveEexAnchor = liveAnchor?.price ?? null;
    const eexFresh = eex.source !== "unavailable" && liveEexAnchor != null;
    // Synthetic fallback: weighted mean of last 30d (60%) + last 365d (40%).
    let syntheticAnchor: number | null = null;
    {
      const filt = filterByLoadType(history, loadType).map((p) => p.price);
      if (filt.length >= 24) {
        const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
        const recent = filt.slice(-24 * 30);
        const long = filt.slice(-24 * 365);
        syntheticAnchor = 0.6 * mean(recent) + 0.4 * mean(long);
      }
    }
    const eexAnchor = liveEexAnchor ?? syntheticAnchor;
    if (liveEexAnchor != null && liveAnchor) {
      warnings.push(
        `Anchor: PXE ${liveAnchor.label} = €${liveEexAnchor.toFixed(2)}/MWh (HU baseload proxy).`,
      );
    } else {
      warnings.push(
        syntheticAnchor != null
          ? `PXE/EEX futures unavailable — using synthetic anchor from SEEPEX history (€${syntheticAnchor.toFixed(2)}/MWh).`
          : "PXE/EEX futures unavailable — using statistical-only forecast.",
      );
    }

    // 4. Build forecast per product
    const filteredHist = filterByLoadType(history, loadType);
    let statisticalForecast: number[] = [];
    let forecastPts: Array<{
      ts: string;
      forecast: number;
      lo80: number;
      hi80: number;
      blended?: number;
    }> = [];
    let model = "sarima_lite";
    let mae: number | undefined;
    let mape: number | undefined;
    let statConf: "low" | "medium" | "high" = "low";

    if (product === "da") {
      const r = forecastDA(filteredHist, horizon);
      statisticalForecast = r.forecast.map((p) => p.forecast);
      forecastPts = r.forecast;
      model = r.model;
      mae = r.mae;
      mape = r.mape;
      statConf =
        filteredHist.length > 24 * 90 ? "high" : filteredHist.length > 24 * 30 ? "medium" : "low";
      warnings.push(...r.warnings);
    } else {
      const daily = toDaily(history, loadType);
      const series = product === "week" ? toWeekly(daily) : toMonthly(daily);
      const values = series.map((s) => s.price);
      if (values.length < 4) {
        warnings.push(
          `Only ${values.length} ${product}ly observations — using last value as flat forecast.`,
        );
        const last = values[values.length - 1] ?? 0;
        statisticalForecast = Array.from({ length: horizon }, () => last);
        forecastPts = buildForecastPoints(
          series[series.length - 1]?.ts ?? new Date().toISOString(),
          product === "week" ? 7 : 30,
          statisticalForecast,
          5,
        );
        model = "rolling_mean";
      } else {
        const { fc, resid_std } = arForecast(values, horizon);
        statisticalForecast = fc;
        forecastPts = buildForecastPoints(
          series[series.length - 1].ts,
          product === "week" ? 7 : 30,
          fc,
          resid_std,
        );
        model = "ar1_drift";
        statConf = values.length >= 24 ? "high" : values.length >= 12 ? "medium" : "low";
        // Naive backtest: hold-out last 4 obs
        if (values.length >= 8) {
          const train = values.slice(0, -4);
          const test = values.slice(-4);
          const bt = arForecast(train, 4);
          const errs = test.map((t, i) => Math.abs(t - bt.fc[i]));
          mae = errs.reduce((a, b) => a + b, 0) / errs.length;
          const pcts = test.map((t, i) => (Math.abs(t) > 0.1 ? Math.abs((t - bt.fc[i]) / t) : 0));
          const valid = pcts.filter((_, i) => Math.abs(test[i]) > 0.1).length;
          mape = valid ? (pcts.reduce((a, b) => a + b, 0) / valid) * 100 : undefined;
        }
      }
    }

    // 5. Blend with EEX + fundamentals
    const { blended, weights } = blend({
      statistical: statisticalForecast,
      eexAnchor,
      fundamentalAdj,
      // Treat synthetic anchor as a soft anchor (lower weight) when EEX is down.
      eexFresh: eexAnchor != null && (eexFresh || syntheticAnchor != null),
      statConfidence: statConf,
    });
    forecastPts = forecastPts.map((p, i) => ({ ...p, blended: blended[i] }));

    return {
      product,
      loadType,
      horizon,
      historyFrom,
      historyTo,
      history: history.slice(-Math.min(history.length, product === "da" ? 24 * 30 : 365 * 2)),
      forecast: forecastPts,
      latest_actual: { ts: latest.ts, price: latest.price },
      eex,
      eex_anchor: eexAnchor,
      drivers,
      fundamental_adj: fundamentalAdj,
      weights,
      diagnostics: {
        model,
        training_points: filteredHist.length,
        history_from: historyFrom,
        history_to: historyTo,
        mae,
        mape,
        stat_confidence: statConf,
        fallback_used: model === "rolling_mean" || model === "seasonal_naive",
      },
      warnings,
    };
  });
