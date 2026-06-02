// ENTSO-E Transparency Platform client — server-only.
// Mirrors fetchers from the uploaded Python app.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ZONES, ENTSOE_DOCUMENT_TYPES, MARKET_AGREEMENT_TYPES, type ZoneCode, type ProductType } from "./markets";
import {
  demoHourlyPrices, demoFlow, demoCapacityPrice, demoOutages, demoLoadGen,
} from "./demo.server";

const API_BASE = "https://web-api.tp.entsoe.eu/api";
const DEFAULT_TTL = 1800;

function token(): string | null {
  return process.env.ENTSOE_API_TOKEN ?? null;
}

function ymdh(d: Date): string {
  const y = d.getUTCFullYear();
  const M = String(d.getUTCMonth() + 1).padStart(2, "0");
  const D = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}${M}${D}${h}${m}`;
}

export interface FetchResult<T> {
  data: T;
  source: "live" | "cache" | "demo" | "empty";
  reason?: string;
  fetched_at: string;
}

async function cacheGet<T>(key: string, ttl: number): Promise<T | null> {
  const { data } = await supabaseAdmin
    .from("api_cache")
    .select("payload, fetched_at, ttl_seconds")
    .eq("key", key)
    .maybeSingle();
  if (!data) return null;
  const age = (Date.now() - new Date(data.fetched_at as string).getTime()) / 1000;
  if (age > (data.ttl_seconds ?? ttl)) return null;
  return data.payload as T;
}

async function cacheSet(key: string, payload: unknown, ttl = DEFAULT_TTL) {
  await supabaseAdmin.from("api_cache").upsert({
    key, payload: payload as never, fetched_at: new Date().toISOString(), ttl_seconds: ttl,
  });
}

async function entsoeRaw(params: Record<string, string>): Promise<string> {
  const t = token();
  if (!t) throw new Error("ENTSOE_API_TOKEN missing");
  const qs = new URLSearchParams({ securityToken: t, ...params });
  const url = `${API_BASE}?${qs.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/xml" } });
  if (res.status === 200) return await res.text();
  if (res.status === 400) throw new Error("entsoe_no_data");
  if (res.status === 401) throw new Error("entsoe_unauthorized");
  if (res.status === 429) throw new Error("entsoe_rate_limited");
  throw new Error(`entsoe_http_${res.status}`);
}

// --- Tiny XML utilities -----------------------------------------------------
function stripNs(xml: string) { return xml.replace(/<\/?[\w:-]+:/g, m => m.replace(/[\w-]+:/, "")); }
function tagAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\/${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function tagOne(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\/${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function parseTimeSeriesHourly(xml: string): Array<{ ts: string; value: number }> {
  const clean = stripNs(xml);
  const out: Array<{ ts: string; value: number }> = [];
  for (const ts of tagAll(clean, "TimeSeries")) {
    for (const period of tagAll(ts, "Period")) {
      const start = tagOne(period, "start");
      if (!start) continue;
      const startMs = Date.parse(start);
      const resolution = tagOne(period, "resolution") ?? "PT60M";
      const stepMin = /PT(\d+)M/.exec(resolution)?.[1] ? parseInt(/PT(\d+)M/.exec(resolution)![1], 10) : 60;
      for (const pt of tagAll(period, "Point")) {
        const pos = parseInt(tagOne(pt, "position") ?? "1", 10);
        const valS = tagOne(pt, "price.amount") ?? tagOne(pt, "quantity") ?? tagOne(pt, "value");
        if (valS == null) continue;
        const value = parseFloat(valS);
        if (!Number.isFinite(value)) continue;
        const ts2 = new Date(startMs + (pos - 1) * stepMin * 60_000).toISOString();
        out.push({ ts: ts2, value });
      }
    }
  }
  // dedupe by ts (keep last)
  const byTs = new Map<string, number>();
  for (const r of out) byTs.set(r.ts, r.value);
  return [...byTs.entries()].map(([ts, value]) => ({ ts, value })).sort((a, b) => a.ts.localeCompare(b.ts));
}

// --- Public fetchers --------------------------------------------------------
export interface PriceSeries { zone: ZoneCode; points: Array<{ ts: string; price: number }>; }

export async function fetchDayAheadPrices(zone: ZoneCode, dayISO: string, demo = false, force = false): Promise<FetchResult<PriceSeries>> {
  const key = `da_prices:${zone}:${dayISO}`;
  if (!force) {
    const cached = await cacheGet<PriceSeries>(key, DEFAULT_TTL);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo || !token()) {
    const points = demoHourlyPrices(zone, dayISO);
    return { data: { zone, points }, source: "demo", fetched_at: new Date().toISOString() };
  }
  try {
    // SEEPEX / SEE delivery days are CET/CEST (Europe/Belgrade, UTC+1 or +2).
    // Build the proper local-day window so we return exactly the 24 hours of dayISO.
    const offsetH = cetOffsetHours(dayISO); // 1 in winter, 2 in DST
    const start = new Date(Date.parse(dayISO + "T00:00:00Z") - offsetH * 3600_000);
    const end = new Date(start.getTime() + 24 * 3600_000);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.day_ahead_prices,
      in_Domain: ZONES[zone].eic,
      out_Domain: ZONES[zone].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    // Keep only the 24 points falling inside the requested CET delivery day.
    const startMs = start.getTime();
    const endMs = end.getTime();
    const series = parseTimeSeriesHourly(xml)
      .filter(p => {
        const t = Date.parse(p.ts);
        return t >= startMs && t < endMs;
      })
      .map(p => ({ ts: p.ts, price: p.value }));
    const payload: PriceSeries = { zone, points: series };
    await cacheSet(key, payload);
    return { data: payload, source: series.length ? "live" : "empty", fetched_at: new Date().toISOString() };

  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    const points = demoHourlyPrices(zone, dayISO);
    return { data: { zone, points }, source: "demo", reason, fetched_at: new Date().toISOString() };
  }
}

export interface FlowSeries { from: ZoneCode; to: ZoneCode; points: Array<{ ts: string; mw: number }>; }
export async function fetchPhysicalFlows(from: ZoneCode, to: ZoneCode, dayISO: string, demo = false, force = false): Promise<FetchResult<FlowSeries>> {
  const key = `flow:${from}:${to}:${dayISO}`;
  if (!force) {
    const cached = await cacheGet<FlowSeries>(key, DEFAULT_TTL);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo || !token()) {
    const d = demoFlow(from, to, dayISO);
    return { data: { from, to, points: d.map(p => ({ ts: p.ts, mw: p.mw })) }, source: "demo", fetched_at: new Date().toISOString() };
  }
  try {
    const start = new Date(dayISO + "T00:00:00Z");
    const end = new Date(start.getTime() + 24 * 3600_000);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.physical_flows,
      in_Domain: ZONES[to].eic,
      out_Domain: ZONES[from].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    const series = parseTimeSeriesHourly(xml).map(p => ({ ts: p.ts, mw: p.value }));
    const payload: FlowSeries = { from, to, points: series };
    await cacheSet(key, payload);
    return { data: payload, source: series.length ? "live" : "empty", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    const d = demoFlow(from, to, dayISO);
    return { data: { from, to, points: d.map(p => ({ ts: p.ts, mw: p.mw })) }, source: "demo", reason, fetched_at: new Date().toISOString() };
  }
}

export interface CapacityRow {
  from: ZoneCode; to: ZoneCode; product: ProductType;
  price_eur_mwh: number | null; offered_mw: number | null; allocated_mw: number | null;
  unit_warning?: string;
}
export async function fetchExplicitAllocation(
  from: ZoneCode, to: ZoneCode, product: ProductType, dayISO: string, demo = false, force = false,
): Promise<FetchResult<CapacityRow>> {
  const key = `cap:${from}:${to}:${product}:${dayISO}`;
  if (!force) {
    const cached = await cacheGet<CapacityRow>(key, DEFAULT_TTL);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo || !token()) {
    const price = demoCapacityPrice(from, to, product, dayISO);
    const row: CapacityRow = {
      from, to, product,
      price_eur_mwh: price,
      offered_mw: 400, allocated_mw: 280,
      unit_warning: product !== "daily" ? "Monthly/annual A25 prices may be totals depending on TSO" : undefined,
    };
    return { data: row, source: "demo", fetched_at: new Date().toISOString() };
  }
  try {
    const start = new Date(dayISO + "T00:00:00Z");
    const end = new Date(start.getTime() + 24 * 3600_000);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.explicit_allocations,
      businessType: "B05",
      "contract_MarketAgreement.Type": MARKET_AGREEMENT_TYPES[product],
      in_Domain: ZONES[to].eic,
      out_Domain: ZONES[from].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    const series = parseTimeSeriesHourly(xml).map(p => p.value).filter(Number.isFinite);
    const price = series.length ? series.reduce((a, b) => a + b, 0) / series.length : null;
    const row: CapacityRow = {
      from, to, product, price_eur_mwh: price, offered_mw: null, allocated_mw: null,
      unit_warning: product !== "daily" ? "Monthly/annual A25 prices may be totals depending on TSO" : undefined,
    };
    await cacheSet(key, row);
    return { data: row, source: price != null ? "live" : "empty", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    const price = demoCapacityPrice(from, to, product, dayISO);
    return {
      data: { from, to, product, price_eur_mwh: price, offered_mw: null, allocated_mw: null },
      source: "demo", reason, fetched_at: new Date().toISOString(),
    };
  }
}

export interface OutageRow { unit: string; zone: ZoneCode; mw: number; type: string; start: string; end: string; }
export async function fetchOutages(zone: ZoneCode, dayISO: string, demo = false): Promise<FetchResult<OutageRow[]>> {
  const key = `outages:${zone}:${dayISO}`;
  if (demo || !token()) {
    return { data: demoOutages(zone, dayISO) as OutageRow[], source: "demo", fetched_at: new Date().toISOString() };
  }
  const cached = await cacheGet<OutageRow[]>(key, DEFAULT_TTL);
  if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  return { data: demoOutages(zone, dayISO) as OutageRow[], source: "demo", reason: "outage_parser_not_implemented", fetched_at: new Date().toISOString() };
}

export interface LoadGenPoint { ts: string; load_mw: number; gen_mw: number; }
export async function fetchLoadGen(zone: ZoneCode, dayISO: string, demo = false): Promise<FetchResult<LoadGenPoint[]>> {
  const key = `loadgen:${zone}:${dayISO}`;
  if (!demo && token()) {
    const cached = await cacheGet<LoadGenPoint[]>(key, DEFAULT_TTL);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  return { data: demoLoadGen(zone, dayISO), source: demo || !token() ? "demo" : "demo", reason: !token() ? "no_token" : "loadgen_parser_not_implemented", fetched_at: new Date().toISOString() };
}
