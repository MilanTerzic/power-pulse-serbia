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
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ZONES } from "@/lib/markets";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Overview — SEE Trading Desk" }] }),
  component: OverviewPage,
});

function OverviewPage() {
  const fn = useServerFn(getDashboardSnapshot);
  const [demo, setDemo] = useState(false);
  const q = useQuery({
    queryKey: ["snapshot", demo],
    queryFn: () => fn({ data: { demo } }),
  });

  const data = q.data;

  const rsPoints = data?.byZone?.RS ?? [];
  const rsAvg = rsPoints.length ? rsPoints.reduce((a, p) => a + p.price, 0) / rsPoints.length : null;

  // Compute neighbours best/worst
  const neighbourAvgs = (data?.prices ?? []).filter(p => p.zone !== "RS").map(p => ({
    zone: p.zone,
    avg: p.data.points.length ? p.data.points.reduce((a, x) => a + x.price, 0) / p.data.points.length : null,
    source: p.source,
  }));
  const lowest = neighbourAvgs.filter(n => n.avg != null).sort((a, b) => (a.avg! - b.avg!))[0];
  const highest = neighbourAvgs.filter(n => n.avg != null).sort((a, b) => (b.avg! - a.avg!))[0];

  // Best import: max gross spread (RS - source) - capacity cost
  const opportunities = (data?.importRoutes ?? []).map(r => {
    const srcAvg = (data?.byZone?.[r.from] ?? []).reduce((a, p) => a + p.price, 0) / Math.max(1, (data?.byZone?.[r.from] ?? []).length);
    const gross = (rsAvg ?? 0) - srcAvg;
    const cap = r.cap.data.price_eur_mwh ?? 0;
    return { label: r.label, from: r.from, to: r.to, gross, cap, net: gross - cap, source: r.cap.source };
  }).sort((a, b) => b.net - a.net);

  const exportOpps = (data?.exportRoutes ?? []).map(r => {
    const dstAvg = (data?.byZone?.[r.to] ?? []).reduce((a, p) => a + p.price, 0) / Math.max(1, (data?.byZone?.[r.to] ?? []).length);
    const gross = dstAvg - (rsAvg ?? 0);
    const cap = r.cap.data.price_eur_mwh ?? 0;
    return { label: r.label, from: r.from, to: r.to, gross, cap, net: gross - cap, source: r.cap.source };
  }).sort((a, b) => b.net - a.net);

  // Build combined chart data
  const chartData = rsPoints.map((p, i) => {
    const row: Record<string, number | string> = { ts: new Date(p.ts).toLocaleTimeString("en-GB", { hour: "2-digit" }) };
    for (const z of data?.prices ?? []) row[z.zone] = z.data.points[i]?.price ?? NaN;
    return row;
  });

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
        demo={data?.demo || demo}
        lastRefresh={data?.prices?.[0]?.fetched_at}
        onRefresh={() => q.refetch()}
      />
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button size="sm" variant={demo ? "outline" : "default"} onClick={() => setDemo(false)}>Live data</Button>
          <Button size="sm" variant={demo ? "default" : "outline"} onClick={() => setDemo(true)}>Demo data</Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="SEEPEX today avg" value={fmtPrice(rsAvg)} source={data?.prices?.find(p => p.zone === "RS")?.source} />
          <KPI label="Cheapest neighbour" value={lowest ? `${lowest.zone} · ${fmtPrice(lowest.avg)}` : "—"} accent="success" source={lowest?.source} />
          <KPI label="Most expensive neighbour" value={highest ? `${highest.zone} · ${fmtPrice(highest.avg)}` : "—"} accent="destructive" source={highest?.source} />
          <KPI label="Best net import route" value={opportunities[0] ? `${opportunities[0].label}` : "—"} sub={opportunities[0] ? `${fmtPrice(opportunities[0].net)} net` : ""} accent={opportunities[0]?.net > 0 ? "success" : "muted"} source={opportunities[0]?.source} />
        </div>

        <Panel title="Day-ahead prices — RS vs neighbours">
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="ts" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" €" />
                <Tooltip contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {ZONE_LINES.map(z => <Line key={z.key} dataKey={z.key} stroke={z.color} dot={false} strokeWidth={z.key === "RS" ? 2 : 1.2} />)}
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
