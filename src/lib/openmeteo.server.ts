// Weather + river-discharge: Open-Meteo primary, Visual Crossing fallback.
import { ZONES, type ZoneCode } from "./markets";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Per-source TTLs (seconds).
const WEATHER_TTL_TODAY = 60 * 60;          // 1h for today/future
const WEATHER_TTL_PAST = 7 * 24 * 3600;     // 7 days for past (immutable)
const DISCHARGE_TTL = 6 * 3600;             // 6h (river updates daily but cheap to cache)

function isPastDay(dayISO: string): boolean {
  return dayISO < new Date().toISOString().slice(0, 10);
}

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const { data } = await supabaseAdmin.from("api_cache")
      .select("payload, fetched_at, ttl_seconds").eq("key", key).maybeSingle();
    if (!data) return null;
    const age = (Date.now() - new Date(data.fetched_at as string).getTime()) / 1000;
    if (age > (data.ttl_seconds ?? 1800)) return null;
    return data.payload as T;
  } catch { return null; }
}
async function cacheSet(key: string, payload: unknown, ttl: number) {
  try {
    await supabaseAdmin.from("api_cache").upsert({
      key, payload: payload as never, fetched_at: new Date().toISOString(), ttl_seconds: ttl,
    });
  } catch { /* best-effort */ }
}

export interface WeatherPoint { ts: string; temp_c: number; wind_ms: number; }

async function fetchJson(url: string, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function fetchWeatherVisualCrossing(lat: number, lon: number, dayISO: string): Promise<WeatherPoint[]> {
  const key = process.env.VISUAL_CROSSING_API_KEY;
  if (!key) throw new Error("VISUAL_CROSSING_API_KEY not configured");
  const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/${dayISO}/${dayISO}?unitGroup=metric&include=hours&elements=datetime,temp,windspeed&key=${encodeURIComponent(key)}&contentType=json`;
  const j = await fetchJson(url) as { days?: Array<{ datetime: string; hours?: Array<{ datetime: string; temp: number; windspeed: number }> }> };
  const hours = j.days?.[0]?.hours ?? [];
  return hours.map(h => ({
    ts: new Date(`${dayISO}T${h.datetime}Z`).toISOString(),
    temp_c: h.temp,
    wind_ms: (h.windspeed ?? 0) / 3.6,
  }));
}

export async function fetchWeather(zone: ZoneCode, dayISO: string): Promise<{ data: WeatherPoint[]; source: "live" | "visual-crossing" | "cache" | "demo"; reason?: string }> {
  const cap = ZONES[zone].capital;
  if (!cap) return { data: [], source: "demo", reason: "no_capital" };
  const cacheKey = `weather:${zone}:${dayISO}`;
  const cached = await cacheGet<{ data: WeatherPoint[]; source: "live" | "visual-crossing" }>(cacheKey);
  if (cached) return { data: cached.data, source: "cache", reason: `was_${cached.source}` };
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${cap.lat}&longitude=${cap.lon}&hourly=temperature_2m,wind_speed_10m&start_date=${dayISO}&end_date=${dayISO}&timezone=UTC`;
    const j = await fetchJson(url) as { hourly?: { time: string[]; temperature_2m: number[]; wind_speed_10m: number[] } };
    const h = j.hourly;
    if (!h || !h.time?.length) throw new Error("empty");
    const data: WeatherPoint[] = h.time.map((t, i) => ({ ts: new Date(t + "Z").toISOString(), temp_c: h.temperature_2m[i], wind_ms: h.wind_speed_10m[i] / 3.6 }));
    await cacheSet(cacheKey, { data, source: "live" }, isPastDay(dayISO) ? WEATHER_TTL_PAST : WEATHER_TTL_TODAY);
    return { data, source: "live" };
  } catch (primary) {
    try {
      const data = await fetchWeatherVisualCrossing(cap.lat, cap.lon, dayISO);
      if (data.length) {
        await cacheSet(cacheKey, { data, source: "visual-crossing" }, isPastDay(dayISO) ? WEATHER_TTL_PAST : WEATHER_TTL_TODAY);
        return { data, source: "visual-crossing", reason: "open_meteo_unavailable" };
      }
      throw new Error("vc_empty");
    } catch (fb) {
      return { data: [], source: "demo", reason: `${primary instanceof Error ? primary.message : "err"} / ${fb instanceof Error ? fb.message : "err"}` };
    }
  }
}

export interface DischargePoint { date: string; discharge_m3s: number; }

export async function fetchRiverDischarge(lat: number, lon: number, from: string, to: string): Promise<{ data: DischargePoint[]; source: "open-meteo" | "visual-crossing" | "cache" | "none"; reason?: string }> {
  const cacheKey = `discharge:${lat.toFixed(3)},${lon.toFixed(3)}:${from}:${to}`;
  const cached = await cacheGet<{ data: DischargePoint[]; source: "open-meteo" | "visual-crossing" }>(cacheKey);
  if (cached) return { data: cached.data, source: "cache", reason: `was_${cached.source}` };
  try {
    const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&start_date=${from}&end_date=${to}`;
    const j = await fetchJson(url) as { daily?: { time: string[]; river_discharge: (number | null)[] } };
    const d = j.daily;
    if (!d?.time?.length) throw new Error("empty");
    const data: DischargePoint[] = d.time.map((t, i) => ({ date: t, discharge_m3s: (d.river_discharge[i] ?? 0) as number }));
    await cacheSet(cacheKey, { data, source: "open-meteo" }, DISCHARGE_TTL);
    return { data, source: "open-meteo" };
  } catch (primary) {
    // Visual Crossing doesn't publish river discharge; fall back to precipitation as a proxy.
    try {
      const key = process.env.VISUAL_CROSSING_API_KEY;
      if (!key) throw new Error("no_vc_key");
      const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${lat},${lon}/${from}/${to}?unitGroup=metric&include=days&elements=datetime,precip&key=${encodeURIComponent(key)}&contentType=json`;
      const j = await fetchJson(url) as { days?: Array<{ datetime: string; precip: number | null }> };
      const days = j.days ?? [];
      const data: DischargePoint[] = days.map(d => ({ date: d.datetime, discharge_m3s: (d.precip ?? 0) as number }));
      if (data.length) await cacheSet(cacheKey, { data, source: "visual-crossing" }, DISCHARGE_TTL);
      return { data, source: "visual-crossing", reason: "discharge_unavailable_using_precip_proxy" };
    } catch (fb) {
      return { data: [], source: "none", reason: `${primary instanceof Error ? primary.message : "err"} / ${fb instanceof Error ? fb.message : "err"}` };
    }
  }
}
