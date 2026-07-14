import { EXPORT_ROUTES, IMPORT_ROUTES, ZONES, type ZoneCode } from "./markets";

export type OpportunityStatus = "validated" | "indicative" | "unavailable";

export interface PricePoint {
  ts: string;
  price: number;
  durationMinutes?: number;
}

export interface CapacityInput {
  data?: {
    price_eur_mwh: number | null;
    offered_mw: number | null;
    allocated_mw: number | null;
  };
  source?: string;
  fetched_at?: string;
  reason?: string;
}

export interface RouteOpportunity {
  from: ZoneCode;
  to: ZoneCode;
  label: string;
  grossSpread: number | null;
  capacityCost: number | null;
  netSpread: number | null;
  availableCapacityMw: number | null;
  profitableIntervals: number | null;
  totalIntervals: number | null;
  profitablePct: number | null;
  maxHourlyGross: number | null;
  maxHourlyNet: number | null;
  avgPositiveHourlyNet: number | null;
  grossMarginPerMw: number | null;
  potentialMarginPerMw: number | null;
  averageDailyNetMargin: number | null;
  status: OpportunityStatus;
  reason?: string;
  source?: string;
  sourceFetchedAt?: string;
  completenessPct: number | null;
  bestInterval?: string;
}

export interface DataCompleteness {
  receivedIntervals: number;
  expectedIntervals: number;
  completenessPct: number;
  missingIntervals: number;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
}

export const DIRECT_SERBIAN_IMPORT_ROUTES = IMPORT_ROUTES.filter((route) => route.to === "RS");
export const DIRECT_SERBIAN_EXPORT_ROUTES = EXPORT_ROUTES.filter((route) => route.from === "RS");

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function averagePrice(points: PricePoint[] | undefined): number | null {
  const values = (points ?? []).map((point) => point.price).filter(isNumber);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function calculateGrossSpread(
  sourcePrice: number | null,
  destinationPrice: number | null,
): number | null {
  return sourcePrice == null || destinationPrice == null ? null : destinationPrice - sourcePrice;
}

export function validCapacityCost(capacity: CapacityInput | undefined): number | null {
  const source = capacity?.source;
  const price = capacity?.data?.price_eur_mwh;
  if (!source || source === "empty" || source === "error") return null;
  return isNumber(price) ? price : null;
}

export function availableCapacity(capacity: CapacityInput | undefined): number | null {
  const allocated = capacity?.data?.allocated_mw;
  const offered = capacity?.data?.offered_mw;
  if (isNumber(allocated)) return allocated;
  if (isNumber(offered)) return offered;
  return null;
}

export function calculateNetSpread(
  grossSpread: number | null,
  capacityCost: number | null,
): number | null {
  return grossSpread == null || capacityCost == null ? null : grossSpread - capacityCost;
}

function matchedSpreads(source: PricePoint[] | undefined, destination: PricePoint[] | undefined) {
  const byDestination = new Map((destination ?? []).map((point) => [point.ts, point]));
  return (source ?? [])
    .map((sourcePoint) => {
      const destinationPoint = byDestination.get(sourcePoint.ts);
      if (!destinationPoint) return null;
      const gross = calculateGrossSpread(sourcePoint.price, destinationPoint.price);
      return gross == null
        ? null
        : {
            ts: sourcePoint.ts,
            gross,
            durationHours:
              Math.min(sourcePoint.durationMinutes ?? 60, destinationPoint.durationMinutes ?? 60) /
              60,
          };
    })
    .filter((point): point is { ts: string; gross: number; durationHours: number } => !!point);
}

export function belgradeOffsetMinutes(date: Date): number {
  const part =
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      timeZoneName: "shortOffset",
    })
      .formatToParts(date)
      .find((piece) => piece.type === "timeZoneName")?.value ?? "GMT+1";
  const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(part);
  if (!match) return 60;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function belgradeDayUtc(dayISO: string) {
  const utcMidnight = Date.parse(`${dayISO}T00:00:00Z`);
  const offset = belgradeOffsetMinutes(new Date(utcMidnight));
  return new Date(utcMidnight - offset * 60_000);
}

export function expectedIntervalsForBelgradeDay(dayISO: string, stepMinutes = 60): number {
  const start = belgradeDayUtc(dayISO);
  const nextDay = new Date(`${dayISO}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const end = belgradeDayUtc(nextDay.toISOString().slice(0, 10));
  return Math.round((end.getTime() - start.getTime()) / (stepMinutes * 60_000));
}

export function completenessForSeries(
  points: PricePoint[] | undefined,
  days: string[],
): DataCompleteness {
  const receivedIntervals = points?.length ?? 0;
  const stepMinutes =
    points?.find((point) => isNumber(point.durationMinutes) && point.durationMinutes > 0)
      ?.durationMinutes ?? 60;
  const expectedIntervals = days.reduce(
    (sum, day) => sum + expectedIntervalsForBelgradeDay(day, stepMinutes),
    0,
  );
  const timestamps = (points ?? []).map((point) => point.ts).sort();
  const completenessPct = expectedIntervals
    ? Math.min(100, (receivedIntervals / expectedIntervals) * 100)
    : 0;
  return {
    receivedIntervals,
    expectedIntervals,
    completenessPct,
    missingIntervals: Math.max(0, expectedIntervals - receivedIntervals),
    earliestTimestamp: timestamps[0] ?? null,
    latestTimestamp: timestamps[timestamps.length - 1] ?? null,
  };
}

export function buildRouteOpportunity({
  from,
  to,
  label,
  sourcePoints,
  destinationPoints,
  capacity,
  multiDay,
}: {
  from: ZoneCode;
  to: ZoneCode;
  label: string;
  sourcePoints: PricePoint[] | undefined;
  destinationPoints: PricePoint[] | undefined;
  capacity?: CapacityInput;
  multiDay: boolean;
}): RouteOpportunity {
  const grossSpread = calculateGrossSpread(
    averagePrice(sourcePoints),
    averagePrice(destinationPoints),
  );
  const spreads = matchedSpreads(sourcePoints, destinationPoints);
  const totalIntervals = spreads.length || null;
  const source = capacity?.source;
  const capCost = multiDay ? null : validCapacityCost(capacity);
  const capacityMw = multiDay ? null : availableCapacity(capacity);
  const hasValidCapacity = capCost != null && capacityMw != null;
  const netSpread = hasValidCapacity ? calculateNetSpread(grossSpread, capCost) : null;
  const nets = hasValidCapacity
    ? spreads.map((spread) => ({ ...spread, net: spread.gross - capCost }))
    : [];
  const profitable = nets.filter((spread) => spread.net > 0);
  const maxHourlyGross = spreads.length ? Math.max(...spreads.map((spread) => spread.gross)) : null;
  const maxHourlyNet = nets.length ? Math.max(...nets.map((spread) => spread.net)) : null;
  const best = nets.slice().sort((a, b) => b.net - a.net)[0];
  const avgPositiveHourlyNet = profitable.length
    ? profitable.reduce((sum, spread) => sum + spread.net, 0) / profitable.length
    : null;
  const totalHours = spreads.reduce((sum, spread) => sum + spread.durationHours, 0);
  const grossMarginPerMw =
    grossSpread == null || totalHours === 0 ? null : grossSpread * totalHours;
  const potentialMarginPerMw =
    netSpread == null || totalHours === 0 ? null : netSpread * totalHours;

  let status: OpportunityStatus = "validated";
  let reason: string | undefined;
  if (grossSpread == null || totalIntervals == null) {
    status = "unavailable";
    reason = "Market price data unavailable.";
  } else if (multiDay) {
    status = "indicative";
    reason =
      "Multi-day view shows gross spread only; CBC-adjusted net requires matched daily capacity.";
  } else if (!source || source === "empty" || capCost == null) {
    status = "indicative";
    reason = "CBC unavailable.";
  } else if (capacityMw == null) {
    status = "indicative";
    reason = "Capacity volume unavailable.";
  }

  return {
    from,
    to,
    label,
    grossSpread,
    capacityCost: capCost,
    netSpread,
    availableCapacityMw: capacityMw,
    profitableIntervals: hasValidCapacity ? profitable.length : null,
    totalIntervals,
    profitablePct:
      hasValidCapacity && totalIntervals ? (profitable.length / totalIntervals) * 100 : null,
    maxHourlyGross,
    maxHourlyNet,
    avgPositiveHourlyNet,
    grossMarginPerMw,
    potentialMarginPerMw,
    averageDailyNetMargin: potentialMarginPerMw,
    status,
    reason,
    source,
    sourceFetchedAt: capacity?.fetched_at,
    completenessPct: null,
    bestInterval: best?.ts,
  };
}

export function rankOpportunities(routes: RouteOpportunity[]) {
  return routes
    .filter(
      (route) => route.status === "validated" && route.netSpread != null && route.netSpread > 0,
    )
    .sort((a, b) => (b.netSpread ?? -Infinity) - (a.netSpread ?? -Infinity));
}

export function buildMarketSignalSummary({
  rsAvg,
  importRoutes,
  exportRoutes,
}: {
  rsAvg: number | null;
  importRoutes: RouteOpportunity[];
  exportRoutes: RouteOpportunity[];
}) {
  if (rsAvg == null) return "Serbian day-ahead price is unavailable for the selected period.";
  const bestImport = rankOpportunities(importRoutes)[0];
  const bestExport = rankOpportunities(exportRoutes)[0];
  if (bestImport) {
    return `${ZONES.RS.name} trades above ${ZONES[bestImport.from].name} on a baseload basis. After validated CBC cost of ${bestImport.capacityCost?.toFixed(2)} EUR/MWh, ${bestImport.label} shows ${bestImport.netSpread?.toFixed(2)} EUR/MWh net spread.`;
  }
  if (bestExport) {
    return `${ZONES.RS.name} trades below ${ZONES[bestExport.to].name} on a baseload basis. After validated CBC cost of ${bestExport.capacityCost?.toFixed(2)} EUR/MWh, ${bestExport.label} shows ${bestExport.netSpread?.toFixed(2)} EUR/MWh net spread.`;
  }
  const indicative = [...importRoutes, ...exportRoutes].find(
    (route) => route.status === "indicative" && (route.grossSpread ?? 0) > 0,
  );
  if (indicative) {
    return `${indicative.label} has a positive gross market spread, but CBC-adjusted economics cannot be validated because ${indicative.reason?.toLowerCase() ?? "capacity data is incomplete"}`;
  }
  return "No validated positive import or export opportunity is available for the selected delivery period.";
}
