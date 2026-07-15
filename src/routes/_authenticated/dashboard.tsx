import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TopBar } from "@/components/top-bar";
import { KPI } from "@/components/kpi";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { DataBadge } from "@/components/data-badge";
import { getDashboardSnapshot } from "@/lib/data.functions";
import { daysInRange, useDateRange } from "@/lib/date-range";
import { fmtNum, fmtPrice } from "@/lib/format";
import { ZONES, type ZoneCode } from "@/lib/markets";
import {
  MARKET_PRESETS,
  PRICE_MARKET_LIST,
  PRICE_MARKETS,
  type PriceMarketCode,
} from "@/lib/price-markets";
import {
  averagePrice,
  buildMarketSignalSummary,
  buildRouteOpportunity,
  completenessForSeries,
  rankOpportunities,
  type PricePoint,
  type RouteOpportunity,
} from "@/lib/trading-calculations";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview — SEE Trading Desk" }] }),
  component: OverviewPage,
});

const ZONE_LINES = PRICE_MARKET_LIST.map((market) => ({
  key: market.code,
  color: market.chartColor,
  label: market.displayLabel,
}));

type ChartMode = "prices" | "spreads" | "heatmap";

function OverviewPage() {
  const fn = useServerFn(getDashboardSnapshot);
  const { range } = useDateRange();
  const [selectedZones, setSelectedZones] = useState<PriceMarketCode[] | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("prices");
  const [healthOpen, setHealthOpen] = useState(false);

  const q = useQuery({
    queryKey: ["snapshot", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const data = q.data;
  const dayList = useMemo(() => daysInRange(range.from, range.to), [range.from, range.to]);
  const multiDay = range.from !== range.to;
  const byZone = useMemo(() => data?.byZone ?? {}, [data?.byZone]);
  const rsPoints = (byZone.RS ?? []) as PricePoint[];
  const rsAvg = averagePrice(rsPoints);
  const previousAvg = data?.previousRS?.avg ?? null;
  const rsDelta = rsAvg != null && previousAvg != null ? rsAvg - previousAvg : null;

  const completeness = useMemo(() => {
    const rows = (data?.prices ?? []).map((price) => {
      const comp = completenessForSeries(price.data.points as PricePoint[], dayList);
      const status =
        comp.receivedIntervals === 0
          ? "Unavailable"
          : comp.completenessPct >= 98
            ? price.source === "cache"
              ? "Cached"
              : "Current"
            : "Partial";
      return {
        zone: price.zone as PriceMarketCode,
        label: PRICE_MARKETS[price.zone as PriceMarketCode]?.displayLabel ?? `${price.zone} DA`,
        status,
        source: price.source,
        reason: price.reason,
        completeness: comp,
        checkedAt: price.fetched_at,
      };
    });
    const current = rows.filter(
      (row) => row.status === "Current" || row.status === "Cached",
    ).length;
    return { rows, label: `${current}/${rows.length} markets current` };
  }, [data?.prices, dayList]);

  const allZones = ZONE_LINES.map((zone) => zone.key);
  const defaultZones = MARKET_PRESETS.core;
  const activeZones = selectedZones ?? defaultZones;

  const importRoutes = useMemo(
    () =>
      (data?.importRoutes ?? []).map((route) =>
        buildRouteOpportunity({
          from: route.from,
          to: route.to,
          label: route.label,
          sourcePoints: byZone[route.from] as PricePoint[] | undefined,
          destinationPoints: byZone.RS as PricePoint[] | undefined,
          capacity: route.cap,
          multiDay,
        }),
      ),
    [data?.importRoutes, byZone, multiDay],
  );
  const exportRoutes = useMemo(
    () =>
      (data?.exportRoutes ?? []).map((route) =>
        buildRouteOpportunity({
          from: route.from,
          to: route.to,
          label: route.label,
          sourcePoints: byZone.RS as PricePoint[] | undefined,
          destinationPoints: byZone[route.to] as PricePoint[] | undefined,
          capacity: route.cap,
          multiDay,
        }),
      ),
    [data?.exportRoutes, byZone, multiDay],
  );

  const bestImport = rankOpportunities(importRoutes)[0];
  const bestExport = rankOpportunities(exportRoutes)[0];
  const signal = buildMarketSignalSummary({ rsAvg, importRoutes, exportRoutes });
  const peak = peakOffPeak(rsPoints);
  const chart = useMemo(
    () => buildChartData(data?.prices ?? [], activeZones, chartMode),
    [data?.prices, activeZones, chartMode],
  );

  return (
    <>
      <TopBar
        title="Overview"
        subtitle="Serbia power-market signal, CBC-adjusted route checks and regional spreads."
        lastRefresh={data?.prices?.[0]?.fetched_at}
        onRefresh={() => q.refetch()}
        isRefreshing={q.isFetching}
        dataHealth={completeness.label}
        onDataHealthClick={() => setHealthOpen((value) => !value)}
      />
      <div className="space-y-5 p-4 md:p-6">
        {healthOpen && <DataHealthPanel rows={completeness.rows} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KPI
            label={`SEEPEX baseload · ${range.from === range.to ? range.from : `${range.from} → ${range.to}`}`}
            value={fmtPrice(rsAvg)}
            sub={
              rsPoints.length
                ? `${rsDelta == null ? "Previous day unavailable" : `${rsDelta >= 0 ? "+" : ""}${fmtPrice(rsDelta)} vs previous delivery day`} · ${completenessForSeries(rsPoints, dayList).receivedIntervals}/${completenessForSeries(rsPoints, dayList).expectedIntervals} intervals`
                : "No Serbia price data"
            }
            source={data?.prices?.find((price) => price.zone === "RS")?.source}
          />
          <KPI
            label="Peak / off-peak"
            value={peak.peak == null ? "N/A" : `${fmtPrice(peak.peak)} / ${fmtPrice(peak.offPeak)}`}
            sub={
              peak.spread == null
                ? "Peak 08-20 Europe/Belgrade, weekdays"
                : `Spread ${fmtPrice(peak.spread)} · peak 08-20 local weekdays`
            }
            accent="info"
          />
          <OpportunityKpi
            title="Best validated import route"
            route={bestImport}
            empty="No validated import opportunity"
          />
          <OpportunityKpi
            title="Best validated export route"
            route={bestExport}
            empty="No validated export opportunity"
          />
        </div>

        <Panel title="Market signal summary">
          <p className="text-sm leading-relaxed text-foreground/90">{signal}</p>
          {multiDay && (
            <p className="mt-2 text-xs text-warning">
              Multi-day selection: route tables show gross market spreads and indicative rows only
              unless CBC is matched day by day.
            </p>
          )}
        </Panel>

        <Panel
          title={`Regional price analysis — ${range.from === range.to ? range.from : `${range.from} → ${range.to}`}`}
          actions={
            <span className="text-[10px] text-muted-foreground">
              {chart.aggregation} · Europe/Belgrade local time
            </span>
          }
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {(["prices", "spreads", "heatmap"] as ChartMode[]).map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={chartMode === mode ? "default" : "outline"}
                  className="h-7 px-2 text-[11px] capitalize"
                  onClick={() => setChartMode(mode)}
                >
                  {mode === "spreads" ? "Spread vs Serbia" : mode}
                </Button>
              ))}
            </div>
            <ZoneSelector
              availableZones={allZones}
              activeZones={activeZones}
              setSelectedZones={setSelectedZones}
            />
          </div>
          {chartMode === "heatmap" ? (
            <SpreadHeatmap data={chart.data} zones={activeZones.filter((zone) => zone !== "RS")} />
          ) : (
            <div className="relative h-80">
              {!hasPlottedChartValues(chart.data, activeZones, chartMode) && (
                <div className="absolute inset-0 z-10 grid place-items-center rounded border border-border/50 bg-background/70 text-center">
                  <div>
                    <p className="text-sm font-semibold text-foreground">No spread data to plot</p>
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">
                      Serbia prices are loaded, but selected neighbouring market intervals are
                      missing or do not overlap for this delivery period.
                    </p>
                  </div>
                </div>
              )}
              <ResponsiveContainer>
                <LineChart data={chart.data} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="t"
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    minTickGap={28}
                  />
                  <YAxis
                    stroke="var(--color-muted-foreground)"
                    fontSize={11}
                    label={{
                      value: chartMode === "spreads" ? "Market - RS EUR/MWh" : "EUR/MWh",
                      angle: -90,
                      position: "insideLeft",
                      fill: "var(--color-muted-foreground)",
                      fontSize: 10,
                    }}
                  />
                  {chartMode === "spreads" && (
                    <ReferenceLine y={0} stroke="var(--color-muted-foreground)" />
                  )}
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                    }}
                    formatter={(value: number, name) => [
                      typeof value === "number" ? `${value.toFixed(2)} EUR/MWh` : "N/A",
                      name,
                    ]}
                  />
                  {ZONE_LINES.filter((zone) => activeZones.includes(zone.key))
                    .filter((zone) => chartMode === "prices" || zone.key !== "RS")
                    .map((zone) => (
                      <Line
                        key={zone.key}
                        dataKey={zone.key}
                        name={PRICE_MARKETS[zone.key].label}
                        stroke={zone.color}
                        dot={false}
                        strokeWidth={zone.key === "RS" ? 2.8 : 1.3}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {chartMode === "spreads" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Positive values mean the neighbouring market is above Serbia, indicating potential
              Serbia export direction before CBC cost. Negative values indicate import direction.
            </p>
          )}
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          <RouteOpportunityTable title="Import opportunities" routes={importRoutes} />
          <RouteOpportunityTable title="Export opportunities" routes={exportRoutes} />
        </div>
      </div>
    </>
  );
}

function OpportunityKpi({
  title,
  route,
  empty,
}: {
  title: string;
  route?: RouteOpportunity;
  empty: string;
}) {
  return (
    <KPI
      label={title}
      value={route ? route.label : empty}
      sub={
        route
          ? `${fmtPrice(route.netSpread)} net · CBC ${fmtPrice(route.capacityCost)} · ${route.profitableIntervals}/${route.totalIntervals} profitable`
          : "Validated routes require CBC price and capacity volume"
      }
      source={route?.source}
      accent={route ? "success" : "muted"}
    />
  );
}

function ZoneSelector({
  availableZones,
  activeZones,
  setSelectedZones,
}: {
  availableZones: PriceMarketCode[];
  activeZones: PriceMarketCode[];
  setSelectedZones: (zones: PriceMarketCode[] | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {ZONE_LINES.filter((zone) => availableZones.includes(zone.key)).map((zone) => {
        const on = activeZones.includes(zone.key);
        return (
          <button
            key={zone.key}
            type="button"
            onClick={() =>
              setSelectedZones(
                on
                  ? activeZones.filter((active) => active !== zone.key)
                  : [...activeZones, zone.key],
              )
            }
            className={`rounded border px-2 py-0.5 text-[11px] transition ${
              on
                ? "border-transparent text-background"
                : "border-border/60 bg-surface-2 text-muted-foreground"
            }`}
            style={on ? { background: zone.color } : undefined}
            title={zone.label}
          >
            {zone.key}
          </button>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelectedZones(MARKET_PRESETS.core)}
      >
        Core
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelectedZones(MARKET_PRESETS.directNeighbours)}
      >
        Direct neighbours
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelectedZones(MARKET_PRESETS.regional)}
      >
        Regional
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelectedZones(MARKET_PRESETS.europeanBenchmarks)}
      >
        Benchmarks
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelectedZones(MARKET_PRESETS.all)}
      >
        Select all
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelectedZones(MARKET_PRESETS.serbiaOnly)}
      >
        Only Serbia
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelectedZones([])}
      >
        Clear
      </Button>
    </div>
  );
}

function RouteOpportunityTable({ title, routes }: { title: string; routes: RouteOpportunity[] }) {
  const rows = [
    ...rankOpportunities(routes),
    ...routes
      .filter((route) => route.status === "indicative" && (route.grossSpread ?? 0) > 0)
      .sort((a, b) => (b.grossSpread ?? -Infinity) - (a.grossSpread ?? -Infinity)),
  ];
  return (
    <Panel title={title}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-1.5 text-left">Route</th>
              <th className="text-right">Gross</th>
              <th className="text-right">CBC</th>
              <th className="text-right">Net</th>
              <th className="text-right">Profitable</th>
              <th className="text-right">Capacity</th>
              <th className="text-right">1 MW margin</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                  No validated positive route for the selected delivery period.
                </td>
              </tr>
            ) : (
              rows.map((route) => (
                <tr key={route.label} className="border-t border-border/60">
                  <td className="py-1.5">
                    {ZONES[route.from].name} → {ZONES[route.to].name}
                  </td>
                  <td className="num text-right">{fmtMaybe(route.grossSpread)}</td>
                  <td className="num text-right text-muted-foreground">
                    {fmtMaybe(route.capacityCost)}
                  </td>
                  <td
                    className={`num text-right font-semibold ${route.netSpread != null && route.netSpread > 0 ? "text-success" : "text-muted-foreground"}`}
                  >
                    {fmtMaybe(route.netSpread)}
                  </td>
                  <td className="num text-right">
                    {route.profitableIntervals == null
                      ? "—"
                      : `${route.profitableIntervals}/${route.totalIntervals}`}
                  </td>
                  <td className="num text-right">
                    {route.availableCapacityMw == null
                      ? "—"
                      : `${route.availableCapacityMw.toFixed(0)} MW`}
                  </td>
                  <td className="num text-right">
                    {route.potentialMarginPerMw == null
                      ? "—"
                      : `€${route.potentialMarginPerMw.toFixed(0)}`}
                  </td>
                  <td className="text-right">
                    <OpportunityStatusBadge route={route} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function OpportunityStatusBadge({ route }: { route: RouteOpportunity }) {
  const cls =
    route.status === "validated"
      ? "border-success/30 bg-success/15 text-success"
      : route.status === "indicative"
        ? "border-warning/30 bg-warning/15 text-warning"
        : "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0 text-[10px] uppercase tracking-wider ${cls}`}
      title={route.reason}
    >
      {route.status === "indicative" ? (route.reason ?? "Indicative") : route.status}
    </span>
  );
}

function DataHealthPanel({
  rows,
}: {
  rows: Array<{
    zone: PriceMarketCode;
    label: string;
    status: string;
    source: string;
    reason?: string;
    completeness: ReturnType<typeof completenessForSeries>;
    checkedAt: string;
  }>;
}) {
  return (
    <Panel title="Data health">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-1.5 text-left">Dataset</th>
              <th>Status</th>
              <th>Completeness</th>
              <th>Checked</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.zone} className="border-t border-border/60">
                <td className="py-1.5" title={row.reason}>
                  {row.label}
                </td>
                <td>{row.status}</td>
                <td className="num">
                  {row.completeness.receivedIntervals}/{row.completeness.expectedIntervals}
                </td>
                <td className="num">
                  {new Date(row.checkedAt).toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Belgrade",
                  })}
                </td>
                <td>
                  <DataBadge source={row.source} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SpreadHeatmap({
  data,
  zones,
}: {
  data: Array<Record<string, number | string | null>>;
  zones: PriceMarketCode[];
}) {
  const visibleRows = zones.filter((zone) => data.some((row) => typeof row[zone] === "number"));
  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-[2px]"
        style={{
          gridTemplateColumns: `90px repeat(${Math.min(data.length, 48)}, minmax(34px, 1fr))`,
        }}
      >
        <div />
        {data.slice(0, 48).map((row) => (
          <div
            key={String(row.ts)}
            className="truncate text-center text-[10px] text-muted-foreground"
          >
            {row.t}
          </div>
        ))}
        {visibleRows.map((zone) => (
          <>
            <div key={`${zone}-label`} className="py-1 pr-2 text-xs">
              {zone}
            </div>
            {data.slice(0, 48).map((row) => {
              const value = row[zone];
              return (
                <div
                  key={`${zone}-${row.ts}`}
                  className="h-7 rounded-[3px]"
                  title={`${zone} - RS · ${row.t}: ${typeof value === "number" ? value.toFixed(2) : "N/A"} EUR/MWh`}
                  style={{
                    background:
                      typeof value === "number" ? spreadColor(value) : "var(--color-surface-2)",
                  }}
                />
              );
            })}
          </>
        ))}
      </div>
    </div>
  );
}

function spreadColor(value: number) {
  const magnitude = Math.min(Math.abs(value) / 80, 1);
  if (value >= 0)
    return `color-mix(in oklch, var(--color-success) ${20 + magnitude * 55}%, var(--color-surface-2))`;
  return `color-mix(in oklch, var(--color-destructive) ${20 + magnitude * 55}%, var(--color-surface-2))`;
}

function fmtMaybe(value: number | null | undefined) {
  return value == null ? "—" : fmtNum(value);
}

function peakOffPeak(points: PricePoint[]) {
  const peakValues: number[] = [];
  const offPeakValues: number[] = [];
  for (const point of points) {
    const date = new Date(point.ts);
    const weekday = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      weekday: "short",
    }).format(date);
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Belgrade",
        hour: "2-digit",
        hour12: false,
      }).format(date),
    );
    const isWeekend = weekday === "Sat" || weekday === "Sun";
    const isPeak = !isWeekend && hour >= 8 && hour < 20;
    (isPeak ? peakValues : offPeakValues).push(point.price);
  }
  const peak = average(peakValues);
  const offPeak = average(offPeakValues);
  return {
    peak,
    offPeak,
    spread: peak == null || offPeak == null ? null : peak - offPeak,
  };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function buildChartData(
  prices: Array<{ zone: string; data: { points: PricePoint[] } }>,
  activeZones: PriceMarketCode[],
  mode: ChartMode,
) {
  const byInterval = new Map<string, Record<string, number | string | null>>();
  const rsPoints = prices.find((price) => price.zone === "RS")?.data.points ?? [];
  const rsByInterval = new Map(rsPoints.map((point) => [point.ts, point.price]));
  for (const zone of prices) {
    if (!activeZones.includes(zone.zone as PriceMarketCode)) continue;
    for (const point of zone.data.points) {
      const key = point.ts;
      const row = byInterval.get(key) ?? {
        ts: point.ts,
        t: new Date(point.ts).toLocaleString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          ...(prices.some((price) => price.data.points.length > 30)
            ? { day: "2-digit", month: "short" }
            : {}),
          timeZone: "Europe/Belgrade",
        }),
      };
      const rs = rsByInterval.get(key);
      row[zone.zone] =
        mode === "spreads" || mode === "heatmap"
          ? rs == null
            ? null
            : point.price - rs
          : point.price;
      byInterval.set(key, row);
    }
  }
  const rows = [...byInterval.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  if (rows.length <= 1500) return { data: rows, aggregation: "interval-level data" };
  const stride = Math.ceil(rows.length / 750);
  const bucketed: typeof rows = [];
  for (let i = 0; i < rows.length; i += stride) {
    const bucket = rows.slice(i, i + stride);
    const selectedRows = new Set<(typeof rows)[number]>([bucket[0], bucket[bucket.length - 1]]);
    for (const zone of activeZones) {
      let minRow: (typeof rows)[number] | null = null;
      let maxRow: (typeof rows)[number] | null = null;
      for (const row of bucket) {
        const value = row[zone];
        if (typeof value !== "number") continue;
        if (minRow == null || value < (minRow[zone] as number)) minRow = row;
        if (maxRow == null || value > (maxRow[zone] as number)) maxRow = row;
      }
      if (minRow) selectedRows.add(minRow);
      if (maxRow) selectedRows.add(maxRow);
    }
    bucketed.push(...[...selectedRows].sort((a, b) => String(a.ts).localeCompare(String(b.ts))));
  }
  return {
    data: bucketed,
    aggregation: `min/max-preserving display buckets (${rows.length} -> ${bucketed.length})`,
  };
}

function localIntervalKey(ts: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function hasPlottedChartValues(
  rows: Record<string, number | string | null>[],
  activeZones: PriceMarketCode[],
  mode: ChartMode,
) {
  const zones = mode === "prices" ? activeZones : activeZones.filter((zone) => zone !== "RS");
  return rows.some((row) => zones.some((zone) => typeof row[zone] === "number"));
}
