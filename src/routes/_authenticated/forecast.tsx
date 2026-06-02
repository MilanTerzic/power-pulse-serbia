import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { runForecastV2 } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Area, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { fmtPrice, fmtNum } from "@/lib/format";
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/forecast")({
  head: () => ({ meta: [{ title: "SEEPEX Forecast — SEE Trading Desk" }] }),
  component: ForecastPage,
});

type Product = "da" | "week" | "month";
type LoadType = "baseload" | "peak" | "offpeak";
type HistoryPreset = "2024" | "365" | "180" | "90" | "custom";

const HORIZON_OPTIONS: Record<Product, { value: string; label: string }[]> = {
  da:    [{ value: "24", label: "1 day" }, { value: "72", label: "3 days" }, { value: "168", label: "7 days" }, { value: "336", label: "14 days" }],
  week:  [{ value: "1", label: "next week" }, { value: "2", label: "next 2 weeks" }, { value: "4", label: "next 4 weeks" }],
  month: [{ value: "1", label: "next month" }, { value: "3", label: "next 3 months" }, { value: "6", label: "next 6 months" }],
};

function presetToDate(p: HistoryPreset): string {
  if (p === "2024") return "2024-01-01";
  const days = p === "365" ? 365 : p === "180" ? 180 : 90;
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

function ForecastPage() {
  const fn = useServerFn(runForecastV2);
  const [product, setProduct] = useState<Product>("da");
  const [horizon, setHorizon] = useState("24");
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>("2024");
  const [customFrom, setCustomFrom] = useState("2024-01-01");
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [loadType, setLoadType] = useState<LoadType>("baseload");
  const [backtestDate, setBacktestDate] = useState("");

  // reset horizon when product changes
  const onProduct = (p: Product) => {
    setProduct(p);
    setHorizon(HORIZON_OPTIONS[p][0].value);
  };

  const m = useMutation({
    mutationFn: () => fn({ data: {
      product, horizon: parseInt(horizon),
      history_from: historyPreset === "custom" ? customFrom : presetToDate(historyPreset),
      history_to: backtestDate || (historyPreset === "custom" ? customTo : undefined),
      load_type: loadType,
      use_fundamentals: true,
    } }),
  });

  const data = m.data;
  const lastRefresh = data ? new Date().toLocaleString("en-GB") : "—";

  const chartData = useMemo(() => {
    if (!data) return [];
    const histTail = data.history.slice(-Math.min(data.history.length, product === "da" ? 24 * 14 : 365));
    const histPts = histTail.map(h => ({
      ts: h.ts, t: new Date(h.ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: product === "da" ? "2-digit" : undefined }),
      actual: h.price,
    }));
    const fcPts = data.forecast.map(p => ({
      ts: p.ts, t: new Date(p.ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: product === "da" ? "2-digit" : undefined }),
      forecast: p.forecast, blended: p.blended, band: [p.lo80, p.hi80],
    }));
    return [...histPts, ...fcPts];
  }, [data, product]);

  return (
    <>
      <TopBar title="SEEPEX Forecast" subtitle="Multi-product cascade: DA hourly · Week ahead · Month ahead — ARIMA + EEX anchor + fundamentals" />
      <div className="p-6 space-y-5">
        <Panel title="Forecast controls" actions={<span className="text-[10px] text-muted-foreground">Last run: {lastRefresh}</span>}>
          <div className="grid md:grid-cols-6 gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Product</Label>
              <Select value={product} onValueChange={(v) => onProduct(v as Product)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="da">DA hourly</SelectItem>
                  <SelectItem value="week">Week ahead</SelectItem>
                  <SelectItem value="month">Month ahead</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Horizon</Label>
              <Select value={horizon} onValueChange={setHorizon}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {HORIZON_OPTIONS[product].map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">History window</Label>
              <Select value={historyPreset} onValueChange={(v) => setHistoryPreset(v as HistoryPreset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2024">From 01.01.2024</SelectItem>
                  <SelectItem value="365">Last 365 days</SelectItem>
                  <SelectItem value="180">Last 180 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Load type</Label>
              <Select value={loadType} onValueChange={(v) => setLoadType(v as LoadType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baseload">Baseload</SelectItem>
                  <SelectItem value="peak">Peak (08–20 CET, Mon–Fri)</SelectItem>
                  <SelectItem value="offpeak">Off-peak</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Backtest cutoff (optional)</Label>
              <Input type="date" value={backtestDate} onChange={e => setBacktestDate(e.target.value)} placeholder="" />
            </div>
            <Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "Forecasting…" : "Run forecast"}</Button>
          </div>
          {historyPreset === "custom" && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="space-y-1.5"><Label className="text-xs">From</Label><Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">To</Label><Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} /></div>
            </div>
          )}
        </Panel>

        {m.error && <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded p-3">{(m.error as Error).message}</div>}

        {data && data.error && <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded p-3">{data.error}</div>}

        {data && !data.error && <ForecastResults data={data} chartData={chartData} product={product} backtestDate={backtestDate} />}
      </div>
    </>
  );
}

type ForecastData = NonNullable<ReturnType<typeof useMutation<Awaited<ReturnType<typeof runForecastV2>>>>["data"]>;

function ForecastResults({ data, chartData, product, backtestDate }: {
  data: ForecastData; chartData: Array<Record<string, unknown>>; product: Product; backtestDate: string;
}) {
  const fc = data.forecast ?? [];
  const blendedMean = fc.length ? fc.reduce((a, p) => a + (p.blended ?? p.forecast), 0) / fc.length : null;
  const statMean = fc.length ? fc.reduce((a, p) => a + p.forecast, 0) / fc.length : null;
  const latest = data.latest_actual;
  const diff = blendedMean != null && latest ? blendedMean - latest.price : null;
  const peak = fc.length ? Math.max(...fc.map(p => p.blended ?? p.forecast)) : null;
  const trough = fc.length ? Math.min(...fc.map(p => p.blended ?? p.forecast)) : null;
  const eexBadge = data.eex.source === "live" ? { cls: "border-success/40 text-success", label: "EEX LIVE" }
    : data.eex.source === "cache" ? { cls: "border-info/40 text-info", label: "EEX CACHE" }
    : { cls: "border-warning/40 text-warning", label: "EEX UNAVAILABLE" };

  // Backtest comparison if cutoff is set & cutoff in the past
  const backtestRow = backtestDate ? data.forecast[0] : null;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Forecast (blended avg)" value={fmtPrice(blendedMean)} sub={`${product.toUpperCase()} · ${data.loadType}`} accent="primary" />
        <KPI label="Latest SEEPEX actual" value={fmtPrice(latest?.price ?? null)} sub={latest ? new Date(latest.ts).toLocaleString("en-GB") : "—"} />
        <KPI label="EEX anchor" value={data.eex_anchor != null ? fmtPrice(data.eex_anchor) : <span className="text-muted-foreground">n/a</span>}
          sub={<Badge variant="outline" className={`${eexBadge.cls} font-mono text-[10px]`}>{eexBadge.label}</Badge>} accent="info" />
        <KPI label="Δ vs latest" value={<span className={diff == null ? "" : diff >= 0 ? "text-success" : "text-destructive"}>{diff == null ? "—" : `${diff >= 0 ? "+" : ""}${fmtNum(diff, 2)}`}</span>} sub="€/MWh" />
        <KPI label="Range" value={trough != null && peak != null ? `${fmtNum(trough, 1)} – ${fmtNum(peak, 1)}` : "—"} sub="€/MWh" />
      </div>

      {data.warnings.length > 0 && (
        <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded p-3 space-y-1">
          {data.warnings.map((w, i) => <div key={i} className="flex items-start gap-2"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /><span>{w}</span></div>)}
        </div>
      )}

      <Panel title={`Forecast chart — ${product === "da" ? "hourly DA" : product === "week" ? "weekly" : "monthly"} (${data.loadType})`}>
        <div className="h-96">
          <ResponsiveContainer>
            <ComposedChart data={chartData}>
              <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke="var(--color-muted-foreground)" fontSize={10} minTickGap={30} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" €" domain={["auto", "auto"]} />
              <Tooltip contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area dataKey="band" stroke="none" fill="hsl(180 65% 50%)" fillOpacity={0.12} name="80% CI" />
              <Line dataKey="actual" stroke="hsl(220 90% 60%)" dot={false} strokeWidth={1.5} name="SEEPEX actual" />
              <Line dataKey="forecast" stroke="hsl(180 65% 50%)" dot={false} strokeWidth={2} strokeDasharray="4 4" name="Statistical forecast" />
              <Line dataKey="blended" stroke="hsl(30 95% 55%)" dot={false} strokeWidth={2} name="Blended forecast" />
              {data.eex_anchor != null && (
                <ReferenceLine y={data.eex_anchor} stroke="hsl(140 70% 50%)" strokeDasharray="5 5" label={{ value: `EEX ${product}`, position: "right", fill: "hsl(140 70% 50%)", fontSize: 10 }} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[10px] text-muted-foreground mt-2 flex gap-4 flex-wrap">
          <span>Weights — stat: {(data.weights.stat * 100).toFixed(0)}% · EEX: {(data.weights.eex * 100).toFixed(0)}% · fundamentals: {(data.weights.fund * 100).toFixed(0)}%</span>
          <span>Fundamental adj: {data.fundamental_adj >= 0 ? "+" : ""}{fmtNum(data.fundamental_adj, 2)} €/MWh</span>
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Driver analysis">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left py-1.5">Driver</th><th>Value</th><th>Trend</th><th>Impact</th></tr>
            </thead>
            <tbody>
              {data.drivers.map(d => (
                <tr key={d.key} className="border-t border-border/60 align-top">
                  <td className="py-1.5">
                    <div className="font-medium">{d.label}</div>
                    <div className="text-[11px] text-muted-foreground">{d.explain}</div>
                  </td>
                  <td className="num text-xs">{d.value}</td>
                  <td>
                    {d.trend === "up" ? <TrendingUp className="w-4 h-4 text-warning" />
                      : d.trend === "down" ? <TrendingDown className="w-4 h-4 text-info" />
                      : <Minus className="w-4 h-4 text-muted-foreground" />}
                  </td>
                  <td>
                    <Badge variant="outline" className={`font-mono text-[10px] ${
                      d.impact === "bullish" ? "bg-success/15 text-success border-success/30"
                        : d.impact === "bearish" ? "bg-destructive/15 text-destructive border-destructive/30"
                        : "bg-muted/40 text-muted-foreground border-muted"}`}>
                      {d.impact.toUpperCase()}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Model diagnostics">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-[10px] uppercase text-muted-foreground">Model</div><div className="font-mono">{data.diagnostics?.model ?? "—"}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Statistical confidence</div><div className="font-mono">{data.diagnostics?.stat_confidence ?? "—"}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Training points</div><div className="font-mono num">{data.diagnostics?.training_points ?? "—"}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">History range</div><div className="font-mono text-xs">{data.diagnostics?.history_from} → {data.diagnostics?.history_to}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Backtest MAE</div><div className="font-mono num">{data.diagnostics?.mae != null ? `${fmtNum(data.diagnostics.mae, 2)} €/MWh` : "—"}</div></div>
            <div><div className="text-[10px] uppercase text-muted-foreground">Backtest MAPE</div><div className="font-mono num">{data.diagnostics?.mape != null ? `${fmtNum(data.diagnostics.mape, 1)}%` : "—"}</div></div>
            <div className="col-span-2">
              <div className="text-[10px] uppercase text-muted-foreground mb-1">EEX status</div>
              <div className="text-xs">
                <Badge variant="outline" className={`${eexBadge.cls} font-mono text-[10px] mr-2`}>{eexBadge.label}</Badge>
                <span className="text-muted-foreground">{data.eex.reason ?? `${data.eex.prices.length} products parsed`}</span>
              </div>
            </div>
            {data.diagnostics?.fallback_used && (
              <div className="col-span-2 text-[11px] text-warning flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5" /> Fallback model used due to limited or low-quality history.
              </div>
            )}
          </div>
        </Panel>
      </div>

      {backtestDate && backtestRow && (
        <Panel title={`Backtest — forecast made on ${backtestDate}`}>
          <div className="text-sm grid md:grid-cols-3 gap-3">
            <KPI label="Forecast (blended)" value={fmtPrice(backtestRow.blended ?? backtestRow.forecast)} sub={`for ${new Date(backtestRow.ts).toLocaleDateString("en-GB")}`} accent="primary" />
            <KPI label="Forecast (statistical)" value={fmtPrice(backtestRow.forecast)} sub="model only" />
            <KPI label="80% confidence band" value={`${fmtNum(backtestRow.lo80, 1)} – ${fmtNum(backtestRow.hi80, 1)}`} sub="€/MWh" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            To verify against actuals, set the cutoff date and compare the first forecast point with the realised SEEPEX print for the next period.
          </p>
        </Panel>
      )}
    </>
  );
}
