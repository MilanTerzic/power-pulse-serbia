// Deterministic synthetic data generator for DEMO mode.
// Marked clearly so consumers can label any value as DEMO.
import { ZONES, type ZoneCode } from "./markets";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ZONE_BASE: Partial<Record<ZoneCode, number>> = {
  RS: 105, HU: 100, RO: 98, BG: 95, HR: 102, SI: 108,
  BA: 92, ME: 98, MK: 96, AL: 94, UA: 110, XK: 100,
};

export function demoHourlyPrices(zone: ZoneCode, dayISO: string): Array<{ ts: string; price: number }> {
  const base = ZONE_BASE[zone] ?? 100;
  const seed = [...dayISO + zone].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const day = new Date(dayISO + "T00:00:00Z");
  const out: Array<{ ts: string; price: number }> = [];
  for (let h = 0; h < 24; h++) {
    // morning + evening peak shape
    const peak = 22 * Math.sin(((h - 6) / 24) * Math.PI * 2) + 14 * Math.sin(((h - 17) / 24) * Math.PI * 4);
    const noise = (rand() - 0.5) * 18;
    const ts = new Date(day.getTime() + h * 3600_000).toISOString();
    out.push({ ts, price: Math.max(-30, base + peak + noise) });
  }
  return out;
}

export function demoFlow(from: ZoneCode, to: ZoneCode, dayISO: string) {
  const seed = [...dayISO + from + to].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const cap = 200 + Math.floor(rand() * 400);
  const day = new Date(dayISO + "T00:00:00Z");
  return Array.from({ length: 24 }, (_, h) => ({
    ts: new Date(day.getTime() + h * 3600_000).toISOString(),
    mw: Math.max(0, cap * (0.4 + 0.55 * rand())),
    capacity: cap,
  }));
}

export function demoCapacityPrice(from: ZoneCode, to: ZoneCode, product: "annual" | "monthly" | "daily", dayISO: string) {
  const seed = [...dayISO + from + to + product].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const base = product === "annual" ? 6 : product === "monthly" ? 4.5 : 3.2;
  return base + (rand() - 0.3) * 4;
}

export function demoOutages(zone: ZoneCode, dayISO: string) {
  const seed = [...dayISO + zone].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const n = Math.floor(rand() * 4);
  const units = ["TPP Unit A", "TPP Unit B", "HPP Block 1", "NPP Unit 2", "Wind farm North"];
  return Array.from({ length: n }, (_, i) => ({
    unit: units[(i + Math.floor(rand() * units.length)) % units.length],
    zone,
    mw: Math.round(50 + rand() * 600),
    type: rand() > 0.5 ? "planned" : "forced",
    start: dayISO + "T00:00:00Z",
    end: dayISO + "T23:59:00Z",
  }));
}

export function demoWeather(zone: ZoneCode, dayISO: string) {
  const z = ZONES[zone];
  const seed = [...dayISO + zone].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const day = new Date(dayISO + "T00:00:00Z");
  const baseT = 8 + (z.capital?.lat ?? 45) * -0.3 + rand() * 6;
  return Array.from({ length: 24 }, (_, h) => ({
    ts: new Date(day.getTime() + h * 3600_000).toISOString(),
    temp_c: baseT + 6 * Math.sin(((h - 6) / 24) * Math.PI * 2) + (rand() - 0.5) * 1.5,
    wind_ms: 2 + 7 * rand(),
  }));
}

export function demoLoadGen(zone: ZoneCode, dayISO: string) {
  const seed = [...dayISO + zone + "lg"].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = mulberry32(seed);
  const day = new Date(dayISO + "T00:00:00Z");
  const loadBase = zone === "RS" ? 5200 : 4000;
  return Array.from({ length: 24 }, (_, h) => {
    const load = loadBase + 900 * Math.sin(((h - 8) / 24) * Math.PI * 2) + (rand() - 0.5) * 200;
    const gen = load + (rand() - 0.5) * 600;
    return {
      ts: new Date(day.getTime() + h * 3600_000).toISOString(),
      load_mw: Math.round(load),
      gen_mw: Math.round(gen),
    };
  });
}
