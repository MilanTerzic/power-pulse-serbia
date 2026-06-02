// Server functions used by the dashboard.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  fetchDayAheadPrices, fetchPhysicalFlows, fetchExplicitAllocation,
  fetchOutages, fetchLoadGen,
} from "./entsoe.server";
import { fetchWeather } from "./openmeteo.server";
import { forecastPrices } from "./forecast";
import {
  IMPORT_ROUTES, EXPORT_ROUTES, BORDERS, PRODUCTS, ZONES, type ZoneCode, type ProductType,
} from "./markets";

const todayISO = () => new Date().toISOString().slice(0, 10);
const offsetISO = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

function expandRange(from?: string, to?: string, day?: string): string[] {
  if (!from && !to && !day) return [todayISO()];
  if (from && to) {
    const s = new Date(from + "T00:00:00Z").getTime();
    const e = new Date(to + "T00:00:00Z").getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [from];
    const out: string[] = [];
    const max = Math.min(e, s + 30 * 86400_000); // cap at 31 days
    for (let t = s; t <= max; t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }
  return [day ?? from ?? to ?? todayISO()];
}

type RangeInput = { day?: string; from?: string; to?: string };

// BA has no DA/ID market — exclude from price/flow calculations.
const DA_ZONES: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "SI", "ME", "MK", "AL"];

export const getDashboardSnapshot = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const headDay = days[0];

    const prices = await Promise.all(
      DA_ZONES.map(async z => {
        const all = await Promise.all(days.map(d => fetchDayAheadPrices(z, d)));
        return {
          zone: z,
          data: { zone: z, points: all.flatMap(r => r.data.points) },
          source: all[0]?.source ?? "empty",
          reason: all[0]?.reason,
          fetched_at: all[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );

    const importRoutes = await Promise.all(
      IMPORT_ROUTES.map(async r => {
        const cap = await fetchExplicitAllocation(r.from, r.to, "daily", headDay);
        return { ...r, cap };
      }),
    );
    const exportRoutes = await Promise.all(
      EXPORT_ROUTES.map(async r => {
        const cap = await fetchExplicitAllocation(r.from, r.to, "daily", headDay);
        return { ...r, cap };
      }),
    );

    const byZone = Object.fromEntries(prices.map(p => [p.zone, p.data.points]));

    return { day: headDay, from: days[0], to: days[days.length - 1], prices, importRoutes, exportRoutes, byZone };
  });

// Hourly DA price profile (avg per hour 0..23) across the date range, per zone.
export const getAverageDAProfile = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const zones = DA_ZONES;
    const out = await Promise.all(zones.map(async z => {
      const all = await Promise.all(days.map(d => fetchDayAheadPrices(z, d)));
      const sums = new Array<number>(24).fill(0);
      const counts = new Array<number>(24).fill(0);
      for (const r of all) {
        for (const p of r.data.points) {
          const h = new Date(p.ts).getUTCHours();
          if (Number.isFinite(p.price)) { sums[h] += p.price; counts[h] += 1; }
        }
      }
      const profile = sums.map((s, i) => counts[i] ? s / counts[i] : null);
      return { zone: z, profile, source: all[0]?.source ?? "empty", fetched_at: all[0]?.fetched_at ?? new Date().toISOString() };
    }));
    return { from: days[0], to: days[days.length - 1], zones, rows: out };
  });


export const getFlows = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const routes = [...IMPORT_ROUTES, ...EXPORT_ROUTES];
    const results = await Promise.all(
      routes.map(async r => {
        const parts = await Promise.all(days.map(d => fetchPhysicalFlows(r.from, r.to, d)));
        return {
          data: { from: r.from, to: r.to, points: parts.flatMap(p => p.data.points) },
          source: parts[0]?.source ?? "empty",
          reason: parts[0]?.reason,
          fetched_at: parts[0]?.fetched_at ?? new Date().toISOString(),
        };
      }),
    );
    return { day: days[0], rows: routes.map((r, i) => ({ ...r, ...results[i] })) };
  });

export const getCapacity = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const tasks: Array<Promise<{ key: string; row: Awaited<ReturnType<typeof fetchExplicitAllocation>> }>> = [];
    for (const [a, b] of BORDERS) {
      for (const p of PRODUCTS) {
        tasks.push(
          fetchExplicitAllocation(a, b, p, day).then(row => ({ key: `${a}_${b}_${p}`, row })),
        );
      }
    }
    const res = await Promise.all(tasks);
    return { day, rows: res.map(r => ({ key: r.key, ...r.row })) };
  });

export const getOutages = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const zones: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "BA", "ME", "MK", "AL"];
    const res = await Promise.all(zones.map(z => fetchOutages(z, day)));
    return { day, rows: zones.flatMap((z, i) => res[i].data.map(o => ({ ...o, source: res[i].source, reason: res[i].reason }))) };
  });

export const getWeather = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const day = days[0];
    const zones: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "BA", "ME", "MK", "AL"];
    const res = await Promise.all(zones.map(z => fetchWeather(z, day)));
    return { day, rows: zones.map((z, i) => ({ zone: z, name: ZONES[z].name, ...res[i] })) };
  });

export const getBalance = createServerFn({ method: "GET" })
  .inputValidator((data: RangeInput) => data ?? {})
  .handler(async ({ data }) => {
    const days = expandRange(data?.from, data?.to, data?.day);
    const parts = await Promise.all(days.map(d => fetchLoadGen("RS", d)));
    return {
      day: days[0],
      points: parts.flatMap(p => p.data),
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
    const tasks: Array<Promise<{ from: ZoneCode; to: ZoneCode; product: ProductType; row: Awaited<ReturnType<typeof fetchExplicitAllocation>> }>> = [];
    for (const [a, b] of BORDERS) {
      for (const p of PRODUCTS) {
        tasks.push(fetchExplicitAllocation(a, b, p, day).then(row => ({ from: a, to: b, product: p, row })));
      }
    }
    const res = await Promise.all(tasks);
    const grouped: Record<string, { from: ZoneCode; to: ZoneCode; annual?: number | null; monthly?: number | null; daily?: number | null; sources: Record<string, string> }> = {};
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
  from: ZoneCode; to: ZoneCode;
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
  .middleware([requireSupabaseAuth])
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
        from, to,
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

// ---- positions CRUD ----------------------------------------------------------
export const listPositions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("manual_capacity_positions").select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    id?: string;
    position_name: string;
    border_from: string; border_to: string;
    product_type: string;
    booked_mw: number; annual_booked_price: number;
    start_date: string; end_date: string;
    fees: number; preferred_resale_mode: string; notes?: string;
  }) => data)
  .handler(async ({ data, context }) => {
    const payload = { ...data, user_id: context.userId };
    const q = data.id
      ? context.supabase.from("manual_capacity_positions").update(payload).eq("id", data.id).select().single()
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
      .from("manual_capacity_positions").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- settings ---------------------------------------------------------------
export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_settings").select("*").eq("user_id", context.userId).maybeSingle();
    if (!data) {
      const ins = await context.supabase.from("user_settings").insert({ user_id: context.userId }).select().single();
      return ins.data;
    }
    return data;
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { max_mw?: number; min_margin?: number; history_days?: number; demo_mode?: boolean; refresh_mode?: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("user_settings").update(data).eq("user_id", context.userId).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export { offsetISO, todayISO };
