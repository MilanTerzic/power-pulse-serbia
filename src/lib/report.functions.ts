import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  BORDERS,
  UNDIRECTED_BORDERS,
  IMPORT_ROUTES,
  EXPORT_ROUTES,
  ZONES,
  type ProductType,
  type ZoneCode,
} from "./markets";
import {
  fetchActualGenerationRange,
  fetchActualLoadRange,
  fetchDayAheadPricesRange,
  fetchExplicitAllocation,
  fetchPhysicalFlowsRange,
  type CapacityRow,
  type FetchResult,
} from "./entsoe.server";
import {
  REPORT_TZ,
  addDaysISO,
  aggregateHourly,
  borderFlowSummary,
  buildCountryPositionReport,
  calculatePresetRange,
  countryBorders,
  dailyPriceMetrics,
  deliveryDay,
  durationHours,
  expandDays,
  localDateISO,
  marketPriceSummary,
  mean,
  monthStartISO,
  previousMonthRange,
  sum,
  type BorderFlowSummary,
  type CapacityDirectionSummary,
  type CountryPositionReport,
  type DailyPriceMetrics,
  type FlowPoint,
  type MarketPriceSummary,
  type PricePoint,
  type ReportPreset,
  type RouteEconomicsRow,
  type SourceStatus,
  type TimedValue,
} from "./report.analytics";

export type TraderReportInput = {
  from: string;
  to: string;
};

type CoverageRow = {
  dataset: string;
  subject: string;
  source: SourceStatus;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  expectedIntervals: number;
  receivedIntervals: number;
  coveragePct: number | null;
  warning?: string;
};

type CapacityFetch = FetchResult<CapacityRow> & {
  day: string;
  from: ZoneCode;
  to: ZoneCode;
  product: ProductType;
};

const DA_ZONES: ZoneCode[] = ["RS", "HU", "RO", "BG", "HR", "SI", "ME", "MK", "AL"];
const REPORT_VERSION = "v1";

function validDate(v?: string): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function sourceOf<T>(r: PromiseSettledResult<FetchResult<T>>): SourceStatus {
  if (r.status === "rejected") return "error";
  return r.value.source === "demo" ? "demo" : r.value.source;
}

function pointsCoverage(
  dataset: string,
  subject: string,
  source: SourceStatus,
  points: Array<{ ts: string }>,
  expected: number,
  warning?: string,
): CoverageRow {
  const sorted = points.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  return {
    dataset,
    subject,
    source,
    firstTimestamp: sorted[0]?.ts ?? null,
    lastTimestamp: sorted[sorted.length - 1]?.ts ?? null,
    expectedIntervals: expected,
    receivedIntervals: sorted.length,
    coveragePct: expected > 0 ? Math.min(100, (sorted.length / expected) * 100) : null,
    warning,
  };
}

async function cachedReport<T>(key: string, ttlSeconds: number): Promise<T | null> {
  const { data } = await supabaseAdmin
    .from("api_cache")
    .select("payload, fetched_at, ttl_seconds")
    .eq("key", key)
    .maybeSingle();
  if (!data) return null;
  const age = (Date.now() - new Date(data.fetched_at as string).getTime()) / 1000;
  if (age > (data.ttl_seconds ?? ttlSeconds)) return null;
  return data.payload as T;
}

async function setCachedReport(key: string, payload: unknown, ttlSeconds: number) {
  await supabaseAdmin.from("api_cache").upsert({
    key,
    payload: payload as never,
    fetched_at: new Date().toISOString(),
    ttl_seconds: ttlSeconds,
  });
}

async function allSettledBounded<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 5,
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

function monthStartsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = monthStartISO(from);
  while (cur <= to) {
    out.push(cur);
    const [y, m] = cur.split("-").map(Number);
    cur = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  }
  return out;
}

function capacitySummary(
  rows: CapacityFetch[],
  product: "daily" | "monthly",
  expected: number,
): CapacityDirectionSummary[] {
  const grouped = new Map<string, CapacityFetch[]>();
  for (const r of rows.filter((r) => r.product === product)) {
    const key = `${r.from}_${r.to}_${product}`;
    grouped.set(key, [...(grouped.get(key) ?? []), r]);
  }
  return [...grouped.entries()].map(([key, list]) => {
    const valid = list.filter((r) => r.data.price_eur_mwh != null);
    const prices = valid.map((r) => r.data.price_eur_mwh!);
    const weightedRows = valid.filter((r) => r.data.allocated_mw != null);
    const weightedDen = weightedRows.reduce((acc, r) => acc + (r.data.allocated_mw ?? 0) * 24, 0);
    const weighted =
      weightedDen > 0
        ? weightedRows.reduce(
            (acc, r) => acc + (r.data.price_eur_mwh ?? 0) * (r.data.allocated_mw ?? 0) * 24,
            0,
          ) / weightedDen
        : null;
    const offered = list.map((r) => r.data.offered_mw).filter((v): v is number => v != null);
    const allocated = list.map((r) => r.data.allocated_mw).filter((v): v is number => v != null);
    const [from, to] = key.split("_") as [ZoneCode, ZoneCode];
    return {
      direction: `${from} -> ${to}`,
      product,
      averagePrice: mean(prices),
      volumeWeightedAveragePrice: weighted,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      validObservations: valid.length,
      expectedObservations: expected,
      coveragePct: expected > 0 ? Math.min(100, (valid.length / expected) * 100) : null,
      averageOfferedMw: mean(offered),
      averageAllocatedMw: mean(allocated),
      allocationRatioPct:
        mean(offered) && mean(allocated) ? (mean(allocated)! / mean(offered)!) * 100 : null,
      unit: "EUR/MWh when source unit is unambiguous",
      warning: list.find((r) => r.data.unit_warning)?.data.unit_warning,
      source: valid.some((r) => r.source === "live")
        ? "live"
        : valid.some((r) => r.source === "cache")
          ? "cache"
          : "empty",
    };
  });
}

function routeEconomics(args: {
  pricesByZone: Record<string, PricePoint[]>;
  capacity: CapacityFetch[];
  days: string[];
}): RouteEconomicsRow[] {
  const capByDirectionDay = new Map<string, number | null>();
  for (const c of args.capacity.filter((c) => c.product === "daily")) {
    capByDirectionDay.set(`${c.from}_${c.to}_${c.day}`, c.data.price_eur_mwh);
  }
  const rs = new Map((args.pricesByZone.RS ?? []).map((p) => [p.ts, p]));
  const actualSerbiaBorders = UNDIRECTED_BORDERS.filter(([a, b]) => a === "RS" || b === "RS")
    .map(([a, b]) => (a === "RS" ? b : a))
    .filter((z): z is ZoneCode => DA_ZONES.includes(z) && z !== "BA");

  const rows: RouteEconomicsRow[] = [];
  for (const neighbour of actualSerbiaBorders) {
    const neighbourPoints = new Map((args.pricesByZone[neighbour] ?? []).map((p) => [p.ts, p]));
    const common = [...rs.entries()]
      .filter(([ts]) => neighbourPoints.has(ts))
      .map(([ts, p]) => ({ ts, rs: p, n: neighbourPoints.get(ts)! }));
    const expected = args.days.reduce((acc, d) => acc + 24, 0);
    for (const direction of ["import", "export"] as const) {
      const margins = common.map((row) => {
        const day = deliveryDay(row.ts);
        const gross =
          direction === "import" ? row.rs.price - row.n.price : row.n.price - row.rs.price;
        const capKey = direction === "import" ? `${neighbour}_RS_${day}` : `RS_${neighbour}_${day}`;
        const cap = capByDirectionDay.get(capKey);
        const net = cap == null ? null : gross - cap;
        const hours = durationHours(row.rs);
        return { day, gross, net, hours };
      });
      const byDay = new Map<string, number>();
      for (const m of margins)
        byDay.set(m.day, (byDay.get(m.day) ?? 0) + (m.net ?? m.gross) * m.hours);
      const sortedDays = [...byDay.entries()].sort((a, b) => b[1] - a[1]);
      const netVals = margins.map((m) => m.net).filter((v): v is number => v != null);
      const capHours = margins.filter((m) => m.net != null).length;
      rows.push({
        route: direction === "import" ? `${neighbour} -> RS` : `RS -> ${neighbour}`,
        direction,
        avgGrossMargin: mean(margins.map((m) => m.gross)),
        avgNetMargin: mean(netVals),
        positiveGrossHours: margins.filter((m) => m.gross > 0).length,
        positiveNetHours: netVals.length ? netVals.filter((m) => m > 0).length : null,
        maxHourlyNetMargin: netVals.length ? Math.max(...netVals) : null,
        theoreticalGrossValuePerMw: sum(margins.map((m) => Math.max(m.gross, 0) * m.hours)),
        theoreticalNetValuePerMw: netVals.length
          ? sum(margins.map((m) => (m.net == null ? null : Math.max(m.net, 0) * m.hours)))
          : null,
        bestDeliveryDay: sortedDays[0]?.[0] ?? null,
        worstDeliveryDay: sortedDays[sortedDays.length - 1]?.[0] ?? null,
        priceCoveragePct: expected ? Math.min(100, (common.length / expected) * 100) : null,
        capacityCoveragePct: margins.length ? (capHours / margins.length) * 100 : null,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      (b.theoreticalNetValuePerMw ?? b.theoreticalGrossValuePerMw ?? -Infinity) -
      (a.theoreticalNetValuePerMw ?? a.theoreticalGrossValuePerMw ?? -Infinity),
  );
}

function deskSummary(report: {
  marketSummary: MarketPriceSummary[];
  rsDaily: DailyPriceMetrics[];
  rsPosition: CountryPositionReport;
  baPosition: CountryPositionReport;
  routeRows: RouteEconomicsRow[];
  capacityRows: CapacityDirectionSummary[];
  coverage: CoverageRow[];
  includesToday: boolean;
}): string[] {
  const out: string[] = [];
  const rs = report.marketSummary.find((m) => m.zone === "RS");
  const hu = report.marketSummary.find((m) => m.zone === "HU");
  if (rs?.baseload != null && hu?.baseload != null) {
    out.push(
      `SEEPEX averaged ${rs.baseload.toFixed(1)} EUR/MWh, ${(rs.baseload - hu.baseload).toFixed(1)} EUR/MWh versus HUPX during the selected period.`,
    );
  }
  const bestDay = report.rsDaily
    .filter((d) => d.baseload != null)
    .sort((a, b) => (b.baseload ?? 0) - (a.baseload ?? 0))[0];
  if (bestDay?.baseload != null)
    out.push(
      `The highest Serbian baseload occurred on ${bestDay.day} at ${bestDay.baseload.toFixed(1)} EUR/MWh.`,
    );
  if (rs && rs.negativeHours > 0)
    out.push(`Serbia recorded ${rs.negativeHours} negative-price hours.`);
  const rsPos = report.rsPosition.totals;
  if (rsPos.netImportsMwh != null) {
    out.push(
      `Serbia was a net importer on ${rsPos.netImporterDays} delivery days and a net exporter on ${rsPos.netExporterDays} delivery days, with ${(rsPos.netImportsMwh / 1000).toFixed(1)} GWh cumulative net imports.`,
    );
  }
  const baPos = report.baPosition.totals;
  if (baPos.netImportsMwh != null) {
    out.push(
      `Bosnia and Herzegovina recorded ${(baPos.netImportsMwh / 1000).toFixed(1)} GWh cumulative physical net imports.`,
    );
  }
  const route = report.routeRows.find((r) => r.avgGrossMargin != null);
  if (route?.avgGrossMargin != null)
    out.push(
      `${route.route} produced the strongest average gross ${route.direction} spread at ${route.avgGrossMargin.toFixed(1)} EUR/MWh.`,
    );
  const cap = report.capacityRows
    .filter((c) => c.product === "daily" && c.averagePrice != null)
    .sort((a, b) => (b.averagePrice ?? 0) - (a.averagePrice ?? 0))[0];
  if (cap?.averagePrice != null)
    out.push(
      `Daily capacity prices were highest on ${cap.direction} at ${cap.averagePrice.toFixed(2)} EUR/MWh.`,
    );
  const flowCov = mean(
    report.coverage.filter((c) => c.dataset === "Physical flows").map((c) => c.coveragePct),
  );
  if (flowCov != null)
    out.push(
      `Physical-flow data coverage is ${flowCov.toFixed(1)}%${report.includesToday ? "; today is still incomplete if future intervals are unpublished." : "."}`,
    );
  return out.slice(0, 8);
}

export const getTraderReport = createServerFn({ method: "GET" })
  .inputValidator((data: TraderReportInput) => data)
  .handler(async ({ data }) => {
    const safeFrom = validDate(data?.from)
      ? data.from
      : calculatePresetRange("last7", { from: localDateISO(), to: localDateISO() }).from;
    const safeTo = validDate(data?.to) && data.to >= safeFrom ? data.to : safeFrom;
    const days = expandDays(safeFrom, safeTo, 62);
    const today = localDateISO();
    const includesToday = safeFrom <= today && safeTo >= today;
    const ttl = includesToday ? 30 * 60 : 7 * 24 * 3600;
    const cacheKey = `trader_report:${REPORT_VERSION}:${safeFrom}:${safeTo}`;
    const cached = await cachedReport<TraderReport>(cacheKey, ttl);
    if (cached) return cached;

    const expectedHours = days.reduce((acc, d) => acc + 24, 0);

    const priceTasks = DA_ZONES.map(
      (zone) => () => fetchDayAheadPricesRange(zone, safeFrom, safeTo),
    );
    const priceSettled = await allSettledBounded(priceTasks, 5);
    const pricesByZone: Record<string, PricePoint[]> = {};
    const priceSources: Record<string, SourceStatus> = {};
    priceSettled.forEach((r, i) => {
      const zone = DA_ZONES[i];
      priceSources[zone] = sourceOf(r);
      pricesByZone[zone] = r.status === "fulfilled" ? r.value.data.points : [];
    });

    const flowPairs = BORDERS;
    const flowSettled = await allSettledBounded(
      flowPairs.map(
        ([from, to]) =>
          () =>
            fetchPhysicalFlowsRange(from, to, safeFrom, safeTo),
      ),
      5,
    );
    const flowsByDirection = new Map<string, { source: SourceStatus; points: FlowPoint[] }>();
    flowSettled.forEach((r, i) => {
      const [from, to] = flowPairs[i];
      flowsByDirection.set(`${from}_${to}`, {
        source: sourceOf(r),
        points: r.status === "fulfilled" ? r.value.data.points : [],
      });
    });

    const loadGenZones: ZoneCode[] = ["RS", "BA"];
    const loadSettled = await allSettledBounded(
      loadGenZones.map((zone) => () => fetchActualLoadRange(zone, safeFrom, safeTo)),
      2,
    );
    const genSettled = await allSettledBounded(
      loadGenZones.map((zone) => () => fetchActualGenerationRange(zone, safeFrom, safeTo)),
      2,
    );
    const loadByZone: Record<string, TimedValue[]> = {};
    const genByZone: Record<string, TimedValue[]> = {};
    loadGenZones.forEach((zone, i) => {
      loadByZone[zone] =
        loadSettled[i].status === "fulfilled"
          ? loadSettled[i].value.data.points.map((p) => ({
              ts: p.ts,
              value: p.load_mw,
              durationMinutes: p.durationMinutes,
            }))
          : [];
      genByZone[zone] =
        genSettled[i].status === "fulfilled"
          ? genSettled[i].value.data.points.map((p) => ({
              ts: p.ts,
              value: p.gen_mw,
              durationMinutes: p.durationMinutes,
            }))
          : [];
    });

    const dailyCapTasks: Array<() => Promise<CapacityFetch>> = [];
    for (const [from, to] of BORDERS) {
      for (const day of days) {
        dailyCapTasks.push(() =>
          fetchExplicitAllocation(from, to, "daily", day).then((r) => ({
            ...r,
            day,
            from,
            to,
            product: "daily" as const,
          })),
        );
      }
    }
    const monthlyDays = monthStartsBetween(safeFrom, safeTo);
    const monthlyCapTasks: Array<() => Promise<CapacityFetch>> = [];
    for (const [from, to] of BORDERS) {
      for (const day of monthlyDays) {
        monthlyCapTasks.push(() =>
          fetchExplicitAllocation(from, to, "monthly", day).then((r) => ({
            ...r,
            day,
            from,
            to,
            product: "monthly" as const,
          })),
        );
      }
    }
    const capSettled = await allSettledBounded([...dailyCapTasks, ...monthlyCapTasks], 5);
    const capacityRows = capSettled
      .filter((r): r is PromiseFulfilledResult<CapacityFetch> => r.status === "fulfilled")
      .map((r) => r.value);

    const dailyByZone = Object.fromEntries(
      DA_ZONES.map((zone) => [zone, dailyPriceMetrics(pricesByZone[zone] ?? [], days)]),
    ) as Record<ZoneCode, DailyPriceMetrics[]>;
    const marketSummary = DA_ZONES.map((zone) =>
      marketPriceSummary(
        zone,
        pricesByZone[zone] ?? [],
        pricesByZone.RS ?? [],
        days,
        priceSources[zone] ?? "empty",
      ),
    );

    function countryPosition(country: ZoneCode): CountryPositionReport {
      const inbound = new Map<string, FlowPoint[]>();
      const outbound = new Map<string, FlowPoint[]>();
      for (const [a, b] of countryBorders(country)) {
        const neighbour = a === country ? b : a;
        for (const p of flowsByDirection.get(`${neighbour}_${country}`)?.points ?? [])
          inbound.set(p.ts, [...(inbound.get(p.ts) ?? []), p]);
        for (const p of flowsByDirection.get(`${country}_${neighbour}`)?.points ?? [])
          outbound.set(p.ts, [...(outbound.get(p.ts) ?? []), p]);
      }
      return buildCountryPositionReport({
        country,
        days,
        inboundByTs: inbound,
        outboundByTs: outbound,
        load: loadByZone[country] ?? [],
        generation: genByZone[country] ?? [],
      });
    }

    const borderSummaries: BorderFlowSummary[] = UNDIRECTED_BORDERS.map(([from, to]) =>
      borderFlowSummary({
        from,
        to,
        forward: flowsByDirection.get(`${from}_${to}`)?.points ?? [],
        reverse: flowsByDirection.get(`${to}_${from}`)?.points ?? [],
        days,
        source:
          flowsByDirection.get(`${from}_${to}`)?.source === "live" ||
          flowsByDirection.get(`${to}_${from}`)?.source === "live"
            ? "live"
            : flowsByDirection.get(`${from}_${to}`)?.source === "cache" ||
                flowsByDirection.get(`${to}_${from}`)?.source === "cache"
              ? "cache"
              : "empty",
      }),
    );

    const capacityDaily = capacitySummary(capacityRows, "daily", days.length);
    const capacityMonthly = capacitySummary(capacityRows, "monthly", monthlyDays.length);
    const routeRows = routeEconomics({ pricesByZone, capacity: capacityRows, days });

    const tomorrow = addDaysISO(today, 1);
    const tomorrowPrices = await allSettledBounded(
      DA_ZONES.map((zone) => () => fetchDayAheadPricesRange(zone, tomorrow, tomorrow)),
      5,
    );
    const tomorrowByZone: Record<string, PricePoint[]> = {};
    tomorrowPrices.forEach((r, i) => {
      tomorrowByZone[DA_ZONES[i]] = r.status === "fulfilled" ? r.value.data.points : [];
    });
    const tomorrowRs = tomorrowByZone.RS ?? [];
    const tomorrowSummary = DA_ZONES.map((zone) => ({
      zone,
      avg: mean((tomorrowByZone[zone] ?? []).map((p) => p.price)),
    }))
      .filter((r): r is { zone: ZoneCode; avg: number } => r.avg != null)
      .sort((a, b) => a.avg - b.avg);

    const coverage: CoverageRow[] = [
      ...DA_ZONES.map((zone) =>
        pointsCoverage(
          "DA prices",
          zone,
          priceSources[zone] ?? "empty",
          pricesByZone[zone] ?? [],
          expectedHours,
        ),
      ),
      ...flowPairs.map(([from, to]) => {
        const row = flowsByDirection.get(`${from}_${to}`);
        return pointsCoverage(
          "Physical flows",
          `${from}->${to}`,
          row?.source ?? "empty",
          row?.points ?? [],
          expectedHours,
        );
      }),
      ...loadGenZones.map((zone, i) =>
        pointsCoverage(
          "Total load",
          zone,
          sourceOf(loadSettled[i]),
          loadByZone[zone] ?? [],
          expectedHours,
          loadByZone[zone]?.length ? undefined : "No load data",
        ),
      ),
      ...loadGenZones.map((zone, i) =>
        pointsCoverage(
          "Actual generation",
          zone,
          sourceOf(genSettled[i]),
          genByZone[zone] ?? [],
          expectedHours,
          genByZone[zone]?.length ? undefined : "No generation data",
        ),
      ),
      {
        dataset: "Daily capacity",
        subject: "All configured directions",
        source: capacityRows.some((r) => r.product === "daily" && r.source === "live")
          ? "live"
          : capacityRows.some((r) => r.product === "daily" && r.source === "cache")
            ? "cache"
            : "empty",
        firstTimestamp: days[0],
        lastTimestamp: days[days.length - 1],
        expectedIntervals: dailyCapTasks.length,
        receivedIntervals: capacityRows.filter(
          (r) => r.product === "daily" && r.data.price_eur_mwh != null,
        ).length,
        coveragePct: dailyCapTasks.length
          ? (capacityRows.filter((r) => r.product === "daily" && r.data.price_eur_mwh != null)
              .length /
              dailyCapTasks.length) *
            100
          : null,
      },
      {
        dataset: "Monthly capacity",
        subject: "Calendar-month observations",
        source: capacityRows.some((r) => r.product === "monthly" && r.source === "live")
          ? "live"
          : capacityRows.some((r) => r.product === "monthly" && r.source === "cache")
            ? "cache"
            : "empty",
        firstTimestamp: monthlyDays[0] ?? null,
        lastTimestamp: monthlyDays[monthlyDays.length - 1] ?? null,
        expectedIntervals: monthlyCapTasks.length,
        receivedIntervals: capacityRows.filter(
          (r) => r.product === "monthly" && r.data.price_eur_mwh != null,
        ).length,
        coveragePct: monthlyCapTasks.length
          ? (capacityRows.filter((r) => r.product === "monthly" && r.data.price_eur_mwh != null)
              .length /
              monthlyCapTasks.length) *
            100
          : null,
      },
    ];

    const report: TraderReport = {
      period: {
        from: safeFrom,
        to: safeTo,
        timezone: REPORT_TZ,
        isCurrentDayIncluded: includesToday,
      },
      coverage,
      prices: {
        hourlyByZone: pricesByZone,
        dailyByZone,
        marketSummary,
        rsHeatmap: pricesByZone.RS ?? [],
      },
      countryPositions: {
        RS: countryPosition("RS"),
        BA: countryPosition("BA"),
      },
      flows: {
        RS: borderSummaries.filter((b) => b.from === "RS" || b.to === "RS"),
        BA: borderSummaries.filter((b) => b.from === "BA" || b.to === "BA"),
        all: borderSummaries,
      },
      capacity: {
        daily: capacityDaily,
        monthly: capacityMonthly,
      },
      routeEconomics: {
        rows: routeRows,
        topImport: routeRows.filter((r) => r.direction === "import").slice(0, 5),
        topExport: routeRows.filter((r) => r.direction === "export").slice(0, 5),
        disclaimer:
          "Indicative market spread analysis before losses, fees, nomination constraints, profile risk, balancing costs, taxes and other transaction costs.",
      },
      tomorrowOutlook: tomorrowRs.length
        ? {
            day: tomorrow,
            seepexBaseload: mean(tomorrowRs.map((p) => p.price)),
            cheapestMarket: tomorrowSummary[0] ?? null,
            mostExpensiveMarket: tomorrowSummary[tomorrowSummary.length - 1] ?? null,
            serbiaRank: tomorrowSummary.findIndex((r) => r.zone === "RS") + 1 || null,
            serbiaVsHungary:
              tomorrowSummary.find((r) => r.zone === "RS")?.avg != null &&
              tomorrowSummary.find((r) => r.zone === "HU")?.avg != null
                ? tomorrowSummary.find((r) => r.zone === "RS")!.avg -
                  tomorrowSummary.find((r) => r.zone === "HU")!.avg
                : null,
            minSerbia: tomorrowRs.length
              ? tomorrowRs.slice().sort((a, b) => a.price - b.price)[0]
              : null,
            maxSerbia: tomorrowRs.length
              ? tomorrowRs.slice().sort((a, b) => b.price - a.price)[0]
              : null,
          }
        : undefined,
      generatedAt: new Date().toISOString(),
      presets: {
        last7: calculatePresetRange("last7", { from: safeFrom, to: safeTo }),
        last30: calculatePresetRange("last30", { from: safeFrom, to: safeTo }),
        currentMonth: calculatePresetRange("currentMonth", { from: safeFrom, to: safeTo }),
        previousMonth: previousMonthRange(),
      },
      sourceLists: {
        daZones: DA_ZONES,
        importRoutes: IMPORT_ROUTES,
        exportRoutes: EXPORT_ROUTES,
        zones: ZONES,
      },
    };
    report.summary = deskSummary({
      marketSummary,
      rsDaily: dailyByZone.RS,
      rsPosition: report.countryPositions.RS,
      baPosition: report.countryPositions.BA,
      routeRows,
      capacityRows: [...capacityDaily, ...capacityMonthly],
      coverage,
      includesToday,
    });

    await setCachedReport(cacheKey, report, ttl);
    return report;
  });

export type TraderReport = {
  period: { from: string; to: string; timezone: typeof REPORT_TZ; isCurrentDayIncluded: boolean };
  coverage: CoverageRow[];
  summary?: string[];
  prices: {
    hourlyByZone: Record<string, PricePoint[]>;
    dailyByZone: Record<ZoneCode, DailyPriceMetrics[]>;
    marketSummary: MarketPriceSummary[];
    rsHeatmap: PricePoint[];
  };
  countryPositions: { RS: CountryPositionReport; BA: CountryPositionReport };
  flows: { RS: BorderFlowSummary[]; BA: BorderFlowSummary[]; all: BorderFlowSummary[] };
  capacity: { daily: CapacityDirectionSummary[]; monthly: CapacityDirectionSummary[] };
  routeEconomics: {
    rows: RouteEconomicsRow[];
    topImport: RouteEconomicsRow[];
    topExport: RouteEconomicsRow[];
    disclaimer: string;
  };
  tomorrowOutlook?: {
    day: string;
    seepexBaseload: number | null;
    cheapestMarket: { zone: ZoneCode; avg: number } | null;
    mostExpensiveMarket: { zone: ZoneCode; avg: number } | null;
    serbiaRank: number | null;
    serbiaVsHungary: number | null;
    minSerbia: PricePoint | null;
    maxSerbia: PricePoint | null;
  };
  generatedAt: string;
  presets: Record<Exclude<ReportPreset, "custom">, { from: string; to: string }>;
  sourceLists: {
    daZones: ZoneCode[];
    importRoutes: typeof IMPORT_ROUTES;
    exportRoutes: typeof EXPORT_ROUTES;
    zones: typeof ZONES;
  };
};

export function reportToCsvSections(report: TraderReport) {
  return {
    market_price_summary: report.prices.marketSummary,
    daily_serbian_prices: report.prices.dailyByZone.RS,
    serbia_daily_position: report.countryPositions.RS.daily,
    bosnia_daily_position: report.countryPositions.BA.daily,
    border_flow_summary: report.flows.all,
    capacity_price_summary: [...report.capacity.daily, ...report.capacity.monthly],
    route_economics: report.routeEconomics.rows,
  };
}
