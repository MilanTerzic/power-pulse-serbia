import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDashboardSnapshot } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { KPI } from "@/components/kpi";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtPrice, fmtNum } from "@/lib/format";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { useDateRange } from "@/lib/date-range";
import { ZONES } from "@/lib/markets";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview — SEE Trading Desk" }] }),
  component: OverviewPage,
});

function OverviewPage() {
  const fn = useServerFn(getDashboardSnapshot);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["snapshot", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });



  const data = q.data;

  const rsPoints = data?.byZone?.RS ?? [];
  const rsAvg = rsPoints.length ? rsPoints.reduce((a, p) => a + p.price, 0) / rsPoints.length : null;

  // Per-zone avg (null when zone has no points — avoids showing €0 for missing data like MK pre-publish)
  const zoneAvg = (z: string): number | null => {
    const pts = data?.byZone?.[z] ?? [];
    return pts.length ? pts.reduce((a, p) => a + p.price, 0) / pts.length : null;
  };

  // Compute neighbours best/worst — exclude zones with no data
  const neighbourAvgs = (data?.prices ?? [])
    .filter(p => p.zone !== "RS" && p.data.points.length > 0)
    .map(p => ({
      zone: p.zone,
      avg: p.data.points.reduce((a, x) => a + x.price, 0) / p.data.points.length,
      source: p.source,
    }));
  const lowest = neighbourAvgs.slice().sort((a, b) => a.avg - b.avg)[0];
  const highest = neighbourAvgs.slice().sort((a, b) => b.avg - a.avg)[0];

  // Best import: max gross spread (RS - source) - capacity cost. Skip routes where source has no data.
  const opportunities = (data?.importRoutes ?? [])
    .map(r => {
      const srcAvg = zoneAvg(r.from);
      if (rsAvg == null || srcAvg == null) return null;
      const gross = rsAvg - srcAvg;
      const cap = r.cap.data.price_eur_mwh ?? 0;
      return { label: r.label, from: r.from, to: r.to, gross, cap, net: gross - cap, source: r.cap.source };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.net - a.net);

  const exportOpps = (data?.exportRoutes ?? [])
    .map(r => {
      const dstAvg = zoneAvg(r.to);
      if (rsAvg == null || dstAvg == null) return null;
      const gross = dstAvg - rsAvg;
      const cap = r.cap.data.price_eur_mwh ?? 0;
      return { label: r.label, from: r.from, to: r.to, gross, cap, net: gross - cap, source: r.cap.source };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.net - a.net);

  // Build combined chart data — one row per hourly timestamp, all zones aligned
  const multiDay = range.from !== range.to;
  const tsIndex = new Map<string, Record<string, number | string>>();
  for (const z of data?.prices ?? []) {
    for (const pt of z.data.points) {
      const row = tsIndex.get(pt.ts) ?? {
        ts: pt.ts,
        t: new Date(pt.ts).toLocaleString("en-GB", {
          hour: "2-digit",
          ...(multiDay ? { day: "2-digit", month: "short" } : {}),
          timeZone: "Europe/Belgrade",
        }),
      };
      row[z.zone] = pt.price;
      tsIndex.set(pt.ts, row);
    }
  }
  const chartData = [...tsIndex.values()].sort((a, b) => (a.ts as string) < (b.ts as string) ? -1 : 1);

  const ZONE_LINES: Array<{ key: string; color: string }> = [
    { key: "RS", color: "#1ec8c8" },
    { key: "HU", color: "#5aa9e6" },
    { key: "RO", color: "#f5b14c" },
    { key: "BG", color: "#a78bfa" },
    { key: "HR", color: "#34d399" },
    { key: "BA", color: "#fb7185" },
    { key: "ME", color: "#22d3ee" },
    { key: "MK", color: "#fbbf24" },
    { key: "AL", color: "#e879f9" },
    { key: "SI", color: "#94a3b8" },
  ];

  return (
    <>
      <TopBar
        title="Overview"
        subtitle="Where is it best to buy/sell electricity around Serbia today?"
        lastRefresh={data?.prices?.[0]?.fetched_at}
        onRefresh={() => q.refetch()}
      />
      <div className="p-6 space-y-5">


        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI
            label={`SEEPEX baseload · ${range.from === range.to ? range.from : `${range.from} → ${range.to}`}`}
            value={fmtPrice(rsAvg)}
            sub={rsPoints.length ? `Avg of ${rsPoints.length} hourly DA prices (€/MWh)` : "No data"}
            source={data?.prices?.find(p => p.zone === "RS")?.source}
          />
          {data?.tomorrowRS ? (
            <KPI
              label={`SEEPEX baseload · ${data.tomorrowRS.day} (tomorrow)`}
              value={data.tomorrowRS.avg != null ? fmtPrice(data.tomorrowRS.avg) : "Not published yet"}
              sub={data.tomorrowRS.avg != null
                ? `Avg of ${data.tomorrowRS.points.length}h · gate-closed`
                : "DA auction publishes ~12:45 CET"}
              source={data.tomorrowRS.avg != null ? data.tomorrowRS.source : undefined}
              accent={data.tomorrowRS.avg != null ? "info" : "muted"}
            />
          ) : (
            <KPI label="Cheapest neighbour" value={lowest ? `${lowest.zone} · ${fmtPrice(lowest.avg)}` : "—"} accent="success" source={lowest?.source} />
          )}
          <KPI label="Most expensive neighbour" value={highest ? `${highest.zone} · ${fmtPrice(highest.avg)}` : "—"} accent="destructive" source={highest?.source} />
          <KPI label="Best net import route" value={opportunities[0] ? `${opportunities[0].label}` : "—"} sub={opportunities[0] ? `${fmtPrice(opportunities[0].net)} net` : ""} accent={opportunities[0]?.net > 0 ? "success" : "muted"} source={opportunities[0]?.source} />
        </div>

        <Panel
          title={`Hourly day-ahead spot price by country — ${range.from === range.to ? range.from : `${range.from} → ${range.to}`}`}
          actions={<span className="text-[10px] text-muted-foreground">€/MWh · time in CET (Europe/Belgrade)</span>}
        >
          <p className="text-xs text-muted-foreground mb-2">
            Each line is one country's day-ahead auction clearing price for every hour of the selected period.
            Serbia (RS, thick teal) is the reference: neighbours above RS suggest export opportunities, below RS suggest import opportunities.
          </p>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="t" stroke="var(--color-muted-foreground)" fontSize={11} minTickGap={28} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" €" label={{ value: "€/MWh", angle: -90, position: "insideLeft", fill: "var(--color-muted-foreground)", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }} formatter={(v: number) => [`${typeof v === "number" ? v.toFixed(2) : v} €/MWh`, ""]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {ZONE_LINES.map(z => <Line key={z.key} dataKey={z.key} stroke={z.color} dot={false} strokeWidth={z.key === "RS" ? 2.4 : 1.2} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <div className="grid md:grid-cols-2 gap-4">
          <Panel title="Top 3 import opportunities">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="text-left py-1.5">Route</th><th className="text-right">Gross €/MWh</th><th className="text-right">Cap €/MWh</th><th className="text-right">Net €/MWh</th><th></th></tr>
              </thead>
              <tbody>
                {opportunities.slice(0, 3).map(o => (
                  <tr key={o.label} className="border-t border-border/60">
                    <td className="py-1.5">{ZONES[o.from].name} → {ZONES[o.to].name}</td>
                    <td className="text-right num">{fmtNum(o.gross)}</td>
                    <td className="text-right num text-muted-foreground">{fmtNum(o.cap)}</td>
                    <td className={`text-right num font-semibold ${o.net > 0 ? "text-success" : "text-destructive"}`}>{fmtNum(o.net)}</td>
                    <td className="text-right"><DataBadge source={o.source} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Top 3 export opportunities">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="text-left py-1.5">Route</th><th className="text-right">Gross €/MWh</th><th className="text-right">Cap €/MWh</th><th className="text-right">Net €/MWh</th><th></th></tr>
              </thead>
              <tbody>
                {exportOpps.slice(0, 3).map(o => (
                  <tr key={o.label} className="border-t border-border/60">
                    <td className="py-1.5">{ZONES[o.from].name} → {ZONES[o.to].name}</td>
                    <td className="text-right num">{fmtNum(o.gross)}</td>
                    <td className="text-right num text-muted-foreground">{fmtNum(o.cap)}</td>
                    <td className={`text-right num font-semibold ${o.net > 0 ? "text-success" : "text-destructive"}`}>{fmtNum(o.net)}</td>
                    <td className="text-right"><DataBadge source={o.source} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <Panel title="Data status">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            {(data?.prices ?? []).map(p => (
              <div key={p.zone} className="flex items-center justify-between bg-surface-2 rounded px-2 py-1.5">
                <span className="text-muted-foreground">{p.zone}</span>
                <DataBadge source={p.source} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
