import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowRight, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/components/chart-card";
import { DataBadge } from "@/components/data-badge";
import { DataStatusBadge } from "@/components/data-status";
import { KPI } from "@/components/kpi";
import { DataUnavailableState, PageLoadingSkeleton } from "@/components/loading-states";
import { Panel } from "@/components/panel";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { getDashboardSnapshot, getFlowAnalytics } from "@/lib/data.functions";
import { daysInRange, useDateRange } from "@/lib/date-range";
import { downloadCSV, fmtNum, fmtPrice } from "@/lib/format";
import { ZONES } from "@/lib/markets";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview - CEA Power Dashboard" }] }),
  component: OverviewPage,
});

const ZONE_LINES: Array<{ key: string; color: string }> = [
  { key: "RS", color: "#009b8f" },
  { key: "HU", color: "#3c7fb1" },
  { key: "RO", color: "#c77a16" },
  { key: "BG", color: "#7c6fc6" },
  { key: "HR", color: "#33936f" },
  { key: "BA", color: "#c94a5c" },
  { key: "ME", color: "#1d9db4" },
  { key: "MK", color: "#b8901e" },
  { key: "AL", color: "#a657b8" },
  { key: "SI", color: "#667475" },
];

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function OverviewPage() {
  const snapshotFn = useServerFn(getDashboardSnapshot);
  const flowFn = useServerFn(getFlowAnalytics);
  const { range } = useDateRange();

  const q = useQuery({
    queryKey: ["snapshot", range.from, range.to],
    queryFn: () => snapshotFn({ data: { from: range.from, to: range.to } }),
  });
  const flowQ = useQuery({
    queryKey: ["overview-flow-analytics", range.from, range.to],
    queryFn: () => flowFn({ data: { from: range.from, to: range.to } }),
  });

  const data = q.data;
  const rsPoints = data?.byZone?.RS ?? [];
  const rsAvg = avg(rsPoints.map((point) => point.price));
  const zoneAvg = (zone: string): number | null => {
    const points = data?.byZone?.[zone] ?? [];
    return avg(points.map((point) => point.price));
  };

  const neighbourAvgs = (data?.prices ?? [])
    .filter((price) => price.zone !== "RS" && price.data.points.length > 0)
    .map((price) => ({
      zone: price.zone,
      avg: avg(price.data.points.map((point) => point.price)) ?? 0,
      source: price.source,
    }));
  const lowest = neighbourAvgs.slice().sort((a, b) => a.avg - b.avg)[0];
  const highest = neighbourAvgs.slice().sort((a, b) => b.avg - a.avg)[0];
  const huAvg = zoneAvg("HU");

  const opportunities = (data?.importRoutes ?? [])
    .map((route) => {
      const sourceAvg = zoneAvg(route.from);
      if (rsAvg == null || sourceAvg == null) return null;
      const gross = rsAvg - sourceAvg;
      const cap = route.cap.data.price_eur_mwh ?? 0;
      return {
        label: route.label,
        from: route.from,
        to: route.to,
        gross,
        cap,
        net: gross - cap,
        source: route.cap.source,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.net - a.net);

  const exportOpps = (data?.exportRoutes ?? [])
    .map((route) => {
      const destinationAvg = zoneAvg(route.to);
      if (rsAvg == null || destinationAvg == null) return null;
      const gross = destinationAvg - rsAvg;
      const cap = route.cap.data.price_eur_mwh ?? 0;
      return {
        label: route.label,
        from: route.from,
        to: route.to,
        gross,
        cap,
        net: gross - cap,
        source: route.cap.source,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.net - a.net);

  const multiDay = range.from !== range.to;
  const chartData = useMemo(() => {
    const tsIndex = new Map<string, Record<string, number | string>>();
    for (const zone of data?.prices ?? []) {
      for (const point of zone.data.points) {
        const row = tsIndex.get(point.ts) ?? {
          ts: point.ts,
          t: new Date(point.ts).toLocaleString("en-GB", {
            hour: "2-digit",
            ...(multiDay ? { day: "2-digit", month: "short" } : {}),
            timeZone: "Europe/Belgrade",
          }),
        };
        row[zone.zone] = point.price;
        tsIndex.set(point.ts, row);
      }
    }
    return [...tsIndex.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }, [data?.prices, multiDay]);

  const availableZones = useMemo(
    () =>
      ZONE_LINES.map((zone) => zone.key).filter((key) =>
        (data?.prices ?? []).some((price) => price.zone === key && price.data.points.length > 0),
      ),
    [data?.prices],
  );
  const [selectedZones, setSelectedZones] = useState<string[] | null>(null);
  const activeZones = selectedZones ?? availableZones;
  const toggleZone = (zone: string) => {
    const base = selectedZones ?? availableZones;
    const next = base.includes(zone) ? base.filter((item) => item !== zone) : [...base, zone];
    setSelectedZones(next);
  };
  const displayChartData = useMemo(() => {
    const maxPoints = 1500;
    if (chartData.length <= maxPoints) return chartData;
    const stride = Math.ceil(chartData.length / maxPoints);
    return chartData.filter((_, index) => index % stride === 0);
  }, [chartData]);

  const netByHour = useMemo(() => {
    const map = new Map<string, { imports: number; exports: number }>();
    for (const border of flowQ.data?.borders ?? []) {
      for (const hour of border.hourly ?? []) {
        const current = map.get(hour.ts) ?? { imports: 0, exports: 0 };
        current.imports += hour.imp_mw;
        current.exports += hour.exp_mw;
        map.set(hour.ts, current);
      }
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ts, value]) => ({
        ts,
        t: new Date(ts).toLocaleString("en-GB", {
          hour: "2-digit",
          ...(multiDay ? { day: "2-digit", month: "short" } : {}),
          timeZone: "Europe/Belgrade",
        }),
        net: Math.round(value.imports - value.exports),
        imports: Math.round(value.imports),
        exports: Math.round(value.exports),
      }));
  }, [flowQ.data?.borders, multiDay]);

  const expectedPriceHours = daysInRange(range.from, range.to).length * 24;
  const receivedPriceHours = rsPoints.length;
  const priceCoverage = expectedPriceHours ? (receivedPriceHours / expectedPriceHours) * 100 : null;
  const negativeHours = rsPoints.filter((point) => point.price < 0).length;
  const rsMin = rsPoints.length ? Math.min(...rsPoints.map((point) => point.price)) : null;
  const rsMax = rsPoints.length ? Math.max(...rsPoints.map((point) => point.price)) : null;
  const avgNetPosition = netByHour.length ? avg(netByHour.map((row) => row.net)) : null;

  const signalCards = [
    rsAvg != null && huAvg != null
      ? {
          title: rsAvg > huAvg ? "Serbia premium versus Hungary" : "Serbia discount versus Hungary",
          metric: `${fmtPrice(rsAvg - huAvg)} spread`,
          impact: Math.abs(rsAvg - huAvg) > 10 ? "High" : "Medium",
          description: `SEEPEX traded ${Math.abs(rsAvg - huAvg).toFixed(1)} EUR/MWh ${rsAvg > huAvg ? "above" : "below"} HUPX over the selected period.`,
          to: "/prices",
        }
      : null,
    opportunities[0]
      ? {
          title: "Best import route identified",
          metric: `${opportunities[0].label} ${fmtPrice(opportunities[0].net)}`,
          impact: opportunities[0].net > 10 ? "High" : "Medium",
          description: `Capacity-adjusted import economics are strongest on ${opportunities[0].label}.`,
          to: "/spreads",
        }
      : null,
    avgNetPosition != null
      ? {
          title: avgNetPosition >= 0 ? "Serbia net importer" : "Serbia net exporter",
          metric: `${fmtNum(avgNetPosition, 0)} MW average`,
          impact: Math.abs(avgNetPosition) > 250 ? "High" : "Medium",
          description:
            "Physical-flow data shows Serbia's cross-border position during the selected period.",
          to: "/flows",
        }
      : null,
    negativeHours
      ? {
          title: "Negative-price hours observed",
          metric: `${negativeHours} hours`,
          impact: negativeHours > 5 ? "High" : "Medium",
          description:
            "Negative prices indicate periods where flexibility and curtailment assumptions matter.",
          to: "/prices",
        }
      : null,
  ]
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 3);

  return (
    <>
      <TopBar
        title="Serbia Electricity Market Pulse"
        subtitle="What is happening in the Serbian electricity market, and why it matters for trading, flexibility and system position."
        lastRefresh={data?.prices?.[0]?.fetched_at}
        onRefresh={() => {
          q.refetch();
          flowQ.refetch();
        }}
      />
      <div className="space-y-5 p-4 sm:p-6">
        {q.isLoading ? (
          <PageLoadingSkeleton />
        ) : q.isError ? (
          <DataUnavailableState
            title="Live market snapshot unavailable"
            description="We could not retrieve the latest price and route data. Try again or open a detailed module with cached data."
            onRetry={() => q.refetch()}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <KPI
                label="SEEPEX baseload"
                value={fmtPrice(rsAvg)}
                sub={rsPoints.length ? `${receivedPriceHours} hourly prices` : "Data unavailable"}
                source={data?.prices?.find((price) => price.zone === "RS")?.source}
              />
              <KPI
                label="RS price range"
                value={
                  rsMin != null && rsMax != null
                    ? `${fmtPrice(rsMin)}-${fmtPrice(rsMax)}`
                    : "Data unavailable"
                }
                sub="Minimum to maximum hourly DA price"
                accent="info"
              />
              <KPI
                label="Negative-price hours"
                value={negativeHours}
                sub="Hourly SEEPEX intervals below zero"
                accent={negativeHours > 0 ? "warning" : "success"}
              />
              <KPI
                label="Cheapest neighbour"
                value={lowest ? `${lowest.zone} - ${fmtPrice(lowest.avg)}` : "Data unavailable"}
                accent="success"
                source={lowest?.source}
              />
              <KPI
                label="Best net import route"
                value={opportunities[0] ? opportunities[0].label : "Data unavailable"}
                sub={opportunities[0] ? `${fmtPrice(opportunities[0].net)} capacity-adjusted` : ""}
                accent={opportunities[0]?.net > 0 ? "success" : "muted"}
                source={opportunities[0]?.source}
              />
              <KPI
                label="Serbia net position"
                value={
                  avgNetPosition == null ? "Data unavailable" : `${fmtNum(avgNetPosition, 0)} MW`
                }
                sub={
                  avgNetPosition == null
                    ? "Physical-flow data unavailable"
                    : avgNetPosition >= 0
                      ? "Average net import proxy"
                      : "Average net export proxy"
                }
                accent={avgNetPosition == null ? "muted" : avgNetPosition >= 0 ? "info" : "success"}
              />
            </div>

            <section>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    What changed?
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Data-driven signals from the selected period. No static statements are shown.
                  </p>
                </div>
                <DataStatusBadge
                  status={priceCoverage != null && priceCoverage >= 99 ? "complete" : "partial"}
                  label={
                    priceCoverage == null
                      ? "Coverage unavailable"
                      : `${priceCoverage.toFixed(1)}% price coverage`
                  }
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {signalCards.map((signal) => (
                  <Link
                    key={signal.title}
                    to={signal.to}
                    className="rounded-xl border border-border bg-surface p-4 transition hover:border-primary/40 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold text-foreground">{signal.title}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${signal.impact === "High" ? "bg-warning/15 text-warning" : "bg-info/15 text-info"}`}
                      >
                        {signal.impact}
                      </span>
                    </div>
                    <div className="mt-3 num text-xl font-semibold text-primary">
                      {signal.metric}
                    </div>
                    <p className="mt-2 text-sm leading-5 text-muted-foreground">
                      {signal.description}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                      Open analysis <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                ))}
              </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-[1.35fr_0.9fr]">
              <ChartCard
                title="Regional day-ahead electricity prices"
                subtitle={`Selected period ${range.from} to ${range.to}. Serbia is emphasised as the reference market.`}
                methodology="Each line is one market's day-ahead auction clearing price by interval. Serbia is shown with the strongest line weight."
                source="ENTSO-E Transparency Platform"
                updated={
                  data?.prices?.[0]?.fetched_at
                    ? new Date(data.prices[0].fetched_at).toLocaleString("en-GB")
                    : undefined
                }
                status={priceCoverage != null && priceCoverage >= 99 ? "complete" : "partial"}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => downloadCSV("overview-regional-prices.csv", chartData as never)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    CSV
                  </Button>
                }
              >
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Markets:
                  </span>
                  {ZONE_LINES.filter((zone) => availableZones.includes(zone.key)).map((zone) => {
                    const on = activeZones.includes(zone.key);
                    return (
                      <button
                        key={zone.key}
                        type="button"
                        onClick={() => toggleZone(zone.key)}
                        className={`rounded border px-2 py-1 text-[11px] transition ${on ? "border-transparent text-white" : "border-border bg-surface-2 text-muted-foreground"}`}
                        style={on ? { background: zone.color } : undefined}
                      >
                        {zone.key}
                      </button>
                    );
                  })}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-2 h-7 text-[11px]"
                    onClick={() => setSelectedZones(null)}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={() => setSelectedZones(["RS"])}
                  >
                    Only RS
                  </Button>
                </div>
                <div className="h-80">
                  <ResponsiveContainer>
                    <LineChart
                      data={displayChartData}
                      margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                    >
                      <CartesianGrid
                        stroke="var(--color-grid)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="t"
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        minTickGap={28}
                      />
                      <YAxis
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        unit=" EUR"
                        label={{
                          value: "Price, EUR/MWh",
                          angle: -90,
                          position: "insideLeft",
                          fill: "var(--color-muted-foreground)",
                          fontSize: 10,
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--color-surface)",
                          border: "1px solid var(--color-border)",
                        }}
                        formatter={(value: number) => [
                          `${typeof value === "number" ? value.toFixed(2) : value} EUR/MWh`,
                          "",
                        ]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {ZONE_LINES.filter((zone) => activeZones.includes(zone.key)).map((zone) => (
                        <Line
                          key={zone.key}
                          dataKey={zone.key}
                          stroke={zone.color}
                          dot={false}
                          strokeWidth={zone.key === "RS" ? 2.8 : 1.25}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <ChartCard
                title="Serbia import/export position"
                subtitle="Positive bars indicate net imports; negative bars indicate net exports."
                methodology="Net position is calculated from physical-flow imports minus exports across configured Serbian borders. It is not an official balancing-system imbalance."
                source="ENTSO-E physical flows"
                updated={
                  flowQ.data?.fetched_at
                    ? new Date(flowQ.data.fetched_at).toLocaleString("en-GB")
                    : undefined
                }
                status={netByHour.length ? "complete" : "unavailable"}
              >
                <div className="h-80">
                  {netByHour.length ? (
                    <ResponsiveContainer>
                      <BarChart data={netByHour} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                        <CartesianGrid
                          stroke="var(--color-grid)"
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="t"
                          stroke="var(--color-muted-foreground)"
                          fontSize={11}
                          minTickGap={28}
                        />
                        <YAxis
                          stroke="var(--color-muted-foreground)"
                          fontSize={11}
                          unit=" MW"
                          label={{
                            value: "Cross-border flow, MW",
                            angle: -90,
                            position: "insideLeft",
                            fill: "var(--color-muted-foreground)",
                            fontSize: 10,
                          }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-border)",
                          }}
                          formatter={(value: number) => [`${fmtNum(value, 0)} MW`, "Net imports"]}
                        />
                        <ReferenceLine y={0} stroke="var(--color-muted-foreground)" />
                        <Bar dataKey="net" name="Net imports">
                          {netByHour.map((entry) => (
                            <Cell
                              key={entry.ts}
                              fill={entry.net >= 0 ? "var(--color-info)" : "var(--color-success)"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-muted-foreground">
                      Physical-flow data unavailable for the selected period.
                    </div>
                  )}
                </div>
              </ChartCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <OpportunityTable title="Top import opportunities" rows={opportunities.slice(0, 3)} />
              <OpportunityTable title="Top export opportunities" rows={exportOpps.slice(0, 3)} />
            </div>

            <Panel title="Latest intelligence">
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  {
                    label: "CEA Report",
                    to: "/report",
                    text: "Open the integrated trading report.",
                  },
                  {
                    label: "Market brief",
                    to: "/forecast",
                    text: "Review near-term market and weather outlook.",
                  },
                  {
                    label: "Capacity resale",
                    to: "/cbc",
                    text: "Inspect CBC resale PnL and scenarios.",
                  },
                ].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="rounded-lg border border-border bg-surface-2 p-3 text-sm transition hover:border-primary/40"
                  >
                    <span className="font-semibold text-foreground">{item.label}</span>
                    <span className="mt-1 block text-muted-foreground">{item.text}</span>
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel title="Data status">
              <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
                {(data?.prices ?? []).map((price) => (
                  <div
                    key={price.zone}
                    className="flex items-center justify-between rounded bg-surface-2 px-2 py-1.5"
                  >
                    <span className="text-muted-foreground">{price.zone}</span>
                    <DataBadge source={price.source} />
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </div>
    </>
  );
}

function OpportunityTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    from: string;
    to: string;
    gross: number;
    cap: number;
    net: number;
    source: string;
  }>;
}) {
  return (
    <Panel title={title}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-1.5 text-left">Route</th>
              <th className="text-right">Gross EUR/MWh</th>
              <th className="text-right">Cap EUR/MWh</th>
              <th className="text-right">Net EUR/MWh</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <td className="py-1.5">
                  {ZONES[row.from as keyof typeof ZONES].name} to{" "}
                  {ZONES[row.to as keyof typeof ZONES].name}
                </td>
                <td className="num text-right">{fmtNum(row.gross)}</td>
                <td className="num text-right text-muted-foreground">{fmtNum(row.cap)}</td>
                <td
                  className={`num text-right font-semibold ${row.net > 0 ? "text-success" : "text-destructive"}`}
                >
                  {fmtNum(row.net)}
                </td>
                <td className="text-right">
                  <DataBadge source={row.source} />
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="py-5 text-center text-muted-foreground">
                  Data unavailable for the selected period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
