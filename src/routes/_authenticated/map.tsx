import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDashboardSnapshot, getFlows } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { DataBadge } from "@/components/data-badge";
import { ZONES, IMPORT_ROUTES, EXPORT_ROUTES, type ZoneCode } from "@/lib/markets";
import { useDateRange } from "@/lib/date-range";
import { useMemo, useState } from "react";
import { fmtNum, fmtMW, fmtPrice } from "@/lib/format";
import { ArrowDownRight, ArrowUpRight, TrendingUp, Zap } from "lucide-react";

export const Route = createFileRoute("/_authenticated/map")({
  head: () => ({ meta: [{ title: "Route Map — SEE Trading Desk" }] }),
  component: MapPage,
});

type RouteRow = {
  from: ZoneCode;
  to: ZoneCode;
  label: string;
  kind: "import" | "export";
  cap: number;
  srcPrice: number;
  dstPrice: number;
  spread: number;
  net: number;
  flowAvg: number | null;
  flowMax: number | null;
  capSource: string;
  flowSource: string;
};

function MapPage() {
  const snapFn = useServerFn(getDashboardSnapshot);
  const flowFn = useServerFn(getFlows);
  const { range } = useDateRange();
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const snap = useQuery({
    queryKey: ["snapshot", range.from, range.to],
    queryFn: () => snapFn({ data: { from: range.from, to: range.to } }),
  });
  const flows = useQuery({
    queryKey: ["flows", range.from, range.to],
    queryFn: () => flowFn({ data: { from: range.from, to: range.to } }),
  });

  const data = snap.data;

  const zoneAvg = useMemo(() => {
    const out: Partial<Record<ZoneCode, number>> = {};
    for (const [z, pts] of Object.entries(data?.byZone ?? {})) {
      if (pts && pts.length) out[z as ZoneCode] = pts.reduce((s, p) => s + p.price, 0) / pts.length;
    }
    return out;
  }, [data]);

  const priceRange = useMemo(() => {
    const vals = Object.values(zoneAvg).filter((v): v is number => typeof v === "number");
    if (!vals.length) return { min: 0, max: 100 };
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [zoneAvg]);

  const rsAvg = zoneAvg.RS ?? 0;

  const rows: RouteRow[] = useMemo(() => {
    const flowMap = new Map<string, { avg: number | null; max: number | null; source: string }>();
    for (const r of flows.data?.rows ?? []) {
      const mw = r.data.points.map(p => p.mw);
      flowMap.set(`${r.from}_${r.to}`, {
        avg: mw.length ? mw.reduce((a, b) => a + b, 0) / mw.length : null,
        max: mw.length ? Math.max(...mw) : null,
        source: r.source,
      });
    }
    const make = (r: { from: ZoneCode; to: ZoneCode; label: string }, kind: "import" | "export"): RouteRow => {
      const capRow = (kind === "import" ? data?.importRoutes : data?.exportRoutes)?.find(
        x => x.from === r.from && x.to === r.to,
      );
      const cap = capRow?.cap.data.price_eur_mwh ?? 0;
      const srcPrice = zoneAvg[r.from] ?? 0;
      const dstPrice = zoneAvg[r.to] ?? 0;
      const spread = dstPrice - srcPrice;
      const f = flowMap.get(`${r.from}_${r.to}`);
      return {
        ...r, kind, cap, srcPrice, dstPrice, spread,
        net: spread - cap,
        flowAvg: f?.avg ?? null,
        flowMax: f?.max ?? null,
        capSource: capRow?.cap.source ?? "empty",
        flowSource: f?.source ?? "empty",
      };
    };
    return [
      ...IMPORT_ROUTES.map(r => make(r, "import")),
      ...EXPORT_ROUTES.map(r => make(r, "export")),
    ];
  }, [data, flows.data, zoneAvg]);

  const sel = rows.find(r => `${r.from}_${r.to}` === selected) ?? null;
  const topOpportunities = [...rows].sort((a, b) => b.net - a.net).slice(0, 6);
  const bestImport = [...rows].filter(r => r.kind === "import").sort((a, b) => b.net - a.net)[0];
  const bestExport = [...rows].filter(r => r.kind === "export").sort((a, b) => b.net - a.net)[0];
  const positiveCount = rows.filter(r => r.net > 0).length;

  const priceColor = (p?: number) => {
    if (p == null) return "var(--color-muted)";
    const { min, max } = priceRange;
    const t = max === min ? 0.5 : (p - min) / (max - min);
    // cool (cheap) to hot (expensive) via OKLCH
    const hue = 220 - t * 200; // 220 (blue) → 20 (red)
    return `oklch(0.62 0.18 ${hue})`;
  };

  return (
    <>
      <TopBar
        title="Route Map"
        subtitle="Cross-border price spreads, capacity costs and net margins around Serbia"
        onRefresh={() => { snap.refetch(); flows.refetch(); }}
      />

      <div className="p-6 space-y-5">
        <div className="grid md:grid-cols-4 gap-4">
          <KPI label="RS day-avg price" value={fmtPrice(rsAvg)} accent="primary" source={snap.data ? "live" : "empty"} />
          <KPI
            label="Best import margin"
            value={bestImport ? fmtPrice(bestImport.net) : "—"}
            sub={bestImport ? `${bestImport.from} → ${bestImport.to}` : ""}
            accent={bestImport && bestImport.net > 0 ? "success" : "muted"}
          />
          <KPI
            label="Best export margin"
            value={bestExport ? fmtPrice(bestExport.net) : "—"}
            sub={bestExport ? `${bestExport.from} → ${bestExport.to}` : ""}
            accent={bestExport && bestExport.net > 0 ? "success" : "muted"}
          />
          <KPI
            label="Profitable routes"
            value={`${positiveCount} / ${rows.length}`}
            sub="Net spread > capacity cost"
            accent={positiveCount > 0 ? "success" : "warning"}
          />
        </div>

        <div className="grid lg:grid-cols-[1fr_340px] gap-5">
          <Panel
            title="Regional power flow map"
            actions={<Legend />}
          >
            <svg viewBox="0 50 720 460" className="w-full h-[560px]">
              <defs>
                <radialGradient id="bg-grad" cx="50%" cy="50%" r="60%">
                  <stop offset="0%" stopColor="oklch(0.22 0.02 250)" />
                  <stop offset="100%" stopColor="oklch(0.15 0.015 250)" />
                </radialGradient>
                <marker id="arrow-pos" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L10,5 L0,10 Z" fill="oklch(0.72 0.18 145)" />
                </marker>
                <marker id="arrow-neg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L10,5 L0,10 Z" fill="oklch(0.62 0.20 25)" />
                </marker>
                <marker id="arrow-neu" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L10,5 L0,10 Z" fill="oklch(0.55 0.02 250)" />
                </marker>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <rect x="0" y="50" width="720" height="460" fill="url(#bg-grad)" rx="8" />

              {/* subtle grid */}
              <g opacity="0.08" stroke="currentColor">
                {Array.from({ length: 9 }).map((_, i) => (
                  <line key={`v${i}`} x1={80 * i} y1={50} x2={80 * i} y2={510} strokeWidth="0.5" />
                ))}
                {Array.from({ length: 7 }).map((_, i) => (
                  <line key={`h${i}`} x1={0} y1={50 + 80 * i} x2={720} y2={50 + 80 * i} strokeWidth="0.5" />
                ))}
              </g>

              {/* edges */}
              {rows.map(r => {
                const a = ZONES[r.from], b = ZONES[r.to];
                const id = `${r.from}_${r.to}`;
                const isHot = hover === id || selected === id;
                const isPos = r.net > 1;
                const isNeg = r.net < -1;
                const stroke = isPos ? "oklch(0.72 0.18 145)" : isNeg ? "oklch(0.62 0.20 25)" : "oklch(0.55 0.02 250)";
                const marker = isPos ? "url(#arrow-pos)" : isNeg ? "url(#arrow-neg)" : "url(#arrow-neu)";
                const sw = Math.min(7, 1.2 + Math.abs(r.net) / 4);
                // offset endpoints from node radius
                const dx = b.x - a.x, dy = b.y - a.y;
                const len = Math.hypot(dx, dy) || 1;
                const nx = dx / len, ny = dy / len;
                const x1 = a.x + nx * 20, y1 = a.y + ny * 20;
                const x2 = b.x - nx * 22, y2 = b.y - ny * 22;
                // parallel offset so both directions are visible
                const perp = r.kind === "export" ? 5 : -5;
                const ox = -ny * perp, oy = nx * perp;

                return (
                  <g
                    key={id}
                    onMouseEnter={() => setHover(id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(id)}
                    className="cursor-pointer"
                  >
                    {isHot && (
                      <line
                        x1={x1 + ox} y1={y1 + oy} x2={x2 + ox} y2={y2 + oy}
                        stroke={stroke} strokeWidth={sw + 6} strokeOpacity={0.25} strokeLinecap="round"
                      />
                    )}
                    <line
                      x1={x1 + ox} y1={y1 + oy} x2={x2 + ox} y2={y2 + oy}
                      stroke={stroke} strokeWidth={sw} strokeOpacity={isHot ? 1 : 0.75}
                      strokeLinecap="round" markerEnd={marker}
                    />
                    {isPos && (
                      <line
                        x1={x1 + ox} y1={y1 + oy} x2={x2 + ox} y2={y2 + oy}
                        stroke={stroke} strokeWidth={sw} strokeOpacity={0.9}
                        strokeDasharray="4 8" strokeLinecap="round"
                      >
                        <animate attributeName="stroke-dashoffset" from="0" to="-24" dur="1.2s" repeatCount="indefinite" />
                      </line>
                    )}
                    {isHot && (
                      <text
                        x={(x1 + x2) / 2 + ox * 2} y={(y1 + y2) / 2 + oy * 2 - 4}
                        textAnchor="middle"
                        className="fill-foreground text-[10px] font-mono font-semibold"
                        style={{ paintOrder: "stroke", stroke: "oklch(0.15 0.015 250)", strokeWidth: 3 }}
                      >
                        {r.net > 0 ? "+" : ""}{fmtNum(r.net, 1)} €
                      </text>
                    )}
                  </g>
                );
              })}

              {/* nodes */}
              {Object.values(ZONES).map(z => {
                const p = zoneAvg[z.code];
                const isRS = z.code === "RS";
                const fill = priceColor(p);
                return (
                  <g key={z.code}>
                    {isRS && <circle cx={z.x} cy={z.y} r="26" fill="none" stroke="var(--color-primary)" strokeWidth="1" strokeOpacity="0.5" filter="url(#glow)" />}
                    <circle
                      cx={z.x} cy={z.y} r={isRS ? 20 : 17}
                      fill={fill}
                      fillOpacity={p != null ? 0.85 : 0.25}
                      stroke={isRS ? "var(--color-primary)" : "oklch(0.85 0 0 / 0.3)"}
                      strokeWidth={isRS ? 2.5 : 1.5}
                    />
                    <text x={z.x} y={z.y + 4} textAnchor="middle"
                      className="fill-white text-[11px] font-bold"
                      style={{ paintOrder: "stroke", stroke: "oklch(0.15 0.015 250)", strokeWidth: 2 }}>
                      {z.code}
                    </text>
                    <text x={z.x} y={z.y - 24} textAnchor="middle"
                      className="fill-muted-foreground text-[9px] uppercase tracking-wider">
                      {z.name}
                    </text>
                    {p != null && (
                      <text x={z.x} y={z.y + 34} textAnchor="middle"
                        className="fill-foreground text-[10px] font-mono font-semibold"
                        style={{ paintOrder: "stroke", stroke: "oklch(0.15 0.015 250)", strokeWidth: 2.5 }}>
                        €{p.toFixed(0)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </Panel>

          <div className="space-y-4">
            <Panel title={sel ? `${ZONES[sel.from].name} → ${ZONES[sel.to].name}` : "Route details"}>
              {sel ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${sel.kind === "import" ? "bg-info/15 text-info" : "bg-warning/15 text-warning"}`}>
                      {sel.kind}
                    </span>
                    <DataBadge source={sel.capSource} />
                  </div>
                  <Row label={`${sel.from} price`} value={fmtPrice(sel.srcPrice)} />
                  <Row label={`${sel.to} price`} value={fmtPrice(sel.dstPrice)} />
                  <Row label="Spread" value={`${sel.spread > 0 ? "+" : ""}${fmtNum(sel.spread, 2)} €/MWh`} />
                  <Row label="Capacity cost" value={fmtPrice(sel.cap)} muted />
                  <div className="flex justify-between pt-2 border-t border-border/60">
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Net margin</span>
                    <span className={`num font-bold ${sel.net > 0 ? "text-success" : "text-destructive"}`}>
                      {sel.net > 0 ? "+" : ""}{fmtNum(sel.net, 2)} €/MWh
                    </span>
                  </div>
                  <Row label="Avg flow" value={fmtMW(sel.flowAvg)} />
                  <Row label="Peak flow" value={fmtMW(sel.flowMax)} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click any line on the map to inspect price spread, capacity cost, observed flow and net margin.
                </p>
              )}
            </Panel>

            <Panel title={<span className="flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" />Top opportunities</span>} dense>
              <div className="space-y-1">
                {topOpportunities.map(r => {
                  const id = `${r.from}_${r.to}`;
                  return (
                    <button
                      key={id}
                      onClick={() => setSelected(id)}
                      onMouseEnter={() => setHover(id)}
                      onMouseLeave={() => setHover(null)}
                      className={`w-full flex items-center justify-between text-xs px-2 py-1.5 rounded hover:bg-surface-2 transition-colors ${selected === id ? "bg-surface-2" : ""}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {r.kind === "import"
                          ? <ArrowDownRight className="w-3 h-3 text-info" />
                          : <ArrowUpRight className="w-3 h-3 text-warning" />}
                        <span className="font-mono">{r.from} → {r.to}</span>
                      </span>
                      <span className={`num font-semibold ${r.net > 0 ? "text-success" : "text-destructive"}`}>
                        {r.net > 0 ? "+" : ""}{fmtNum(r.net, 1)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>
        </div>

        <Panel title={<span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />All cross-border routes</span>}>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left py-1.5">Route</th>
                <th className="text-left">Kind</th>
                <th className="text-right">Src €/MWh</th>
                <th className="text-right">Dst €/MWh</th>
                <th className="text-right">Spread</th>
                <th className="text-right">Capacity</th>
                <th className="text-right">Net</th>
                <th className="text-right">Avg flow</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].sort((a, b) => b.net - a.net).map(r => {
                const id = `${r.from}_${r.to}`;
                return (
                  <tr
                    key={id}
                    onClick={() => setSelected(id)}
                    onMouseEnter={() => setHover(id)}
                    onMouseLeave={() => setHover(null)}
                    className={`border-t border-border/60 cursor-pointer hover:bg-surface-2/60 ${selected === id ? "bg-surface-2/80" : ""}`}
                  >
                    <td className="py-1.5 font-mono">{r.from} → {r.to}</td>
                    <td className={r.kind === "import" ? "text-info" : "text-warning"}>{r.kind}</td>
                    <td className="text-right num">{fmtNum(r.srcPrice, 1)}</td>
                    <td className="text-right num">{fmtNum(r.dstPrice, 1)}</td>
                    <td className="text-right num">{r.spread > 0 ? "+" : ""}{fmtNum(r.spread, 1)}</td>
                    <td className="text-right num text-muted-foreground">{fmtNum(r.cap, 2)}</td>
                    <td className={`text-right num font-semibold ${r.net > 0 ? "text-success" : "text-destructive"}`}>
                      {r.net > 0 ? "+" : ""}{fmtNum(r.net, 2)}
                    </td>
                    <td className="text-right num text-muted-foreground">{fmtMW(r.flowAvg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`num ${muted ? "text-muted-foreground" : ""}`}>{value}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: "oklch(0.72 0.18 145)" }} /> profitable</span>
      <span className="flex items-center gap-1"><span className="w-3 h-0.5" style={{ background: "oklch(0.62 0.20 25)" }} /> loss</span>
      <span className="flex items-center gap-1">
        <span className="w-3 h-3 rounded-full" style={{ background: "linear-gradient(90deg, oklch(0.62 0.18 220), oklch(0.62 0.18 20))" }} />
        cheap → expensive
      </span>
    </div>
  );
}
