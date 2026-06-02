import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getAverageDAProfile } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtPrice, downloadCSV, fmtNum } from "@/lib/format";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/prices")({
  head: () => ({ meta: [{ title: "Prices — SEE Trading Desk" }] }),
  component: PricesPage,
});

const ZONE_COLORS: Record<string, string> = {
  RS: "#1ec8c8", HU: "#5aa9e6", RO: "#f5b14c", BG: "#a78bfa", HR: "#34d399",
  ME: "#22d3ee", MK: "#fbbf24", AL: "#e879f9", SI: "#94a3b8",
};

function PricesPage() {
  const fn = useServerFn(getAverageDAProfile);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["da_profile", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });

  const rows = q.data?.rows ?? [];

  // chart: 24 rows, one column per zone with averaged price for that hour
  const chartData = Array.from({ length: 24 }, (_, hour) => {
    const row: Record<string, number | string | null> = { hour: `${String(hour).padStart(2, "0")}:00` };
    for (const r of rows) row[r.zone] = r.profile[hour];
    return row;
  });

  const stats = rows.map(r => {
    const valid = r.profile.filter((v): v is number => v != null);
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    const peak = r.profile.slice(8, 20).filter((v): v is number => v != null);
    const peakAvg = peak.length ? peak.reduce((a, b) => a + b, 0) / peak.length : null;
    const off = [...r.profile.slice(0, 8), ...r.profile.slice(20, 24)].filter((v): v is number => v != null);
    const offAvg = off.length ? off.reduce((a, b) => a + b, 0) / off.length : null;
    const min = valid.length ? Math.min(...valid) : null;
    const max = valid.length ? Math.max(...valid) : null;
    const m = avg ?? 0;
    const vol = valid.length > 1 ? Math.sqrt(valid.reduce((s, x) => s + (x - m) ** 2, 0) / valid.length) : null;
    return { zone: r.zone, avg, peakAvg, offAvg, min, max, vol, source: r.source };
  });

  const rangeLabel = range.from === range.to ? range.from : `${range.from} → ${range.to}`;

  return (
    <>
      <TopBar
        title="Prices"
        subtitle={`Average hourly DA profile across ${rangeLabel} (BA excluded — no DA market)`}
        onRefresh={() => q.refetch()}
        lastRefresh={rows[0]?.fetched_at}
      />
      <div className="p-6 space-y-5">
        <Panel
          title="Average DA price per hour (24h)"
          actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("da-hourly-avg.csv", chartData as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}
        >
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" €" />
                <Tooltip contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {rows.map(r => (
                  <Line
                    key={r.zone}
                    dataKey={r.zone}
                    stroke={ZONE_COLORS[r.zone] ?? "#94a3b8"}
                    dot={false}
                    strokeWidth={r.zone === "RS" ? 2.5 : 1.2}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title="Statistics (range average)"
          actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("price-stats.csv", stats as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}
        >
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-1.5">Zone</th>
                <th className="text-right">Baseload</th>
                <th className="text-right">Peak (8–20h)</th>
                <th className="text-right">Off-peak</th>
                <th className="text-right">Min</th>
                <th className="text-right">Max</th>
                <th className="text-right">Volatility (σ)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stats.map(s => (
                <tr key={s.zone} className="border-t border-border/60">
                  <td className="py-1.5 font-medium">{s.zone}</td>
                  <td className="text-right num">{fmtPrice(s.avg)}</td>
                  <td className="text-right num">{fmtPrice(s.peakAvg)}</td>
                  <td className="text-right num">{fmtPrice(s.offAvg)}</td>
                  <td className="text-right num">{fmtPrice(s.min)}</td>
                  <td className="text-right num">{fmtPrice(s.max)}</td>
                  <td className="text-right num">{fmtNum(s.vol)}</td>
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
