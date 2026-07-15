// ENTSO-E Transparency Platform client — server-only.
// Mirrors fetchers from the uploaded Python app.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ZONES,
  ENTSOE_DOCUMENT_TYPES,
  MARKET_AGREEMENT_TYPES,
  type ZoneCode,
  type ProductType,
} from "./markets";
import { PRICE_MARKETS, type PriceMarketCode } from "./price-markets";

const API_BASE = "https://web-api.tp.entsoe.eu/api";
const DEFAULT_TTL = 1800;
// Per-source TTLs (seconds).
const TTL = {
  da_today: 30 * 60, // today / future: refresh every 30 min
  da_past: 7 * 24 * 3600, // past days: immutable, keep 7 days
  flow_today: 30 * 60,
  flow_past: 7 * 24 * 3600,
  cap_today: 30 * 60,
  cap_past: 7 * 24 * 3600,
  outages: 60 * 60, // 1h
  loadgen_today: 30 * 60,
  loadgen_past: 24 * 3600,
} as const;

// Returns true when dayISO is strictly before today (UTC) — i.e. immutable historical data.
function isPastDay(dayISO: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return dayISO < today;
}
function ttlFor(today: number, past: number, dayISO: string): number {
  return isPastDay(dayISO) ? past : today;
}

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

// Europe/Belgrade UTC offset at local delivery-day midnight.
function cetOffsetHours(dayISO: string): number {
  const utcMidnight = new Date(dayISO + "T00:00:00Z");
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    timeZoneName: "shortOffset",
  });
  const part =
    fmt.formatToParts(utcMidnight).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = /([+-]?\d+)/.exec(part);
  return m ? parseInt(m[1], 10) : 1;
}

function belgradeDeliveryWindow(dayISO: string) {
  const startOffsetH = cetOffsetHours(dayISO);
  const next = new Date(dayISO + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  const nextISO = next.toISOString().slice(0, 10);
  const endOffsetH = cetOffsetHours(nextISO);
  const start = new Date(Date.parse(dayISO + "T00:00:00Z") - startOffsetH * 3600_000);
  const end = new Date(Date.parse(nextISO + "T00:00:00Z") - endOffsetH * 3600_000);
  return { start, end };
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

async function cacheGetStale<T>(key: string): Promise<T | null> {
  const { data } = await supabaseAdmin
    .from("api_cache")
    .select("payload")
    .eq("key", key)
    .maybeSingle();
  return data ? (data.payload as T) : null;
}

async function staleCacheOrEmpty<T>(
  key: string,
  emptyData: T,
  reason: string,
): Promise<FetchResult<T>> {
  const cached = await cacheGetStale<T>(key);
  if (cached) {
    return {
      data: cached,
      source: "cache",
      reason: `stale_cache_${reason}`,
      fetched_at: new Date().toISOString(),
    };
  }
  return { data: emptyData, source: "empty", reason, fetched_at: new Date().toISOString() };
}

async function cacheSet(key: string, payload: unknown, ttl = DEFAULT_TTL) {
  await supabaseAdmin.from("api_cache").upsert({
    key,
    payload: payload as never,
    fetched_at: new Date().toISOString(),
    ttl_seconds: ttl,
  });
}

function isRetryableEntsoeStatus(status: number) {
  return status === 429 || status >= 500;
}

async function entsoeRaw(params: Record<string, string>): Promise<string> {
  const t = token();
  if (!t) throw new Error("ENTSOE_API_TOKEN missing");
  const qs = new URLSearchParams({ securityToken: t, ...params });
  const url = `${API_BASE}?${qs.toString()}`;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/xml" },
        signal: controller.signal,
      });
      lastStatus = res.status;
      if (res.status === 200) return await res.text();
      if (!isRetryableEntsoeStatus(res.status) || attempt === 1) {
        if (res.status === 400) throw new Error("entsoe_no_data");
        if (res.status === 401 || res.status === 403) throw new Error("entsoe_unauthorized");
        if (res.status === 429) throw new Error("entsoe_rate_limited");
        throw new Error(`entsoe_http_${res.status}`);
      }
    } catch (error) {
      if (attempt === 1) {
        if (error instanceof Error && error.name === "AbortError")
          throw new Error("entsoe_timeout");
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
  }
  throw new Error(`entsoe_http_${lastStatus || "unknown"}`);
}

// --- Tiny XML utilities -----------------------------------------------------
function stripNs(xml: string) {
  return xml.replace(/<\/?[\w:-]+:/g, (m) => m.replace(/[\w-]+:/, ""));
}
function tagAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function tagOne(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
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
      const stepMin = /PT(\d+)M/.exec(resolution)?.[1]
        ? parseInt(/PT(\d+)M/.exec(resolution)![1], 10)
        : 60;
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
  return [...byTs.entries()]
    .map(([ts, value]) => ({ ts, value }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

function parseResolutionMinutes(resolution: string | null): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(resolution ?? "");
  if (!m) return 60;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + min || 60;
}

function parseTimeSeriesIntervals(xml: string): Array<{
  ts: string;
  value: number;
  durationMinutes: number;
  productionType?: string;
  mRID?: string;
}> {
  const clean = stripNs(xml);
  const out: Array<{
    ts: string;
    value: number;
    durationMinutes: number;
    productionType?: string;
    mRID?: string;
  }> = [];
  for (const ts of tagAll(clean, "TimeSeries")) {
    const productionType = tagOne(ts, "psrType") ?? undefined;
    const mRID = tagOne(ts, "mRID") ?? undefined;
    for (const period of tagAll(ts, "Period")) {
      const start = tagOne(period, "start");
      if (!start) continue;
      const startMs = Date.parse(start);
      const durationMinutes = parseResolutionMinutes(tagOne(period, "resolution"));
      for (const pt of tagAll(period, "Point")) {
        const pos = parseInt(tagOne(pt, "position") ?? "1", 10);
        const valS = tagOne(pt, "price.amount") ?? tagOne(pt, "quantity") ?? tagOne(pt, "value");
        if (valS == null) continue;
        const value = parseFloat(valS);
        if (!Number.isFinite(value)) continue;
        const ts2 = new Date(startMs + (pos - 1) * durationMinutes * 60_000).toISOString();
        out.push({ ts: ts2, value, durationMinutes, productionType, mRID });
      }
    }
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

function parseAllocationSummary(xml: string): {
  price_eur_mwh: number | null;
  quantity_mw: number | null;
} {
  const clean = stripNs(xml);
  const prices: number[] = [];
  const quantities: number[] = [];
  for (const ts of tagAll(clean, "TimeSeries")) {
    for (const period of tagAll(ts, "Period")) {
      for (const pt of tagAll(period, "Point")) {
        const price = parseFloat(tagOne(pt, "price.amount") ?? "");
        const quantity = parseFloat(tagOne(pt, "quantity") ?? "");
        if (Number.isFinite(price)) prices.push(price);
        if (Number.isFinite(quantity)) quantities.push(quantity);
      }
    }
  }
  return { price_eur_mwh: avg(prices), quantity_mw: avg(quantities) };
}

// --- Public fetchers --------------------------------------------------------
export interface PriceSeries {
  zone: PriceMarketCode;
  points: Array<{ ts: string; price: number }>;
}
export interface IntervalPriceSeries {
  zone: PriceMarketCode;
  points: Array<{ ts: string; price: number; durationMinutes: number }>;
}

export async function fetchDayAheadPrices(
  zone: PriceMarketCode,
  dayISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<PriceSeries>> {
  const key = `da_prices:${zone}:${dayISO}`;
  const emptyData: PriceSeries = { zone, points: [] };
  if (!force) {
    const cached = await cacheGet<PriceSeries>(key, DEFAULT_TTL);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    // SEEPEX / SEE delivery days are CET/CEST (Europe/Belgrade, UTC+1 or +2).
    // Build the proper local-day window so we return exactly the 24 hours of dayISO.
    const { start, end } = belgradeDeliveryWindow(dayISO);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.day_ahead_prices,
      in_Domain: PRICE_MARKETS[zone].eic,
      out_Domain: PRICE_MARKETS[zone].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    // Keep only the 24 points falling inside the requested CET delivery day.
    const startMs = start.getTime();
    const endMs = end.getTime();
    const series = parseTimeSeriesHourly(xml)
      .filter((p) => {
        const t = Date.parse(p.ts);
        return t >= startMs && t < endMs;
      })
      .map((p) => ({ ts: p.ts, price: p.value }));
    if (!series.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    const payload: PriceSeries = { zone, points: series };
    await cacheSet(key, payload, ttlFor(TTL.da_today, TTL.da_past, dayISO));
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export async function fetchDayAheadPricesRange(
  zone: PriceMarketCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<IntervalPriceSeries>> {
  const key = `da_prices_range:v1:${zone}:${fromISO}:${toISO}`;
  const emptyData: IntervalPriceSeries = { zone, points: [] };
  const ttl = toISO < new Date().toISOString().slice(0, 10) ? TTL.da_past : TTL.da_today;
  if (!force) {
    const cached = await cacheGet<IntervalPriceSeries>(key, ttl);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const points: IntervalPriceSeries["points"] = [];
    for (const chunk of chunkDateRange(fromISO, toISO, 92)) {
      const startOffsetH = cetOffsetHours(chunk.from);
      const start = new Date(Date.parse(chunk.from + "T00:00:00Z") - startOffsetH * 3600_000);
      const afterTo = new Date(Date.parse(chunk.to + "T00:00:00Z") + 24 * 3600_000)
        .toISOString()
        .slice(0, 10);
      const endOffsetH = cetOffsetHours(afterTo);
      const end = new Date(Date.parse(afterTo + "T00:00:00Z") - endOffsetH * 3600_000);
      const xml = await entsoeRaw({
        documentType: ENTSOE_DOCUMENT_TYPES.day_ahead_prices,
        in_Domain: PRICE_MARKETS[zone].eic,
        out_Domain: PRICE_MARKETS[zone].eic,
        periodStart: ymdh(start),
        periodEnd: ymdh(end),
      });
      const startMs = start.getTime();
      const endMs = end.getTime();
      points.push(
        ...parseTimeSeriesIntervals(xml)
          .filter((p) => {
            const t = Date.parse(p.ts);
            return t >= startMs && t < endMs;
          })
          .map((p) => ({ ts: p.ts, price: p.value, durationMinutes: p.durationMinutes })),
      );
    }
    if (!points.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    const byTs = new Map(points.map((point) => [point.ts, point]));
    const payload = {
      zone,
      points: [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts)),
    };
    await cacheSet(key, payload, ttl);
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

function chunkDateRange(fromISO: string, toISO: string, maxDays: number) {
  const chunks: Array<{ from: string; to: string }> = [];
  let cur = Date.parse(fromISO + "T00:00:00Z");
  const end = Date.parse(toISO + "T00:00:00Z");
  while (cur <= end) {
    const chunkEnd = Math.min(end, cur + (maxDays - 1) * 86400_000);
    chunks.push({
      from: new Date(cur).toISOString().slice(0, 10),
      to: new Date(chunkEnd).toISOString().slice(0, 10),
    });
    cur = chunkEnd + 86400_000;
  }
  return chunks;
}

export async function validatePriceMarket(
  zone: PriceMarketCode,
  dayISO: string,
): Promise<{
  market: PriceMarketCode;
  eic: string;
  intervals: number;
  intervalResolutionMinutes: number | null;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  source: FetchResult<IntervalPriceSeries>["source"];
  reason?: string;
}> {
  const result = await fetchDayAheadPricesRange(zone, dayISO, dayISO);
  const points = result.data.points;
  const resolutions = [...new Set(points.map((point) => point.durationMinutes))];
  return {
    market: zone,
    eic: PRICE_MARKETS[zone].eic,
    intervals: points.length,
    intervalResolutionMinutes: resolutions.length === 1 ? resolutions[0] : null,
    firstTimestamp: points[0]?.ts ?? null,
    lastTimestamp: points[points.length - 1]?.ts ?? null,
    source: result.source,
    reason: result.reason,
  };
}

export interface FlowSeries {
  from: ZoneCode;
  to: ZoneCode;
  points: Array<{ ts: string; mw: number }>;
}
export interface IntervalFlowSeries {
  from: ZoneCode;
  to: ZoneCode;
  points: Array<{ ts: string; mw: number; durationMinutes: number }>;
}
export async function fetchPhysicalFlows(
  from: ZoneCode,
  to: ZoneCode,
  dayISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<FlowSeries>> {
  const key = `flow:${from}:${to}:${dayISO}`;
  const emptyData: FlowSeries = { from, to, points: [] };
  if (!force) {
    const cached = await cacheGet<FlowSeries>(key, DEFAULT_TTL);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const { start, end } = belgradeDeliveryWindow(dayISO);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.physical_flows,
      in_Domain: ZONES[to].eic,
      out_Domain: ZONES[from].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    const startMs = start.getTime();
    const endMs = end.getTime();
    const series = parseTimeSeriesHourly(xml)
      .filter((p) => {
        const t = Date.parse(p.ts);
        return t >= startMs && t < endMs;
      })
      .map((p) => ({ ts: p.ts, mw: p.value }));
    if (!series.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    const payload: FlowSeries = { from, to, points: series };
    await cacheSet(key, payload, ttlFor(TTL.flow_today, TTL.flow_past, dayISO));
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export async function fetchPhysicalFlowsRange(
  from: ZoneCode,
  to: ZoneCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<IntervalFlowSeries>> {
  const key = `flow_range:v1:${from}:${to}:${fromISO}:${toISO}`;
  const emptyData: IntervalFlowSeries = { from, to, points: [] };
  const ttl = toISO < new Date().toISOString().slice(0, 10) ? TTL.flow_past : TTL.flow_today;
  if (!force) {
    const cached = await cacheGet<IntervalFlowSeries>(key, ttl);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const startOffsetH = cetOffsetHours(fromISO);
    const start = new Date(Date.parse(fromISO + "T00:00:00Z") - startOffsetH * 3600_000);
    const afterTo = new Date(Date.parse(toISO + "T00:00:00Z") + 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const endOffsetH = cetOffsetHours(afterTo);
    const end = new Date(Date.parse(afterTo + "T00:00:00Z") - endOffsetH * 3600_000);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.physical_flows,
      in_Domain: ZONES[to].eic,
      out_Domain: ZONES[from].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    const startMs = start.getTime();
    const endMs = end.getTime();
    const points = parseTimeSeriesIntervals(xml)
      .filter((p) => {
        const t = Date.parse(p.ts);
        return t >= startMs && t < endMs;
      })
      .map((p) => ({ ts: p.ts, mw: p.value, durationMinutes: p.durationMinutes }));
    if (!points.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    const payload = { from, to, points };
    await cacheSet(key, payload, ttl);
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export interface CapacityRow {
  from: ZoneCode;
  to: ZoneCode;
  product: ProductType;
  price_eur_mwh: number | null;
  offered_mw: number | null;
  allocated_mw: number | null;
  unit_warning?: string;
}
export async function fetchExplicitAllocation(
  from: ZoneCode,
  to: ZoneCode,
  product: ProductType,
  dayISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<CapacityRow>> {
  const key = `cap:${from}:${to}:${product}:${dayISO}`;
  const emptyData: CapacityRow = {
    from,
    to,
    product,
    price_eur_mwh: null,
    offered_mw: null,
    allocated_mw: null,
    unit_warning:
      product !== "daily" ? "Monthly/annual A25 prices may be totals depending on TSO" : undefined,
  };
  const t = token();
  if (!force) {
    const cached = await cacheGet<CapacityRow>(key, DEFAULT_TTL);
    if (cached && (!t || cached.offered_mw != null || cached.allocated_mw != null)) {
      return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
    }
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!t) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const { start, end } = belgradeDeliveryWindow(dayISO);
    const baseParams = {
      documentType: ENTSOE_DOCUMENT_TYPES.explicit_allocations,
      "contract_MarketAgreement.Type": MARKET_AGREEMENT_TYPES[product],
      in_Domain: ZONES[to].eic,
      out_Domain: ZONES[from].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    };

    const allocatedXml = await entsoeRaw({ ...baseParams, businessType: "B05" });
    const allocated = parseAllocationSummary(allocatedXml);

    let offeredMw: number | null = null;
    try {
      const offeredXml = await entsoeRaw({ ...baseParams, businessType: "A31" });
      offeredMw = parseAllocationSummary(offeredXml).quantity_mw;
    } catch {
      offeredMw = null;
    }

    if (allocated.price_eur_mwh == null && allocated.quantity_mw == null && offeredMw == null) {
      return staleCacheOrEmpty(key, emptyData, "no_data");
    }
    const row: CapacityRow = {
      from,
      to,
      product,
      price_eur_mwh: allocated.price_eur_mwh,
      offered_mw: offeredMw,
      allocated_mw: allocated.quantity_mw,
      unit_warning:
        product !== "daily"
          ? "Monthly/annual A25 prices may be totals depending on TSO"
          : undefined,
    };
    await cacheSet(key, row, ttlFor(TTL.cap_today, TTL.cap_past, dayISO));
    return { data: row, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export interface OutageRow {
  unit: string;
  zone: ZoneCode;
  mw: number;
  type: string;
  start: string;
  end: string;
}
export async function fetchOutages(
  zone: ZoneCode,
  dayISO: string,
  demo = false,
): Promise<FetchResult<OutageRow[]>> {
  const key = `outages:${zone}:${dayISO}`;
  const emptyData: OutageRow[] = [];
  const cached = await cacheGet<OutageRow[]>(key, DEFAULT_TTL);
  if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  return staleCacheOrEmpty(key, emptyData, "outage_parser_not_implemented");
}

export interface LoadGenPoint {
  ts: string;
  load_mw: number;
  gen_mw: number;
}
export interface ActualLoadPoint {
  ts: string;
  load_mw: number;
  durationMinutes: number;
}
export interface ActualGenerationPoint {
  ts: string;
  gen_mw: number;
  durationMinutes: number;
  production?: Record<string, number>;
}

export async function fetchActualLoadRange(
  zone: ZoneCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<{ zone: ZoneCode; points: ActualLoadPoint[] }>> {
  const key = `actual_load_range:v1:${zone}:${fromISO}:${toISO}`;
  const emptyData = { zone, points: [] as ActualLoadPoint[] };
  const ttl = toISO < new Date().toISOString().slice(0, 10) ? TTL.loadgen_past : TTL.loadgen_today;
  if (!force) {
    const cached = await cacheGet<typeof emptyData>(key, ttl);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const startOffsetH = cetOffsetHours(fromISO);
    const start = new Date(Date.parse(fromISO + "T00:00:00Z") - startOffsetH * 3600_000);
    const afterTo = new Date(Date.parse(toISO + "T00:00:00Z") + 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const endOffsetH = cetOffsetHours(afterTo);
    const end = new Date(Date.parse(afterTo + "T00:00:00Z") - endOffsetH * 3600_000);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.system_total_load,
      processType: "A16",
      outBiddingZone_Domain: ZONES[zone].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    const startMs = start.getTime();
    const endMs = end.getTime();
    const byTs = new Map<string, ActualLoadPoint>();
    for (const p of parseTimeSeriesIntervals(xml)) {
      const t = Date.parse(p.ts);
      if (t < startMs || t >= endMs) continue;
      byTs.set(p.ts, { ts: p.ts, load_mw: p.value, durationMinutes: p.durationMinutes });
    }
    const payload = { zone, points: [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts)) };
    if (!payload.points.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    await cacheSet(key, payload, ttl);
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export async function fetchActualGenerationRange(
  zone: ZoneCode,
  fromISO: string,
  toISO: string,
  demo = false,
  force = false,
): Promise<FetchResult<{ zone: ZoneCode; points: ActualGenerationPoint[] }>> {
  const key = `actual_generation_range:v1:${zone}:${fromISO}:${toISO}`;
  const emptyData = { zone, points: [] as ActualGenerationPoint[] };
  const ttl = toISO < new Date().toISOString().slice(0, 10) ? TTL.loadgen_past : TTL.loadgen_today;
  if (!force) {
    const cached = await cacheGet<typeof emptyData>(key, ttl);
    if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  }
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  try {
    const startOffsetH = cetOffsetHours(fromISO);
    const start = new Date(Date.parse(fromISO + "T00:00:00Z") - startOffsetH * 3600_000);
    const afterTo = new Date(Date.parse(toISO + "T00:00:00Z") + 24 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const endOffsetH = cetOffsetHours(afterTo);
    const end = new Date(Date.parse(afterTo + "T00:00:00Z") - endOffsetH * 3600_000);
    const xml = await entsoeRaw({
      documentType: ENTSOE_DOCUMENT_TYPES.actual_generation,
      processType: "A16",
      in_Domain: ZONES[zone].eic,
      periodStart: ymdh(start),
      periodEnd: ymdh(end),
    });
    const startMs = start.getTime();
    const endMs = end.getTime();
    const buckets = new Map<string, { durationMinutes: number; production: Map<string, number> }>();
    for (const p of parseTimeSeriesIntervals(xml)) {
      const t = Date.parse(p.ts);
      if (t < startMs || t >= endMs) continue;
      const productionType = p.productionType ?? "unclassified";
      const cur = buckets.get(p.ts) ?? {
        durationMinutes: p.durationMinutes,
        production: new Map<string, number>(),
      };
      cur.production.set(productionType, (cur.production.get(productionType) ?? 0) + p.value);
      cur.durationMinutes = Math.min(cur.durationMinutes, p.durationMinutes);
      buckets.set(p.ts, cur);
    }
    const points: ActualGenerationPoint[] = [...buckets.entries()]
      .map(([ts, b]) => {
        const production = Object.fromEntries(b.production.entries());
        const techKeys = Object.keys(production).filter((k) => k !== "unclassified" && k !== "B00");
        const useKeys = techKeys.length ? techKeys : Object.keys(production);
        const gen_mw = useKeys.reduce((acc, k) => acc + (production[k] ?? 0), 0);
        return { ts, gen_mw, durationMinutes: b.durationMinutes, production };
      })
      .sort((a, b) => a.ts.localeCompare(b.ts));
    const payload = { zone, points };
    if (!payload.points.length) return staleCacheOrEmpty(key, emptyData, "no_data");
    await cacheSet(key, payload, ttl);
    return { data: payload, source: "live", fetched_at: new Date().toISOString() };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "error";
    return staleCacheOrEmpty(key, emptyData, reason);
  }
}

export async function fetchLoadGen(
  zone: ZoneCode,
  dayISO: string,
  demo = false,
): Promise<FetchResult<LoadGenPoint[]>> {
  const key = `loadgen:${zone}:${dayISO}`;
  const emptyData: LoadGenPoint[] = [];
  const cached = await cacheGet<LoadGenPoint[]>(key, DEFAULT_TTL);
  if (cached) return { data: cached, source: "cache", fetched_at: new Date().toISOString() };
  if (demo) return staleCacheOrEmpty(key, emptyData, "demo_disabled");
  if (!token()) return staleCacheOrEmpty(key, emptyData, "no_token");
  const [load, gen] = await Promise.all([
    fetchActualLoadRange(zone, dayISO, dayISO),
    fetchActualGenerationRange(zone, dayISO, dayISO),
  ]);
  const genByTs = new Map(gen.data.points.map((p) => [p.ts, p.gen_mw]));
  const rows = load.data.points
    .filter((p) => genByTs.has(p.ts))
    .map((p) => ({
      ts: p.ts,
      load_mw: p.load_mw,
      gen_mw: genByTs.get(p.ts)!,
    }));
  if (!rows.length || !gen.data.points.length) {
    return staleCacheOrEmpty(
      key,
      emptyData,
      rows.length ? "generation_unavailable" : "load_unavailable",
    );
  }
  await cacheSet(key, rows, ttlFor(TTL.loadgen_today, TTL.loadgen_past, dayISO));
  return {
    data: rows,
    source: load.source === "live" || gen.source === "live" ? "live" : "cache",
    fetched_at: new Date().toISOString(),
  };
}
