import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  Legend, BarChart, Bar, AreaChart, Area, ReferenceLine,
} from "recharts";
import { Download, ArrowLeftRight, AlertTriangle, TrendingUp, Activity } from "lucide-react";

import { getFlowAnalytics } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { DataBadge } from "@/components/data-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { fmtMW, fmtPct, fmtNum, downloadCSV } from "@/lib/format";
import { useDateRange } from "@/lib/date-range";
import { ZONES, type ZoneCode } from "@/lib/markets";

export const Route = createFileRoute("/_authenticated/flows")({
  head: () => ({ meta: [{ title: "Flows — SEE Trading Desk" }] }),
  component: FlowsPage,
});

type Hourly = { ts: string; imp_mw: number; exp_mw: number; net_mw: number };
type BorderRow = {
  neighbour: ZoneCode;
  hourly: Hourly[];
  capacity_imp_mw: number | null;
  capacity_exp_mw: number | null;
  source_imp: string;
  source_exp: string;
  cap_source: string;
  fetched_at: string;
};

const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#22d3ee"];

function statusFor(util: number | null, dataMissing: boolean) {
  if (dataMissing) return { label: "No data", cls: "bg-muted/30 text-muted-foreground border-border" };
  if (util == null) return { label: "No capacity", cls: "bg-warning/15 text-warning border-warning/30" };
  if (util >= 90) return { label: "Congested", cls: "bg-destructive/20 text-destructive border-destructive/40" };
  if (util >= 80) return { label: "High util", cls: "bg-warning/15 text-warning border-warning/30" };
  return { label: "Normal", cls: "bg-success/15 text-success border-success/30" };
}

function utilColor(util: number | null) {
  if (util == null) return "hsl(var(--muted-foreground) / 0.2)";
  if (util >= 90) return "oklch(0.62 0.22 25)"; // destructive
  if (util >= 80) return "oklch(0.75 0.16 70)"; // warning
  if (util >= 50) return "oklch(0.72 0.13 200)"; // info
  return "oklch(0.65 0.14 145)"; // success
}

function FlowsPage() {
  const fn = useServerFn(getFlowAnalytics);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["flow-analytics", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });

  const [selectedBorder, setSelectedBorder] = useState<ZoneCode>("HU");
  const [chartMode, setChartMode] = useState<"net" | "split">("net");

  const borders = (q.data?.borders ?? []) as BorderRow[];

  // Per-border aggregates
  const summary = useMemo(() => borders.map(b => {
    const nets = b.hourly.map(h => h.net_mw);
    const imps = b.hourly.map(h => h.imp_mw);
    const exps = b.hourly.map(h => h.exp_mw);
    const n = b.hourly.length;
    const avgNet = n ? nets.reduce((a, x) => a + x, 0) / n : null;
    const maxNet = n ? Math.max(...nets) : null;
    const minNet = n ? Math.min(...nets) : null;
    const avgImp = n ? imps.reduce((a, x) => a + x, 0) / n : 0;
    const avgExp = n ? exps.reduce((a, x) => a + x, 0) / n : 0;
    // Direction-aware utilization: hourly = importing? use imp/cap_imp, else exp/cap_exp
    const utilHourly = b.hourly.map(h => {
      const importing = h.net_mw >= 0;
      const flow = importing ? h.imp_mw : h.exp_mw;
      const cap = importing ? b.capacity_imp_mw : b.capacity_exp_mw;
      return cap && cap > 0 ? (flow / cap) * 100 : null;
    });
    const validUtil = utilHourly.filter((x): x is number => x != null && Number.isFinite(x));
    const avgUtil = validUtil.length ? validUtil.reduce((a, x) => a + x, 0) / validUtil.length : null;
    const maxUtil = validUtil.length ? Math.max(...validUtil) : null;
    const hoursAbove80 = validUtil.filter(x => x >= 80).length;
    const hoursAbove90 = validUtil.filter(x => x >= 90).length;

    // direction reversals: sign changes in net
    let reversals = 0;
    for (let i = 1; i < nets.length; i++) {
      if (Math.sign(nets[i]) !== 0 && Math.sign(nets[i - 1]) !== 0 && Math.sign(nets[i]) !== Math.sign(nets[i - 1])) reversals++;
    }
    // volatility
    const mean = avgNet ?? 0;
    const variance = n ? nets.reduce((a, x) => a + (x - mean) ** 2, 0) / n : 0;
    const stdev = Math.sqrt(variance);

    const dataMissing = n === 0 || (b.source_imp === "empty" && b.source_exp === "empty");

    return {
      neighbour: b.neighbour,
      label: `${b.neighbour} ↔ RS`,
      avgNet, maxNet, minNet, avgImp, avgExp,
      avgUtil, maxUtil, hoursAbove80, hoursAbove90, reversals, stdev,
      capImp: b.capacity_imp_mw, capExp: b.capacity_exp_mw,
      sourceImp: b.source_imp, sourceExp: b.source_exp, capSource: b.cap_source,
      utilHourly, hourly: b.hourly, dataMissing,
    };
  }), [borders]);

  // Net Serbia position by hour (imports - exports across all borders)
  const netByHour = useMemo(() => {
    const map = new Map<string, { imp: number; exp: number }>();
    for (const b of borders) {
      for (const h of b.hourly) {
        const cur = map.get(h.ts) ?? { imp: 0, exp: 0 };
        cur.imp += h.imp_mw;
        cur.exp += h.exp_mw;
        map.set(h.ts, cur);
      }
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([ts, v]) => ({
      ts,
      hour: new Date(ts).toLocaleString("en-GB", { hour: "2-digit", day: "2-digit", month: "short" }),
      imports: Math.round(v.imp),
      exports: Math.round(v.exp),
      net: Math.round(v.imp - v.exp),
    }));
  }, [borders]);

  // KPIs
  const totalNet = netByHour.reduce((a, x) => a + x.net, 0);
  const peakImport = netByHour.length ? Math.max(...netByHour.map(x => x.imports)) : 0;
  const peakExport = netByHour.length ? Math.max(...netByHour.map(x => x.exports)) : 0;
  const hoursAbove80All = summary.reduce((a, s) => a + s.hoursAbove80, 0);
  const reversalsAll = summary.reduce((a, s) => a + s.reversals, 0);
  const utilValid = summary.filter(s => s.avgUtil != null);
  const avgUtilAll = utilValid.length ? utilValid.reduce((a, s) => a + (s.avgUtil ?? 0), 0) / utilValid.length : null;
  const highestUtil = utilValid.slice().sort((a, b) => (b.avgUtil ?? 0) - (a.avgUtil ?? 0))[0];
  const mostVolatile = summary.slice().sort((a, b) => b.stdev - a.stdev)[0];

  // Hourly chart for selected border
  const selBorder = summary.find(s => s.neighbour === selectedBorder);
  const selChartData = (selBorder?.hourly ?? []).map(h => ({
    hour: new Date(h.ts).toLocaleString("en-GB", { hour: "2-digit", day: "2-digit", month: "short" }),
    Import: Math.round(h.imp_mw),
    Export: -Math.round(h.exp_mw),
    Net: Math.round(h.net_mw),
  }));

  // Duration curve for selected border (sorted abs flows desc)
  const selDuration = (selBorder?.hourly ?? [])
    .map(h => Math.abs(h.net_mw))
    .sort((a, b) => b - a)
    .map((mw, i, arr) => ({ pct: Math.round(((i + 1) / arr.length) * 100), mw: Math.round(mw) }));

  const csvRows = summary.map(s => ({
    border: s.label,
    avg_net_mw: s.avgNet?.toFixed(1) ?? "",
    max_net_mw: s.maxNet?.toFixed(1) ?? "",
    min_net_mw: s.minNet?.toFixed(1) ?? "",
    avg_import_mw: s.avgImp.toFixed(1),
    avg_export_mw: s.avgExp.toFixed(1),
    cap_imp_mw: s.capImp ?? "",
    cap_exp_mw: s.capExp ?? "",
    avg_util_pct: s.avgUtil?.toFixed(1) ?? "",
    max_util_pct: s.maxUtil?.toFixed(1) ?? "",
    hours_above_80: s.hoursAbove80,
    hours_above_90: s.hoursAbove90,
    direction_reversals: s.reversals,
    source_import: s.sourceImp,
    source_export: s.sourceExp,
    cap_source: s.capSource,
  }));

  return (
    <>
      <TopBar
        title="Physical Flows (A11)"
        subtitle="Cross-border flow analytics, capacity utilization & congestion"
        onRefresh={() => q.refetch()}
        lastRefresh={q.data?.fetched_at}
      />
      <div className="p-6 space-y-5">

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <KPI label="Net position" value={`${totalNet >= 0 ? "+" : ""}${fmtNum(totalNet, 0)} MWh`}
            sub={totalNet >= 0 ? "Net import" : "Net export"}
            accent={totalNet >= 0 ? "info" : "success"} />
          <KPI label="Peak import" value={fmtMW(peakImport)} accent="info" />
          <KPI label="Peak export" value={fmtMW(peakExport)} accent="success" />
          <KPI label="Avg utilization" value={fmtPct(avgUtilAll)}
            sub={avgUtilAll == null ? "no capacity data" : undefined}
            accent={avgUtilAll && avgUtilAll >= 80 ? "destructive" : "primary"} />
          <KPI label="Highest util border" value={highestUtil ? highestUtil.label : "—"}
            sub={highestUtil ? fmtPct(highestUtil.avgUtil) : "no capacity data"}
            accent="warning" />
          <KPI label="Most volatile" value={mostVolatile?.label ?? "—"}
            sub={mostVolatile ? `σ ${fmtNum(mostVolatile.stdev, 0)} MW` : undefined}
            accent="primary" />
          <KPI label="Stress hours" value={`${hoursAbove80All}`}
            sub={`>80% util · ${reversalsAll} reversals`}
            accent={hoursAbove80All > 0 ? "warning" : "muted"} />
        </div>

        {/* Network diagram + Net position */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Panel title="Serbia cross-border network">
            <NetworkDiagram summary={summary} onSelect={n => setSelectedBorder(n)} selected={selectedBorder} />
            <Legend2 />
          </Panel>

          <Panel title="Net Serbia position (hourly)" actions={
            <span className="text-[11px] text-muted-foreground">+ import · − export</span>
          }>
            {netByHour.length === 0 ? (
              <EmptyState />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={netByHour}>
                  <defs>
                    <linearGradient id="netPos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.72 0.13 200)" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="oklch(0.72 0.13 200)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} unit=" MW" width={70} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                  <RTooltip contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Area type="monotone" dataKey="net" stroke="oklch(0.72 0.13 200)" fill="url(#netPos)" name="Net (MW)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </div>

        {/* Per-route flow chart + duration curve */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <Panel
            title={`Hourly flow — ${selBorder?.label ?? "—"}`}
            actions={
              <div className="flex gap-2">
                <Select value={selectedBorder} onValueChange={v => setSelectedBorder(v as ZoneCode)}>
                  <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {summary.map(s => (
                      <SelectItem key={s.neighbour} value={s.neighbour}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={chartMode} onValueChange={v => setChartMode(v as "net" | "split")}>
                  <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="net">Net flow</SelectItem>
                    <SelectItem value="split">Import / Export</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
          >
            <div className="xl:col-span-2">
              {selChartData.length === 0 ? <EmptyState /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={selChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} unit=" MW" width={70} />
                    <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {chartMode === "net" ? (
                      <Line type="monotone" dataKey="Net" stroke="#60a5fa" strokeWidth={2} dot={false} />
                    ) : (
                      <>
                        <Line type="monotone" dataKey="Import" stroke="oklch(0.72 0.13 200)" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="Export" stroke="oklch(0.65 0.14 145)" strokeWidth={2} dot={false} />
                      </>
                    )}
                    {selBorder?.capImp != null && (
                      <ReferenceLine y={selBorder.capImp} stroke="oklch(0.62 0.22 25)" strokeDasharray="4 4" label={{ value: `NTC ${selBorder.capImp}`, fill: "oklch(0.62 0.22 25)", fontSize: 10 }} />
                    )}
                    {selBorder?.capExp != null && (
                      <ReferenceLine y={-selBorder.capExp} stroke="oklch(0.62 0.22 25)" strokeDasharray="4 4" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Panel>

          <Panel title="Flow duration curve" actions={<span className="text-[11px] text-muted-foreground">|MW| sorted</span>}>
            {selDuration.length === 0 ? <EmptyState /> : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={selDuration}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                  <XAxis dataKey="pct" tick={{ fontSize: 10 }} unit="%" />
                  <YAxis tick={{ fontSize: 10 }} unit=" MW" width={70} />
                  <RTooltip contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Area type="stepAfter" dataKey="mw" stroke="#a78bfa" fill="oklch(0.65 0.18 290 / 0.25)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Panel>
        </div>

        {/* Utilization bar + heatmap */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <Panel title="Avg utilization by border">
            {utilValid.length === 0 ? (
              <div className="text-xs text-muted-foreground p-6 text-center">No capacity data available for the selected period. Utilization cannot be computed.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={summary.map(s => ({ name: s.neighbour, util: s.avgUtil ?? 0, max: s.maxUtil ?? 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" />
                  <ReferenceLine y={80} stroke="oklch(0.75 0.16 70)" strokeDasharray="3 3" />
                  <ReferenceLine y={90} stroke="oklch(0.62 0.22 25)" strokeDasharray="3 3" />
                  <RTooltip contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Bar dataKey="util" name="Avg %" fill="oklch(0.72 0.13 200)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="max" name="Max %" fill="oklch(0.65 0.18 290)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <Panel title="Hourly utilization heatmap">
            <Heatmap summary={summary} />
          </Panel>
        </div>

        {/* Route ranking table */}
        <Panel
          title="Route ranking & capacity comparison"
          actions={
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("flows-summary.csv", csvRows)}>
              <Download className="w-3.5 h-3.5" />CSV
            </Button>
          }
        >
          {summary.length === 0 ? <EmptyState /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 px-2">Border</th>
                    <th className="text-right">Avg Imp</th>
                    <th className="text-right">Avg Exp</th>
                    <th className="text-right">Net</th>
                    <th className="text-right">Max</th>
                    <th className="text-right">Min</th>
                    <th className="text-right">NTC imp</th>
                    <th className="text-right">NTC exp</th>
                    <th className="text-right">Avg %</th>
                    <th className="text-right">Max %</th>
                    <th className="text-right">h&gt;80%</th>
                    <th className="text-right">h&gt;90%</th>
                    <th className="text-right">Rev.</th>
                    <th className="text-center">Source</th>
                    <th className="text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map(s => {
                    const status = statusFor(s.avgUtil, s.dataMissing);
                    return (
                      <tr key={s.neighbour} className="border-b border-border/40 hover:bg-surface-2/40">
                        <td className="py-2 px-2 font-medium">
                          <button className="hover:text-primary" onClick={() => setSelectedBorder(s.neighbour)}>{s.label}</button>
                          <div className="text-[10px] text-muted-foreground">{ZONES[s.neighbour]?.name}</div>
                        </td>
                        <td className="text-right num">{fmtMW(s.avgImp)}</td>
                        <td className="text-right num">{fmtMW(s.avgExp)}</td>
                        <td className={`text-right num ${(s.avgNet ?? 0) >= 0 ? "text-info" : "text-success"}`}>
                          {s.avgNet == null ? "—" : `${s.avgNet >= 0 ? "+" : ""}${fmtNum(s.avgNet, 0)}`}
                        </td>
                        <td className="text-right num">{fmtMW(s.maxNet)}</td>
                        <td className="text-right num text-muted-foreground">{fmtMW(s.minNet)}</td>
                        <td className="text-right num">{s.capImp != null ? fmtMW(s.capImp) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="text-right num">{s.capExp != null ? fmtMW(s.capExp) : <span className="text-muted-foreground">—</span>}</td>
                        <td className="text-right num">{fmtPct(s.avgUtil)}</td>
                        <td className="text-right num">{fmtPct(s.maxUtil)}</td>
                        <td className="text-right num">{s.hoursAbove80}</td>
                        <td className="text-right num text-destructive">{s.hoursAbove90}</td>
                        <td className="text-right num">{s.reversals}</td>
                        <td className="text-center"><DataBadge source={s.sourceImp} /></td>
                        <td className="text-center"><Badge variant="outline" className={`text-[10px] ${status.cls}`}>{status.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {q.isLoading && <div className="text-center text-xs text-muted-foreground py-6">Loading flow data…</div>}
        {q.isError && <div className="text-center text-xs text-destructive py-6">Failed to load flow data.</div>}
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-xs text-muted-foreground gap-2">
      <AlertTriangle className="w-5 h-5 opacity-50" />
      No flow data available for the selected period.
    </div>
  );
}

function Legend2() {
  const items = [
    { c: "oklch(0.65 0.14 145)", l: "<50%" },
    { c: "oklch(0.72 0.13 200)", l: "50–80%" },
    { c: "oklch(0.75 0.16 70)", l: "80–90%" },
    { c: "oklch(0.62 0.22 25)", l: ">90% congested" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] text-muted-foreground">
      {items.map(i => (
        <span key={i.l} className="inline-flex items-center gap-1.5">
          <span className="w-3 h-1 rounded-sm" style={{ background: i.c }} />{i.l}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 ml-2"><ArrowLeftRight className="w-3 h-3" /> arrow = avg flow direction</span>
    </div>
  );
}

// Network diagram: RS center, neighbours on a ring
type DiagItem = { neighbour: ZoneCode; label: string; avgNet: number | null; avgImp: number; avgExp: number; avgUtil: number | null };

function NetworkDiagram({
  summary, onSelect, selected,
}: {
  summary: DiagItem[];
  onSelect: (n: ZoneCode) => void;
  selected: ZoneCode;
}) {
  const w = 560, h = 320;
  const cx = w / 2, cy = h / 2;
  const r = 120;
  const items = summary.map((s, i) => {
    const angle = (-Math.PI / 2) + (i * (2 * Math.PI / Math.max(1, summary.length)));
    return { ...s, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
  const maxMag = Math.max(1, ...items.map(i => Math.abs(i.avgNet ?? 0)));
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[320px]">
        <defs>
          {items.map((it, idx) => (
            <marker key={idx} id={`arr-${it.neighbour}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={utilColor(it.avgUtil)} />
            </marker>
          ))}
        </defs>
        {/* edges */}
        {items.map(it => {
          const importing = (it.avgNet ?? 0) >= 0;
          const x1 = importing ? it.x : cx;
          const y1 = importing ? it.y : cy;
          const x2 = importing ? cx : it.x;
          const y2 = importing ? cy : it.y;
          const thickness = 1 + (Math.abs(it.avgNet ?? 0) / maxMag) * 7;
          return (
            <line key={it.neighbour}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={utilColor(it.avgUtil)}
              strokeWidth={thickness}
              strokeOpacity={0.85}
              markerEnd={`url(#arr-${it.neighbour})`}
            />
          );
        })}
        {/* RS center */}
        <circle cx={cx} cy={cy} r={32} fill="oklch(0.25 0.05 260)" stroke="hsl(var(--primary))" strokeWidth={2} />
        <text x={cx} y={cy + 5} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="14" fontWeight={600}>RS</text>
        {/* neighbours */}
        {items.map(it => (
          <g key={it.neighbour} className="cursor-pointer" onClick={() => onSelect(it.neighbour)}>
            <circle cx={it.x} cy={it.y} r={26}
              fill={selected === it.neighbour ? "oklch(0.3 0.08 260)" : "hsl(var(--surface-2))"}
              stroke={selected === it.neighbour ? "hsl(var(--primary))" : "hsl(var(--border))"}
              strokeWidth={selected === it.neighbour ? 2 : 1} />
            <text x={it.x} y={it.y - 2} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="12" fontWeight={600}>{it.neighbour}</text>
            <text x={it.x} y={it.y + 12} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="9">
              {it.avgNet == null ? "—" : `${it.avgNet >= 0 ? "+" : ""}${Math.round(it.avgNet)} MW`}
            </text>
            {it.avgUtil != null && (
              <text x={it.x} y={it.y + 42} textAnchor="middle" fill={utilColor(it.avgUtil)} fontSize="10" fontWeight={600}>
                {Math.round(it.avgUtil)}%
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function Heatmap({ summary }: { summary: Array<{ neighbour: ZoneCode; utilHourly: Array<number | null>; hourly: Hourly[] }> }) {
  const cols = Math.max(...summary.map(s => s.utilHourly.length), 0);
  if (cols === 0) return <EmptyState />;
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="grid" style={{ gridTemplateColumns: `60px repeat(${cols}, 14px)`, gap: 2 }}>
          <div />
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="text-[8px] text-muted-foreground text-center">{i % 6 === 0 ? i : ""}</div>
          ))}
          {summary.map(s => (
            <Fragment key={s.neighbour}>
              <div className="text-[10px] text-muted-foreground pr-2 flex items-center">{s.neighbour}</div>
              {s.utilHourly.map((u, i) => (
                <div key={`${s.neighbour}-${i}`}
                  className="w-[14px] h-[14px] rounded-[2px]"
                  title={u == null ? `${s.neighbour} h${i}: no capacity` : `${s.neighbour} h${i}: ${u.toFixed(0)}%`}
                  style={{ background: u == null ? "hsl(var(--muted) / 0.2)" : utilColor(u) }}
                />
              ))}
            </Fragment>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-muted-foreground">Hours across selected range · color = utilization</div>
      </div>
    </div>
  );
}
