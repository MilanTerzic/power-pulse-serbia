import { TECHNICAL_NTC_MW, UNDIRECTED_BORDERS, type ZoneCode } from "./markets";

export const REPORT_TZ = "Europe/Belgrade" as const;

export type ReportPreset = "last7" | "last30" | "currentMonth" | "previousMonth" | "custom";
export type SourceStatus = "live" | "cache" | "empty" | "demo" | "partial" | "error";

export interface TimedValue {
  ts: string;
  value: number;
  durationMinutes?: number;
}

export interface PricePoint {
  ts: string;
  price: number;
  durationMinutes?: number;
}

export interface FlowPoint {
  ts: string;
  mw: number;
  durationMinutes?: number;
}

export interface DailyPriceMetrics {
  day: string;
  baseload: number | null;
  peakload: number | null;
  offpeak: number | null;
  min: number | null;
  max: number | null;
  volatility: number | null;
  negativeHours: number;
  availableHours: number;
  expectedHours: number;
  coveragePct: number | null;
  partial: boolean;
}

export interface MarketPriceSummary extends Omit<DailyPriceMetrics, "day" | "partial"> {
  zone: ZoneCode;
  p10: number | null;
  p90: number | null;
  negativeSharePct: number | null;
  avgSpreadVsRS: number | null;
  avgAbsSpreadVsRS: number | null;
  cheaperThanRSPct: number | null;
  moreExpensiveThanRSPct: number | null;
  correlationVsRS: number | null;
  source: SourceStatus;
}

export interface DailyCountryPosition {
  day: string;
  position: "Net importer" | "Net exporter" | "Approximately balanced" | "Partial data";
  importsMwh: number | null;
  exportsMwh: number | null;
  netImportsMwh: number | null;
  avgNetMw: number | null;
  peakImportMw: number | null;
  peakExportMw: number | null;
  loadMwh: number | null;
  generationMwh: number | null;
  generationMinusLoadMwh: number | null;
  coveragePct: number | null;
  partial: boolean;
}

export interface CountryPositionReport {
  country: ZoneCode;
  daily: DailyCountryPosition[];
  totals: {
    importsMwh: number | null;
    exportsMwh: number | null;
    netImportsMwh: number | null;
    netImporterDays: number;
    netExporterDays: number;
    peakImportMw: number | null;
    peakExportMw: number | null;
  };
  note: string;
}

export interface BorderFlowSummary {
  border: string;
  from: ZoneCode;
  to: ZoneCode;
  dominantDirection: string;
  inboundGwh: number | null;
  outboundGwh: number | null;
  netGwh: number | null;
  avgMw: number | null;
  peakMw: number | null;
  flowLoadFactorPct: number | null;
  averageUtilizationPct: number | null;
  peakUtilizationPct: number | null;
  directionReversals: number;
  coveragePct: number | null;
  source: SourceStatus;
}

export interface CapacityDirectionSummary {
  direction: string;
  product: "daily" | "monthly";
  averagePrice: number | null;
  volumeWeightedAveragePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  validObservations: number;
  expectedObservations: number;
  coveragePct: number | null;
  averageOfferedMw: number | null;
  averageAllocatedMw: number | null;
  allocationRatioPct: number | null;
  unit: string;
  warning?: string;
  source: SourceStatus;
}

export interface RouteEconomicsRow {
  route: string;
  direction: "import" | "export";
  avgGrossMargin: number | null;
  avgNetMargin: number | null;
  positiveGrossHours: number;
  positiveNetHours: number | null;
  maxHourlyNetMargin: number | null;
  theoreticalGrossValuePerMw: number | null;
  theoreticalNetValuePerMw: number | null;
  bestDeliveryDay: string | null;
  worstDeliveryDay: string | null;
  priceCoveragePct: number | null;
  capacityCoveragePct: number | null;
}

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const partFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: REPORT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

function parseISODate(day: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Invalid date: ${day}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function localDateISO(date = new Date()): string {
  return dateFmt.format(date);
}

export function addDaysISO(day: string, delta: number): string {
  const { y, m, d } = parseISODate(day);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export function monthStartISO(day: string): string {
  const { y, m } = parseISODate(day);
  return isoDate(y, m, 1);
}

export function previousMonthRange(today = localDateISO()): { from: string; to: string } {
  const { y, m } = parseISODate(today);
  const firstThis = Date.UTC(y, m - 1, 1);
  const lastPrev = new Date(firstThis - 86_400_000).toISOString().slice(0, 10);
  return { from: monthStartISO(lastPrev), to: lastPrev };
}

export function calculatePresetRange(
  preset: ReportPreset,
  custom: { from: string; to: string },
  now = new Date(),
): { from: string; to: string } {
  const today = localDateISO(now);
  if (preset === "last7") return { from: addDaysISO(today, -6), to: today };
  if (preset === "last30") return { from: addDaysISO(today, -29), to: today };
  if (preset === "currentMonth") return { from: monthStartISO(today), to: today };
  if (preset === "previousMonth") return previousMonthRange(today);
  return custom;
}

export function expandDays(from: string, to: string, maxDays = 62): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < maxDays && cur <= to; i++) {
    out.push(cur);
    cur = addDaysISO(cur, 1);
  }
  return out.length ? out : [from];
}

function partsFor(ts: string): DateParts {
  const obj: Record<string, string> = {};
  for (const p of partFmt.formatToParts(new Date(ts))) {
    if (p.type !== "literal") obj[p.type] = p.value;
  }
  const weekdays: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(obj.year),
    month: Number(obj.month),
    day: Number(obj.day),
    hour: Number(obj.hour),
    minute: Number(obj.minute),
    weekday: weekdays[obj.weekday] ?? 1,
  };
}

export function deliveryDay(ts: string): string {
  const p = partsFor(ts);
  return isoDate(p.year, p.month, p.day);
}

export function deliveryHour(ts: string): number {
  return partsFor(ts).hour;
}

export function localLabel(ts: string, withDate = true): string {
  return new Date(ts).toLocaleString("en-GB", {
    timeZone: REPORT_TZ,
    day: withDate ? "2-digit" : undefined,
    month: withDate ? "short" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function offsetMs(date: Date): number {
  const p = partsFor(date.toISOString());
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - date.getTime();
}

export function zonedTimeToUtc(day: string, hour = 0, minute = 0): Date {
  const { y, m, d } = parseISODate(day);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute));
  let utc = new Date(guess.getTime() - offsetMs(guess));
  utc = new Date(guess.getTime() - offsetMs(utc));
  return utc;
}

export function localDayWindow(day: string): { start: Date; end: Date; hours: number } {
  const start = zonedTimeToUtc(day);
  const end = zonedTimeToUtc(addDaysISO(day, 1));
  return { start, end, hours: (end.getTime() - start.getTime()) / 3_600_000 };
}

export function durationHours<T extends { durationMinutes?: number; ts: string }>(
  point: T,
  next?: T,
): number {
  if (point.durationMinutes && point.durationMinutes > 0) return point.durationMinutes / 60;
  if (next) {
    const h = (Date.parse(next.ts) - Date.parse(point.ts)) / 3_600_000;
    if (h > 0 && h <= 3) return h;
  }
  return 1;
}

export function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

export function sum(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => v != null && Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) : null;
}

export function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length);
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ma = mean(a) ?? 0;
  const mb = mean(b) ?? 0;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

export function coveragePct(received: number, expected: number): number | null {
  return expected > 0 ? Math.min(100, (received / expected) * 100) : null;
}

export function dailyPriceMetrics(points: PricePoint[], days: string[]): DailyPriceMetrics[] {
  const byDay = new Map<string, PricePoint[]>();
  for (const p of points) {
    const d = deliveryDay(p.ts);
    byDay.set(d, [...(byDay.get(d) ?? []), p]);
  }
  return days.map((day) => {
    const pts = (byDay.get(day) ?? []).sort((a, b) => a.ts.localeCompare(b.ts));
    const vals = pts.map((p) => p.price).filter(Number.isFinite);
    const peak = pts
      .filter((p) => {
        const parts = partsFor(p.ts);
        return parts.weekday <= 5 && parts.hour >= 8 && parts.hour < 20;
      })
      .map((p) => p.price);
    const off = pts
      .filter((p) => {
        const parts = partsFor(p.ts);
        return !(parts.weekday <= 5 && parts.hour >= 8 && parts.hour < 20);
      })
      .map((p) => p.price);
    const expectedHours = localDayWindow(day).hours;
    const availableHours = pts.reduce((acc, p, i) => acc + durationHours(p, pts[i + 1]), 0);
    const cov = coveragePct(availableHours, expectedHours);
    return {
      day,
      baseload: mean(vals),
      peakload: mean(peak),
      offpeak: mean(off),
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
      volatility: stddev(vals),
      negativeHours: vals.filter((v) => v < 0).length,
      availableHours,
      expectedHours,
      coveragePct: cov,
      partial: cov != null && cov < 99.5,
    };
  });
}

export function marketPriceSummary(
  zone: ZoneCode,
  points: PricePoint[],
  rsPoints: PricePoint[],
  days: string[],
  source: SourceStatus,
): MarketPriceSummary {
  const vals = points.map((p) => p.price).filter(Number.isFinite);
  const daily = dailyPriceMetrics(points, days);
  const base: DailyPriceMetrics = {
    day: "range",
    baseload: mean(vals),
    peakload: mean(
      points
        .filter((p) => {
          const parts = partsFor(p.ts);
          return parts.weekday <= 5 && parts.hour >= 8 && parts.hour < 20;
        })
        .map((p) => p.price),
    ),
    offpeak: mean(
      points
        .filter((p) => {
          const parts = partsFor(p.ts);
          return !(parts.weekday <= 5 && parts.hour >= 8 && parts.hour < 20);
        })
        .map((p) => p.price),
    ),
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    volatility: stddev(vals),
    negativeHours: vals.filter((v) => v < 0).length,
    availableHours: daily.reduce((a, d) => a + d.availableHours, 0),
    expectedHours: days.reduce((a, d) => a + localDayWindow(d).hours, 0),
    coveragePct: null,
    partial: false,
  };
  base.coveragePct = coveragePct(base.availableHours, base.expectedHours);

  const rsByTs = new Map(rsPoints.map((p) => [p.ts, p.price]));
  const spreads: number[] = [];
  const rsVals: number[] = [];
  const otherVals: number[] = [];
  for (const p of points) {
    const rs = rsByTs.get(p.ts);
    if (rs == null) continue;
    spreads.push(rs - p.price);
    rsVals.push(rs);
    otherVals.push(p.price);
  }
  const cheaper = spreads.filter((s) => s > 0).length;
  const moreExpensive = spreads.filter((s) => s < 0).length;
  return {
    zone,
    ...base,
    p10: percentile(vals, 0.1),
    p90: percentile(vals, 0.9),
    negativeSharePct: vals.length ? (base.negativeHours / vals.length) * 100 : null,
    avgSpreadVsRS: zone === "RS" ? 0 : mean(spreads),
    avgAbsSpreadVsRS: zone === "RS" ? 0 : mean(spreads.map(Math.abs)),
    cheaperThanRSPct:
      zone === "RS" ? null : spreads.length ? (cheaper / spreads.length) * 100 : null,
    moreExpensiveThanRSPct:
      zone === "RS" ? null : spreads.length ? (moreExpensive / spreads.length) * 100 : null,
    correlationVsRS: zone === "RS" ? 1 : pearson(rsVals, otherVals),
    source,
  };
}

export function aggregateHourly(points: TimedValue[]): TimedValue[] {
  const buckets = new Map<string, { weighted: number; hours: number }>();
  const sorted = points.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const parts = partsFor(p.ts);
    const hourKey = `${isoDate(parts.year, parts.month, parts.day)}T${String(parts.hour).padStart(2, "0")}:00`;
    const h = durationHours(p, sorted[i + 1]);
    const cur = buckets.get(hourKey) ?? { weighted: 0, hours: 0 };
    cur.weighted += p.value * h;
    cur.hours += h;
    buckets.set(hourKey, cur);
  }
  return [...buckets.entries()]
    .map(([key, v]) => ({
      ts: zonedTimeToUtc(key.slice(0, 10), Number(key.slice(11, 13))).toISOString(),
      value: v.hours ? v.weighted / v.hours : 0,
      durationMinutes: Math.round(v.hours * 60),
    }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function buildCountryPositionReport(args: {
  country: ZoneCode;
  days: string[];
  inboundByTs: Map<string, FlowPoint[]>;
  outboundByTs: Map<string, FlowPoint[]>;
  load: TimedValue[];
  generation: TimedValue[];
}): CountryPositionReport {
  const loadByDay = energyByDay(args.load, args.days);
  const genByDay = energyByDay(args.generation, args.days);
  const daily = args.days.map((day) => {
    const keys = new Set<string>();
    for (const k of args.inboundByTs.keys()) if (deliveryDay(k) === day) keys.add(k);
    for (const k of args.outboundByTs.keys()) if (deliveryDay(k) === day) keys.add(k);
    const sorted = [...keys].sort();
    let imports = 0;
    let exports = 0;
    let peakImport: number | null = null;
    let peakExport: number | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const ts = sorted[i];
      const inbound = (args.inboundByTs.get(ts) ?? []).reduce((a, p) => a + Math.max(0, p.mw), 0);
      const outbound = (args.outboundByTs.get(ts) ?? []).reduce((a, p) => a + Math.max(0, p.mw), 0);
      const h = durationHours(
        {
          ts,
          durationMinutes:
            args.inboundByTs.get(ts)?.[0]?.durationMinutes ??
            args.outboundByTs.get(ts)?.[0]?.durationMinutes,
        },
        sorted[i + 1] ? { ts: sorted[i + 1] } : undefined,
      );
      imports += inbound * h;
      exports += outbound * h;
      peakImport = peakImport == null ? inbound : Math.max(peakImport, inbound);
      peakExport = peakExport == null ? outbound : Math.max(peakExport, outbound);
    }
    const expected = localDayWindow(day).hours;
    const received = sorted.length
      ? sorted.reduce(
          (a, ts, i) =>
            a +
            durationHours(
              {
                ts,
                durationMinutes:
                  args.inboundByTs.get(ts)?.[0]?.durationMinutes ??
                  args.outboundByTs.get(ts)?.[0]?.durationMinutes,
              },
              sorted[i + 1] ? { ts: sorted[i + 1] } : undefined,
            ),
          0,
        )
      : 0;
    const cov = coveragePct(received, expected);
    const net = sorted.length ? imports - exports : null;
    const total = imports + exports;
    const tol = Math.max(10, 0.001 * total);
    const position: DailyCountryPosition["position"] =
      cov != null && cov < 75
        ? "Partial data"
        : net == null
          ? "Partial data"
          : net > tol
            ? "Net importer"
            : net < -tol
              ? "Net exporter"
              : "Approximately balanced";
    const loadMwh = loadByDay.get(day) ?? null;
    const genMwh = genByDay.get(day) ?? null;
    return {
      day,
      position,
      importsMwh: sorted.length ? imports : null,
      exportsMwh: sorted.length ? exports : null,
      netImportsMwh: net,
      avgNetMw: net != null ? net / Math.max(1, received || expected) : null,
      peakImportMw: peakImport,
      peakExportMw: peakExport,
      loadMwh,
      generationMwh: genMwh,
      generationMinusLoadMwh: genMwh != null && loadMwh != null ? genMwh - loadMwh : null,
      coveragePct: cov,
      partial: cov != null && cov < 99.5,
    };
  });
  return {
    country: args.country,
    daily,
    totals: {
      importsMwh: sum(daily.map((d) => d.importsMwh)),
      exportsMwh: sum(daily.map((d) => d.exportsMwh)),
      netImportsMwh: sum(daily.map((d) => d.netImportsMwh)),
      netImporterDays: daily.filter((d) => d.position === "Net importer").length,
      netExporterDays: daily.filter((d) => d.position === "Net exporter").length,
      peakImportMw: daily.some((d) => d.peakImportMw != null)
        ? Math.max(...daily.map((d) => d.peakImportMw ?? -Infinity))
        : null,
      peakExportMw: daily.some((d) => d.peakExportMw != null)
        ? Math.max(...daily.map((d) => d.peakExportMw ?? -Infinity))
        : null,
    },
    note: "Physical cross-border net-position proxy. This is not the official balancing-system imbalance position.",
  };
}

export function energyByDay(points: TimedValue[], days: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const allowed = new Set(days);
  const sorted = points.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const day = deliveryDay(p.ts);
    if (!allowed.has(day)) continue;
    out.set(day, (out.get(day) ?? 0) + p.value * durationHours(p, sorted[i + 1]));
  }
  return out;
}

export function borderFlowSummary(args: {
  from: ZoneCode;
  to: ZoneCode;
  forward: FlowPoint[];
  reverse: FlowPoint[];
  days: string[];
  source: SourceStatus;
}): BorderFlowSummary {
  const fwd = new Map(args.forward.map((p) => [p.ts, p]));
  const rev = new Map(args.reverse.map((p) => [p.ts, p]));
  const keys = [...new Set([...fwd.keys(), ...rev.keys()])].sort();
  let inbound = 0;
  let outbound = 0;
  let weightedAbs = 0;
  let totalHours = 0;
  let peakAbs = 0;
  let reversals = 0;
  let lastSign = 0;
  for (let i = 0; i < keys.length; i++) {
    const ts = keys[i];
    const forwardMw = Math.max(0, fwd.get(ts)?.mw ?? 0);
    const reverseMw = Math.max(0, rev.get(ts)?.mw ?? 0);
    const net = forwardMw - reverseMw;
    const h = durationHours(
      fwd.get(ts) ?? rev.get(ts) ?? { ts },
      keys[i + 1] ? { ts: keys[i + 1] } : undefined,
    );
    outbound += forwardMw * h;
    inbound += reverseMw * h;
    weightedAbs += Math.abs(net) * h;
    totalHours += h;
    peakAbs = Math.max(peakAbs, Math.abs(net));
    const sign = Math.sign(net);
    if (sign && lastSign && sign !== lastSign) reversals++;
    if (sign) lastSign = sign;
  }
  const ref =
    TECHNICAL_NTC_MW[`${args.from}_${args.to}`] ??
    TECHNICAL_NTC_MW[`${args.to}_${args.from}`] ??
    null;
  const expected = args.days.reduce((a, d) => a + localDayWindow(d).hours, 0);
  const avgAbs = totalHours ? weightedAbs / totalHours : null;
  return {
    border: `${args.from}-${args.to}`,
    from: args.from,
    to: args.to,
    dominantDirection:
      outbound >= inbound ? `${args.from} -> ${args.to}` : `${args.to} -> ${args.from}`,
    inboundGwh: inbound ? inbound / 1000 : null,
    outboundGwh: outbound ? outbound / 1000 : null,
    netGwh: keys.length ? (outbound - inbound) / 1000 : null,
    avgMw: avgAbs,
    peakMw: keys.length ? peakAbs : null,
    flowLoadFactorPct: avgAbs != null && peakAbs > 0 ? (avgAbs / peakAbs) * 100 : null,
    averageUtilizationPct: avgAbs != null && ref ? (avgAbs / ref) * 100 : null,
    peakUtilizationPct: peakAbs && ref ? (peakAbs / ref) * 100 : null,
    directionReversals: reversals,
    coveragePct: coveragePct(totalHours, expected),
    source: args.source,
  };
}

export function countryBorders(country: ZoneCode): Array<[ZoneCode, ZoneCode]> {
  return UNDIRECTED_BORDERS.filter(([a, b]) => a === country || b === country);
}
