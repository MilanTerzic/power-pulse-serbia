import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getUtilization } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { fmtNum, fmtPct, downloadCSV } from "@/lib/format";
import { useDateRange } from "@/lib/date-range";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from "recharts";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/utilization")({
  head: () => ({ meta: [{ title: "Utilization — SEE Trading Desk" }] }),
  component: UtilizationPage,
});

function pctColor(p: number | null): string {
  if (p == null) return "#475569";
  if (p >= 0.85) return "#ef4444";       // red — congested
  if (p >= 0.6)  return "#f59e0b";       // amber
  if (p >= 0.3)  return "#1ec8c8";       // teal — healthy use
  return "#64748b";                       // grey — under-used
}

function UtilizationPage() {
  const fn = useServerFn(getUtilization);
  const { range } = useDateRange();
  const [mode, setMode] = useState<"avg" | "peak">("avg");

  const q = useQuery({
    queryKey: ["utilization", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });

  const rows = q.data?.rows ?? [];
  const rangeLabel = range.from === range.to ? range.from : `${range.from} → ${range.to}`;

  const sorted = [...rows].sort((a, b) => {
    const av = (mode === "avg" ? a.utilization_avg : a.utilization_peak) ?? -1;
    const bv = (mode === "avg" ? b.utilization_avg : b.utilization_peak) ?? -1;
    return bv - av;
  });

  const chartData = sorted
    .filter(r => r.ntc_mw != null)
    .map(r => ({
      label: r.label,
      utilPct: ((mode === "avg" ? r.utilization_avg : r.utilization_peak) ?? 0) * 100,
      flow: mode === "avg" ? r.avg_flow_mw : r.peak_flow_mw,
      ntc: r.ntc_mw,
    }));

  return (
    <>
      <TopBar
        title="Capacity Utilization"
        subtitle={`Physical flows vs technical NTC across SEE borders — ${rangeLabel}`}
        lastRefresh={rows[0]?.fetched_at}
        onRefresh={() => q.refetch()}
      />
      <div className="p-6 space-y-5">
        <Panel
          title={`Border utilization (${mode === "avg" ? "average" : "peak"} flow ÷ technical NTC)`}
          actions={
            <div className="flex gap-2 items-center">
              <div className="flex rounded border border-border/60 overflow-hidden text-xs">
                <button
                  onClick={() => setMode("avg")}
                  className={`px-2 py-1 ${mode === "avg" ? "bg-accent/40 text-primary" : "text-muted-foreground hover:bg-accent/20"}`}
                >Average</button>
                <button
                  onClick={() => setMode("peak")}
                  className={`px-2 py-1 ${mode === "peak" ? "bg-accent/40 text-primary" : "text-muted-foreground hover:bg-accent/20"}`}
                >Peak</button>
              </div>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("utilization.csv", sorted as never)}>
                <Download className="w-3.5 h-3.5" />CSV
              </Button>
            </div>
          }
        >
          <p className="text-xs text-muted-foreground mb-3">
            Each bar = one directional border (e.g. HU → RS). Height = {mode === "avg" ? "average" : "peak hourly"} physical flow
            divided by the technical NTC for that direction. Red ≥ 85% = persistent congestion,
            amber 60–85% = heavy use, teal 30–60% = healthy commercial use, grey &lt; 30% = under-used capacity (potential resale opportunity).
          </p>
          <div className="h-96">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 60 }}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={10} angle={-45} textAnchor="end" height={70} interval={0} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}
                  formatter={(v: number, _n, p) => [
                    `${v.toFixed(1)}%  (${fmtNum(p.payload.flow)} / ${fmtNum(p.payload.ntc)} MW)`,
                    "Utilization",
                  ]}
                />
                <ReferenceLine y={85} stroke="#ef4444" strokeDasharray="3 3" label={{ value: "85% congestion", fill: "#ef4444", fontSize: 10, position: "right" }} />
                <ReferenceLine y={60} stroke="#f59e0b" strokeDasharray="3 3" />
                <Bar dataKey="utilPct" radius={[3, 3, 0, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={pctColor(d.utilPct / 100)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Per-border detail">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-1.5">Direction</th>
                <th className="text-right">Technical NTC (MW)</th>
                <th className="text-right">Avg flow (MW)</th>
                <th className="text-right">Peak flow (MW)</th>
                <th className="text-right">Avg util.</th>
                <th className="text-right">Peak util.</th>
                <th className="text-right">Hours</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.label} className="border-t border-border/60">
                  <td className="py-1.5 font-medium">{r.label}</td>
                  <td className="text-right num text-muted-foreground">{r.ntc_mw != null ? fmtNum(r.ntc_mw) : "—"}</td>
                  <td className="text-right num">{fmtNum(r.avg_flow_mw)}</td>
                  <td className="text-right num">{fmtNum(r.peak_flow_mw)}</td>
                  <td className="text-right num font-semibold" style={{ color: pctColor(r.utilization_avg) }}>{fmtPct(r.utilization_avg)}</td>
                  <td className="text-right num font-semibold" style={{ color: pctColor(r.utilization_peak) }}>{fmtPct(r.utilization_peak)}</td>
                  <td className="text-right num text-muted-foreground">{r.hours}</td>
                  <td className="text-right"><DataBadge source={r.source} /></td>
                </tr>
              ))}
              {!sorted.length && (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">No flow data for the selected range.</td></tr>
              )}
            </tbody>
          </table>
          <p className="text-[10px] text-muted-foreground mt-3">
            NTC = technical Net Transfer Capacity (typical SEE CAO / ENTSO-E reference values).
            Flows are ENTSO-E A11 hourly physical flows. Utilization &gt; 100% can occur on counter-flows when
            unscheduled loop flows exceed nominal NTC.
          </p>
        </Panel>
      </div>
    </>
  );
}
