import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDashboardSnapshot } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { DataBadge } from "@/components/data-badge";
import { fmtPrice, downloadCSV, fmtNum } from "@/lib/format";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/prices")({
  head: () => ({ meta: [{ title: "Prices — SEE Trading Desk" }] }),
  component: PricesPage,
});

function PricesPage() {
  const fn = useServerFn(getDashboardSnapshot);
  const [demo, setDemo] = useState(false);
  const q = useQuery({ queryKey: ["snapshot", demo], queryFn: () => fn({ data: { demo } }) });
  const data = q.data;

  const stats = (data?.prices ?? []).map(p => {
    const prices = p.data.points.map(x => x.price);
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
    const peak = prices.slice(8, 20);
    const peakAvg = peak.length ? peak.reduce((a, b) => a + b, 0) / peak.length : null;
    const min = prices.length ? Math.min(...prices) : null;
    const max = prices.length ? Math.max(...prices) : null;
    const neg = prices.filter(x => x < 0).length;
    const m = avg ?? 0;
    const vol = prices.length > 1 ? Math.sqrt(prices.reduce((s, x) => s + (x - m) ** 2, 0) / prices.length) : null;
    return { zone: p.zone, avg, peakAvg, min, max, neg, vol, source: p.source };
  });

  const chartData = (data?.byZone?.RS ?? []).map((_, i) => {
    const row: Record<string, number | string> = { hour: i };
    for (const p of data?.prices ?? []) row[p.zone] = p.data.points[i]?.price ?? NaN;
    return row;
  });

  const ZONE_COLORS: Record<string, string> = {
    RS: "#1ec8c8", HU: "#5aa9e6", RO: "#f5b14c", BG: "#a78bfa", HR: "#34d399",
    BA: "#fb7185", ME: "#22d3ee", MK: "#fbbf24", AL: "#e879f9", SI: "#94a3b8",
  };

  return (
    <>
      <TopBar title="Prices" subtitle="Hourly day-ahead, baseload, peak, volatility" demo={demo} onRefresh={() => q.refetch()} lastRefresh={data?.prices?.[0]?.fetched_at} />
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button size="sm" variant={demo ? "outline" : "default"} onClick={() => setDemo(false)}>Live</Button>
          <Button size="sm" variant={demo ? "default" : "outline"} onClick={() => setDemo(true)}>Demo</Button>
        </div>

        <Panel title="Hourly DA prices" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("prices.csv", chartData)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" €" />
                <Tooltip contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {Object.entries(ZONE_COLORS).map(([k, c]) => <Line key={k} dataKey={k} stroke={c} dot={false} strokeWidth={k === "RS" ? 2 : 1} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Statistics" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("price-stats.csv", stats as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-1.5">Zone</th>
                <th className="text-right">Baseload</th>
                <th className="text-right">Peak (8–20h)</th>
                <th className="text-right">Min</th>
                <th className="text-right">Max</th>
                <th className="text-right">Volatility (σ)</th>
                <th className="text-right">Neg hrs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.zone} className="border-t border-border/60">
                  <td className="py-1.5 font-medium">{s.zone}</td>
                  <td className="text-right num">{fmtPrice(s.avg)}</td>
                  <td className="text-right num">{fmtPrice(s.peakAvg)}</td>
                  <td className="text-right num">{fmtPrice(s.min)}</td>
                  <td className="text-right num">{fmtPrice(s.max)}</td>
                  <td className="text-right num">{fmtNum(s.vol)}</td>
                  <td className="text-right num">{s.neg}</td>
                  <td className="text-right"><DataBadge source={s.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
