// Open-Meteo client (no API key)
import { ZONES, type ZoneCode } from "./markets";

export interface WeatherPoint { ts: string; temp_c: number; wind_ms: number; }

export async function fetchWeather(zone: ZoneCode, dayISO: string): Promise<{ data: WeatherPoint[]; source: "live" | "demo"; reason?: string }> {
  const cap = ZONES[zone].capital;
  if (!cap) {
    return { data: [], source: "demo", reason: "no_capital" };
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${cap.lat}&longitude=${cap.lon}&hourly=temperature_2m,wind_speed_10m&start_date=${dayISO}&end_date=${dayISO}&timezone=UTC`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`open_meteo_${res.status}`);
    const j = await res.json() as { hourly?: { time: string[]; temperature_2m: number[]; wind_speed_10m: number[] } };
    const h = j.hourly;
    if (!h) return { data: [], source: "demo", reason: "empty" };
    const data = h.time.map((t, i) => ({
      ts: new Date(t + "Z").toISOString(),
      temp_c: h.temperature_2m[i],
      wind_ms: h.wind_speed_10m[i] / 3.6, // km/h → m/s
    }));
    return { data, source: "live" };
  } catch (e) {
    return { data: [], source: "demo", reason: e instanceof Error ? e.message : "error" };
  }
}
