import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCBCComparison, getResalePnL, getMonthlyResaleBreakdown,
  listPositions, upsertPosition, deletePosition,
} from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { DataBadge } from "@/components/data-badge";
import { fmtPrice, fmtEur, fmtMW, fmtNum, downloadCSV } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState, useEffect, useRef, useMemo } from "react";
import { Plus, Trash2, Pencil, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useDateRange } from "@/lib/date-range";

export const Route = createFileRoute("/_authenticated/cbc")({
  head: () => ({ meta: [{ title: "CBC Capacity Resale — SEE Trading Desk" }] }),
  component: CBCPage,
});

function CBCPage() {
  return (
    <>
      <TopBar title="CBC Capacity Resale" subtitle="Annual vs Monthly vs Daily — per-month resell PnL & recommendations" />
      <div className="p-6">
        <Tabs defaultValue="pnl">
          <TabsList>
            <TabsTrigger value="pnl">Resale PnL</TabsTrigger>
            <TabsTrigger value="comparison">Comparison</TabsTrigger>
            <TabsTrigger value="predictor">Predictor</TabsTrigger>
            <TabsTrigger value="manual">Manual Inputs</TabsTrigger>
            <TabsTrigger value="diag">Diagnostics</TabsTrigger>
          </TabsList>
          <TabsContent value="pnl" className="mt-4"><PnLBreakdown /></TabsContent>
          <TabsContent value="comparison" className="mt-4"><Comparison /></TabsContent>
          <TabsContent value="predictor" className="mt-4"><Predictor /></TabsContent>
          <TabsContent value="manual" className="mt-4"><Manual /></TabsContent>
          <TabsContent value="diag" className="mt-4"><Diag /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}

// ============================================================================
// Resale PnL — per-position monthly breakdown with persisted strategy & ARIMA
// ============================================================================

type SellAs = "monthly" | "daily" | "annual" | "";

const STORAGE_KEY = "cbc_sell_as_v1";

// Default strategy per border (from screenshot), Jan..Jun 2026 only.
const DEFAULT_STRATEGY: Record<string, Record<string, SellAs>> = {
  "HR_BA_2026": { "1": "monthly", "2": "monthly", "3": "daily", "4": "monthly", "5": "daily", "6": "monthly" },
  "BA_ME_2026": { "1": "monthly", "2": "monthly", "3": "daily", "4": "daily",   "5": "daily", "6": "daily" },
  "BA_MNE_2026": { "1": "monthly", "2": "monthly", "3": "daily", "4": "daily",   "5": "daily", "6": "daily" },
};

function loadStored(): Record<string, Record<string, SellAs>> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveStored(v: Record<string, Record<string, SellAs>>) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* noop */ }
}

function posDefaultKey(pos: { from: string; to: string; year: number }) {
  return `${pos.from}_${pos.to}_${pos.year}`;
}

// Lightweight AR(1) + drift forecast. Returns mean forecast and confidence label.
function arimaLikeForecast(history: number[], stepsAhead: number): { forecast: number | null; confidence: "low" | "medium" | "high" | "none" } {
  const xs = history.filter(v => Number.isFinite(v));
  if (xs.length < 2) return { forecast: xs[xs.length - 1] ?? null, confidence: xs.length === 1 ? "low" : "none" };
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 1; i < n; i++) { num += (xs[i] - mean) * (xs[i - 1] - mean); den += (xs[i - 1] - mean) ** 2; }
  const phi = den > 0 ? Math.max(-0.95, Math.min(0.95, num / den)) : 0;
  const driftPerStep = (xs[n - 1] - xs[0]) / (n - 1);
  let prev = xs[n - 1];
  let f = prev;
  for (let s = 0; s < stepsAhead; s++) {
    f = mean + phi * (prev - mean) + driftPerStep * 0.5;
    prev = f;
  }
  const conf = n >= 12 ? "high" : n >= 6 ? "medium" : "low";
  return { forecast: f, confidence: conf };
}

function PnLBreakdown() {
  const fn = useServerFn(getMonthlyResaleBreakdown);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["cbc_breakdown", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });

  const [sellAs, setSellAs] = useState<Record<string, Record<string, SellAs>>>(() => loadStored());
  useEffect(() => { saveStored(sellAs); }, [sellAs]);

  const positions = q.data?.positions ?? [];

  // Seed defaults once per position (only Jan..Jun for known borders).
  const seededRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!positions.length) return;
    let changed = false;
    const next = { ...sellAs };
    for (const pos of positions) {
      const key = posDefaultKey(pos);
      if (seededRef.current.has(key)) continue;
      seededRef.current.add(key);
      const defaults = DEFAULT_STRATEGY[key];
      if (!defaults) continue;
      const cur = { ...(next[key] ?? {}) };
      for (const [m, v] of Object.entries(defaults)) {
        if (cur[m] == null || cur[m] === "") { cur[m] = v; changed = true; }
      }
      next[key] = cur;
    }
    if (changed) setSellAs(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);

  const getMode = (pos: PosForCard, month: number): SellAs =>
    (sellAs[posDefaultKey(pos)]?.[String(month)] as SellAs) ?? "";
  const setMode = (pos: PosForCard, month: number, mode: SellAs) =>
    setSellAs(s => {
      const k = posDefaultKey(pos);
      return { ...s, [k]: { ...(s[k] ?? {}), [String(month)]: mode } };
    });

  const todayKey = (() => { const d = new Date(); return d.getFullYear() * 100 + (d.getMonth() + 1); })();

  const agg = useMemo(() => {
    let totalPnL = 0; let calculated = 0; let missing = 0;
    for (const pos of positions) {
      for (const row of pos.rows) {
        const mode = getMode(pos, row.month);
        if (!mode) { missing++; continue; }
        let price: number | null = null;
        if (mode === "monthly") price = row.monthly_price;
        else if (mode === "daily") price = row.daily_price;
        else if (mode === "annual") price = pos.annual_current_price;
        if (price == null) { missing++; continue; }
        totalPnL += (price - pos.annual_booked_price) * pos.booked_mw * row.hours;
        calculated++;
      }
    }
    return { totalPnL, calculated, missing };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, sellAs]);

  const predictions = useMemo(() => {
    const out: Record<string, Rec[]> = {};
    for (const pos of positions) {
      const histM: number[] = [];
      const histD: number[] = [];
      for (const r of pos.rows) {
        const k = r.year * 100 + r.month;
        if (k < todayKey) {
          if (r.monthly_price != null) histM.push(r.monthly_price);
          if (r.daily_price != null) histD.push(r.daily_price);
        }
      }
      const recs: Rec[] = [];
      let step = 1;
      for (const r of pos.rows) {
        const k = r.year * 100 + r.month;
        if (k < todayKey) continue;
        const fm = arimaLikeForecast(histM, step);
        const fd = arimaLikeForecast(histD, step);
        const pnl_m = fm.forecast == null ? null : (fm.forecast - pos.annual_booked_price) * pos.booked_mw * r.hours;
        const pnl_d = fd.forecast == null ? null : (fd.forecast - pos.annual_booked_price) * pos.booked_mw * r.hours;
        let rec: Rec["rec"] = "none";
        if (pnl_m != null && pnl_d != null) rec = pnl_m >= pnl_d ? "monthly" : "daily";
        else if (pnl_m != null) rec = "monthly";
        else if (pnl_d != null) rec = "daily";
        const conf = fm.confidence === "none" && fd.confidence === "none" ? "none" :
          fm.confidence === "high" || fd.confidence === "high" ? "high" :
          fm.confidence === "medium" || fd.confidence === "medium" ? "medium" : "low";
        recs.push({ month: r.month, monthly_fcst: fm.forecast, daily_fcst: fd.forecast, pnl_m, pnl_d, rec, conf });
        step++;
      }
      out[posDefaultKey(pos)] = recs;
    }
    return out;
  }, [positions, todayKey]);

  const applyRecForPos = (pos: PosForCard) => {
    const recs = predictions[posDefaultKey(pos)] ?? [];
    setSellAs(s => {
      const k = posDefaultKey(pos);
      const cur = { ...(s[k] ?? {}) };
      for (const r of recs) {
        if (r.rec === "none") continue;
        const m = String(r.month);
        if (!cur[m]) cur[m] = r.rec;
      }
      return { ...s, [k]: cur };
    });
    toast.success("Applied ARIMA recommendations to empty months");
  };

  const rangeLabel = range.from === range.to ? range.from : `${range.from} → ${range.to}`;
  const posSummary = positions.map(p => `${p.from}→${p.to} ${fmtNum(p.booked_mw, 0)} MW`).join(", ") || "—";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Portfolio PnL"
          value={<span className={agg.totalPnL >= 0 ? "text-success" : "text-destructive"}>{fmtEur(agg.totalPnL, 0)}</span>}
          sub={`EUR · ${rangeLabel}`} accent={agg.totalPnL >= 0 ? "success" : "destructive"} />
        <KPI label="Positions" value={positions.length} sub={posSummary} accent="info" />
        <KPI label="Calculated rows" value={agg.calculated}
          sub={agg.missing ? `${agg.missing} unselected / missing price` : "All months priced"}
          accent={agg.missing ? "warning" : "success"} />
        <KPI label="Formula" value={<span className="text-base font-mono">spread × MW × h</span>}
          sub="spread = selected resale − annual booked" accent="muted" />
      </div>

      {q.isLoading && <Panel title="Loading…"><div className="text-sm text-muted-foreground py-3">Fetching positions and prices…</div></Panel>}

      {!q.isLoading && positions.length === 0 && (
        <Panel title="No positions">
          <div className="text-sm text-muted-foreground py-3">Add positions in <span className="font-medium">Manual Inputs</span> to see monthly resale PnL.</div>
        </Panel>
      )}

      {positions.length > 0 && <StrategyMatrix positions={positions} getMode={getMode} />}

      {positions.map(pos => (
        <PositionBreakdownCard
          key={pos.position_id}
          pos={pos}
          getMode={(m) => getMode(pos, m)}
          setMode={(m, mode) => setMode(pos, m, mode)}
          predictions={predictions[posDefaultKey(pos)] ?? []}
          todayKey={todayKey}
          onApplyAll={() => applyRecForPos(pos)}
        />
      ))}
    </div>
  );
}

function StrategyMatrix({ positions, getMode }: { positions: PosForCard[]; getMode: (pos: PosForCard, m: number) => SellAs }) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthLabels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const badge = (m: SellAs) => {
    if (!m) return <span className="text-muted-foreground/50 text-[10px]">—</span>;
    const cls = m === "monthly" ? "bg-info/15 text-info border-info/30"
      : m === "daily" ? "bg-success/15 text-success border-success/30"
      : "bg-warning/15 text-warning border-warning/30";
    return <Badge variant="outline" className={`${cls} text-[10px] font-mono px-1.5 py-0`}>{m[0].toUpperCase()}</Badge>;
  };
  return (
    <Panel title="Selected Resale Method">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr><th className="text-left py-1.5 pr-3">Border</th>{months.map(m => <th key={m} className="text-center px-1">{monthLabels[m-1]}</th>)}</tr>
          </thead>
          <tbody>
            {positions.map(pos => {
              const rowMonths = new Set(pos.rows.map(r => r.month));
              return (
                <tr key={pos.position_id} className="border-t border-border/60">
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{pos.label}</td>
                  {months.map(m => (
                    <td key={m} className="text-center px-1 py-1">
                      {rowMonths.has(m) ? badge(getMode(pos, m)) : <span className="text-muted-foreground/30">·</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-2 text-[10px] text-muted-foreground flex gap-3 flex-wrap">
          <span><Badge variant="outline" className="bg-info/15 text-info border-info/30 px-1.5 py-0 font-mono text-[10px]">M</Badge> Monthly</span>
          <span><Badge variant="outline" className="bg-success/15 text-success border-success/30 px-1.5 py-0 font-mono text-[10px]">D</Badge> Daily</span>
          <span><Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 px-1.5 py-0 font-mono text-[10px]">A</Badge> Annual</span>
          <span>— Not selected</span>
        </div>
      </div>
    </Panel>
  );
}

interface PosForCard {
  position_id: string; label: string; from: string; to: string;
  booked_mw: number; annual_booked_price: number;
  annual_current_price: number | null; source_annual: string;
  year: number; start_date: string; end_date: string;
  rows: Array<{
    year: number; month: number; monthLabel: string;
    date_from: string; date_to: string; hours: number;
    monthly_price: number | null; daily_price: number | null;
    source_monthly: string; source_daily: string;
  }>;
}

type Rec = { month: number; monthly_fcst: number | null; daily_fcst: number | null; pnl_m: number | null; pnl_d: number | null; rec: "monthly" | "daily" | "none"; conf: "low" | "medium" | "high" | "none" };

function PositionBreakdownCard({
  pos, getMode, setMode, predictions, todayKey, onApplyAll,
}: {
  pos: PosForCard;
  getMode: (m: number) => SellAs;
  setMode: (m: number, mode: SellAs) => void;
  predictions: Rec[];
  todayKey: number;
  onApplyAll: () => void;
}) {
  const recByMonth = useMemo(() => {
    const m: Record<number, Rec> = {};
    for (const p of predictions) m[p.month] = p;
    return m;
  }, [predictions]);

  const rowsResolved = pos.rows.map(r => {
    const mode = getMode(r.month);
    let price: number | null = null;
    if (mode === "monthly") price = r.monthly_price;
    else if (mode === "daily") price = r.daily_price;
    else if (mode === "annual") price = pos.annual_current_price;
    const spread = (!mode || price == null) ? null : price - pos.annual_booked_price;
    const pnl = spread == null ? null : spread * pos.booked_mw * r.hours;
    const isFuture = (r.year * 100 + r.month) >= todayKey;
    return { ...r, mode, price, spread, pnl, isFuture, rec: recByMonth[r.month] };
  });
  const subTotal = rowsResolved.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const missing = rowsResolved.filter(r => r.pnl == null).length;

  const csvRows = rowsResolved.map(r => ({
    month: `${r.year}-${String(r.month).padStart(2, "0")}`,
    date_from: r.date_from, date_to: r.date_to, hours: r.hours,
    annual_booked: pos.annual_booked_price,
    sell_as: r.mode || "unselected",
    monthly: r.monthly_price ?? "",
    daily: r.daily_price ?? "",
    annual_current: pos.annual_current_price ?? "",
    spread: r.spread ?? "",
    pnl_eur: r.pnl ?? "",
    arima_rec: r.rec?.rec ?? "",
  }));

  const hasFutureRec = rowsResolved.some(r => r.isFuture && r.rec && r.rec.rec !== "none" && !r.mode);

  return (
    <Panel
      title={
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium">{pos.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {pos.from} → {pos.to} · {fmtNum(pos.booked_mw, 1)} MW booked annual capacity · annual ref {fmtPrice(pos.annual_booked_price)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">{pos.year}</Badge>
            <Badge variant="outline" className={`font-mono text-[10px] ${subTotal >= 0 ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}`}>
              {fmtEur(subTotal, 0)}
            </Badge>
            {hasFutureRec && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onApplyAll}>
                Apply ARIMA to empty months
              </Button>
            )}
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV(`pnl-${pos.from}-${pos.to}.csv`, csvRows as never)}>
              <Download className="w-3.5 h-3.5" />CSV
            </Button>
          </div>
        </div>
      }
    >
      {missing > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-warning bg-warning/10 border border-warning/30 rounded p-2 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />
          <span>{missing} of {rowsResolved.length} months have no PnL — strategy not selected or required price missing.</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left py-1.5 pr-2">Month</th>
              <th className="text-right">Hours</th>
              <th className="text-right">Annual</th>
              <th className="text-left pl-2">Sell as</th>
              <th className="text-right">Monthly</th>
              <th className="text-right">Daily</th>
              <th className="text-right">Spread</th>
              <th className="text-right">PnL EUR</th>
              <th className="text-left pl-3">ARIMA</th>
            </tr>
          </thead>
          <tbody>
            {rowsResolved.map(r => {
              const spreadCls = r.spread == null ? "text-muted-foreground" : r.spread >= 0 ? "text-success" : "text-destructive";
              const pnlCls = r.pnl == null ? "text-muted-foreground" : r.pnl >= 0 ? "text-success" : "text-destructive";
              return (
                <tr key={`${r.year}-${r.month}`} className="border-t border-border/60">
                  <td className="py-1.5 pr-2 font-medium">{r.monthLabel} {r.year}</td>
                  <td className="text-right num">{r.hours}</td>
                  <td className="text-right num">{fmtPrice(pos.annual_booked_price)}</td>
                  <td className="pl-2">
                    <Select value={r.mode || "unset"} onValueChange={v => setMode(r.month, v === "unset" ? "" : (v as SellAs))}>
                      <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">Select strategy</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="annual">Annual</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className={`text-right num ${r.monthly_price == null ? "text-muted-foreground" : ""}`}>
                    {r.monthly_price == null ? "—" : fmtNum(r.monthly_price, 4)}
                  </td>
                  <td className={`text-right num ${r.daily_price == null ? "text-muted-foreground" : ""}`}>
                    {r.daily_price == null ? "—" : fmtNum(r.daily_price, 4)}
                  </td>
                  <td className={`text-right num font-medium ${spreadCls}`}>
                    {r.spread == null ? "—" : fmtNum(r.spread, 4)}
                  </td>
                  <td className={`text-right num font-semibold ${pnlCls}`}>
                    {r.pnl == null ? "—" : fmtEur(r.pnl, 0)}
                  </td>
                  <td className="pl-3 text-[10px]">
                    {r.isFuture && r.rec && r.rec.rec !== "none" ? (
                      <PredictorCell r={r.rec} onApply={() => setMode(r.month, r.rec!.rec as SellAs)} active={r.mode === r.rec.rec} />
                    ) : r.isFuture ? <span className="text-muted-foreground/60">Insufficient data</span> : <span className="text-muted-foreground/40">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={7} className="py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Subtotal</td>
              <td className={`text-right num font-semibold ${subTotal >= 0 ? "text-success" : "text-destructive"}`}>{fmtEur(subTotal, 0)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function PredictorCell({ r, onApply, active }: { r: Rec; onApply: () => void; active: boolean }) {
  const confCls = r.conf === "high" ? "border-success/40 text-success"
    : r.conf === "medium" ? "border-info/40 text-info"
    : "border-warning/40 text-warning";
  const recCls = r.rec === "monthly" ? "bg-info/15 text-info border-info/30" : "bg-success/15 text-success border-success/30";
  const delta = (r.pnl_m != null && r.pnl_d != null) ? Math.abs(r.pnl_m - r.pnl_d) : null;
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className={`${recCls} font-mono text-[10px] px-1.5 py-0`}>
        {r.rec.toUpperCase()}
      </Badge>
      <Badge variant="outline" className={`${confCls} font-mono text-[9px] px-1 py-0`}>{r.conf}</Badge>
      {delta != null && <span className="text-muted-foreground/70">Δ {fmtEur(delta, 0)}</span>}
      {!active && (
        <button onClick={onApply} className="text-[10px] text-primary hover:underline">apply</button>
      )}
    </div>
  );
}

// ============================================================================
// Comparison / Predictor / Diag (unchanged behaviour)
// ============================================================================

function Comparison() {
  const fn = useServerFn(getCBCComparison);
  const q = useQuery({ queryKey: ["cbc_cmp"], queryFn: () => fn({ data: {} }) });
  const rows = q.data?.rows ?? [];
  return (
    <Panel title="Annual vs Monthly vs Daily prices" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("cbc-comparison.csv", rows as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr><th className="text-left py-1.5">Border</th><th className="text-right">Annual</th><th className="text-right">Monthly</th><th className="text-right">Daily</th><th className="text-right">Δ Daily−Monthly</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const delta = (r.daily ?? 0) - (r.monthly ?? 0);
            return (
              <tr key={`${r.from}_${r.to}`} className="border-t border-border/60">
                <td className="py-1.5">{r.from} → {r.to}</td>
                <td className="text-right num">{fmtPrice(r.annual ?? null)}</td>
                <td className="text-right num">{fmtPrice(r.monthly ?? null)}</td>
                <td className="text-right num">{fmtPrice(r.daily ?? null)}</td>
                <td className={`text-right num font-medium ${delta > 0 ? "text-success" : "text-destructive"}`}>{fmtPrice(delta)}</td>
                <td className="text-right space-x-1">
                  {Object.entries(r.sources).map(([k, v]) => <DataBadge key={k} source={v} />)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function RecBadge({ rec }: { rec: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    resell_monthly: { label: "RESELL MONTHLY", cls: "bg-success/15 text-success border-success/30" },
    resell_daily:   { label: "RESELL DAILY",   cls: "bg-success/15 text-success border-success/30" },
    keep:           { label: "KEEP",           cls: "bg-info/15 text-info border-info/30" },
    manual:         { label: "MANUAL REVIEW",  cls: "bg-warning/15 text-warning border-warning/30" },
  };
  const v = map[rec] ?? map.manual;
  return <Badge variant="outline" className={`${v.cls} text-[10px] font-mono`}>{v.label}</Badge>;
}

function Predictor() {
  const fn = useServerFn(getMonthlyResaleBreakdown);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["cbc_breakdown", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });
  const positions = q.data?.positions ?? [];
  const todayKey = (() => { const d = new Date(); return d.getFullYear() * 100 + (d.getMonth() + 1); })();
  const monthLabels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return (
    <div className="space-y-4">
      <Panel title="Resale Strategy Predictor (ARIMA)">
        <p className="text-xs text-muted-foreground">
          AR(1)+drift forecast trained on historical monthly &amp; daily resale prices per border.
          Recommends the strategy with the higher expected PnL = (forecast − annual booked) × MW × hours.
          Confidence reflects historical point count (≥12 high, ≥6 medium, &lt;6 low).
        </p>
      </Panel>
      {positions.map(pos => {
        const histM: number[] = []; const histD: number[] = [];
        for (const r of pos.rows) {
          const k = r.year * 100 + r.month;
          if (k < todayKey) {
            if (r.monthly_price != null) histM.push(r.monthly_price);
            if (r.daily_price != null) histD.push(r.daily_price);
          }
        }
        let step = 1;
        const future = pos.rows.filter(r => (r.year * 100 + r.month) >= todayKey).map(r => {
          const fm = arimaLikeForecast(histM, step);
          const fd = arimaLikeForecast(histD, step);
          step++;
          const pnl_m = fm.forecast == null ? null : (fm.forecast - pos.annual_booked_price) * pos.booked_mw * r.hours;
          const pnl_d = fd.forecast == null ? null : (fd.forecast - pos.annual_booked_price) * pos.booked_mw * r.hours;
          let rec: "monthly" | "daily" | "none" = "none";
          if (pnl_m != null && pnl_d != null) rec = pnl_m >= pnl_d ? "monthly" : "daily";
          else if (pnl_m != null) rec = "monthly";
          else if (pnl_d != null) rec = "daily";
          const conf = (fm.confidence === "high" || fd.confidence === "high") ? "high" :
            (fm.confidence === "medium" || fd.confidence === "medium") ? "medium" :
            (fm.confidence === "none" && fd.confidence === "none") ? "none" : "low";
          return { r, fm, fd, pnl_m, pnl_d, rec, conf };
        });
        return (
          <Panel key={pos.position_id} title={`${pos.label} · forecast`}>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left py-1.5">Month</th>
                  <th className="text-right">Fcst Monthly</th>
                  <th className="text-right">Fcst Daily</th>
                  <th className="text-right">Annual booked</th>
                  <th className="text-right">Exp PnL Monthly</th>
                  <th className="text-right">Exp PnL Daily</th>
                  <th>Recommendation</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {future.map(({ r, fm, fd, pnl_m, pnl_d, rec, conf }) => {
                  const recCls = rec === "none" ? "bg-muted/40 text-muted-foreground border-muted"
                    : "bg-success/15 text-success border-success/30";
                  const confCls = conf === "high" ? "border-success/40 text-success"
                    : conf === "medium" ? "border-info/40 text-info"
                    : conf === "none" ? "border-muted text-muted-foreground"
                    : "border-warning/40 text-warning";
                  return (
                    <tr key={`${r.year}-${r.month}`} className="border-t border-border/60">
                      <td className="py-1.5">{monthLabels[r.month-1]} {r.year}</td>
                      <td className="text-right num">{fm.forecast == null ? "—" : fmtNum(fm.forecast, 4)}</td>
                      <td className="text-right num">{fd.forecast == null ? "—" : fmtNum(fd.forecast, 4)}</td>
                      <td className="text-right num">{fmtPrice(pos.annual_booked_price)}</td>
                      <td className={`text-right num ${(pnl_m ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{pnl_m == null ? "—" : fmtEur(pnl_m, 0)}</td>
                      <td className={`text-right num ${(pnl_d ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>{pnl_d == null ? "—" : fmtEur(pnl_d, 0)}</td>
                      <td><Badge variant="outline" className={`${recCls} font-mono text-[10px]`}>{rec === "none" ? "INSUFFICIENT DATA" : rec.toUpperCase()}</Badge></td>
                      <td><Badge variant="outline" className={`${confCls} font-mono text-[10px]`}>{conf}</Badge></td>
                    </tr>
                  );
                })}
                {future.length === 0 && (
                  <tr><td colSpan={8} className="text-sm text-muted-foreground py-3">No future months in the selected date range.</td></tr>
                )}
              </tbody>
            </table>
            {histM.length < 6 && histD.length < 6 && (
              <p className="text-[11px] text-warning mt-2">Fallback forecast used due to limited historical data ({histM.length}M / {histD.length}D points).</p>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

// ============================================================================
// Manual Inputs (positions CRUD)
// ============================================================================

const DEFAULT_POSITIONS = [
  { position_name: "HR → BA annual 2026", border_from: "HR", border_to: "BA", product_type: "annual", booked_mw: 15, annual_booked_price: 0.35, start_date: "2026-01-01", end_date: "2026-12-31", fees: 0, preferred_resale_mode: "auto", notes: "Seeded default" },
  { position_name: "BA → ME annual 2026", border_from: "BA", border_to: "ME", product_type: "annual", booked_mw: 5,  annual_booked_price: 3.44, start_date: "2026-01-01", end_date: "2026-12-31", fees: 0, preferred_resale_mode: "auto", notes: "Seeded default" },
];

function Manual() {
  const listFn = useServerFn(listPositions);
  const upFn = useServerFn(upsertPosition);
  const delFn = useServerFn(deletePosition);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["positions"], queryFn: () => listFn() });
  const del = useMutation({ mutationFn: (id: string) => delFn({ data: { id } }), onSuccess: () => { toast.success("Position deleted"); qc.invalidateQueries({ queryKey: ["positions"] }); qc.invalidateQueries({ queryKey: ["cbc_pnl"] }); qc.invalidateQueries({ queryKey: ["cbc_breakdown"] }); } });

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    if (q.isSuccess && (q.data?.length ?? 0) === 0) {
      seeded.current = true;
      (async () => {
        try {
          for (const p of DEFAULT_POSITIONS) await upFn({ data: p });
          qc.invalidateQueries({ queryKey: ["positions"] });
          qc.invalidateQueries({ queryKey: ["cbc_pnl"] });
          qc.invalidateQueries({ queryKey: ["cbc_breakdown"] });
        } catch (e) {
          console.warn("seed positions failed", e);
        }
      })();
    }
  }, [q.isSuccess, q.data, upFn, qc]);


  return (
    <Panel title="Portfolio positions" actions={<PositionDialog onSaved={() => { qc.invalidateQueries({ queryKey: ["positions"] }); qc.invalidateQueries({ queryKey: ["cbc_pnl"] }); qc.invalidateQueries({ queryKey: ["cbc_breakdown"] }); }} />}>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr><th className="text-left py-1.5">Name</th><th>Border</th><th>Product</th><th className="text-right">MW</th><th className="text-right">Booked €</th><th>Period</th><th>Resale mode</th><th></th></tr>
        </thead>
        <tbody>
          {(q.data ?? []).map(p => (
            <tr key={p.id} className="border-t border-border/60">
              <td className="py-1.5">{p.position_name}</td>
              <td>{p.border_from} → {p.border_to}</td>
              <td>{p.product_type}</td>
              <td className="text-right num">{fmtMW(Number(p.booked_mw))}</td>
              <td className="text-right num">{fmtPrice(Number(p.annual_booked_price))}</td>
              <td className="text-xs text-muted-foreground num">{p.start_date} → {p.end_date}</td>
              <td className="text-xs">{p.preferred_resale_mode}</td>
              <td className="text-right space-x-1">
                <PositionDialog existing={p} onSaved={() => { qc.invalidateQueries({ queryKey: ["positions"] }); qc.invalidateQueries({ queryKey: ["cbc_pnl"] }); qc.invalidateQueries({ queryKey: ["cbc_breakdown"] }); }} />
                <Button size="icon" variant="ghost" onClick={() => del.mutate(p.id)}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

interface Position { id: string; position_name: string; border_from: string; border_to: string; product_type: string; booked_mw: number | string; annual_booked_price: number | string; start_date: string; end_date: string; fees: number | string; preferred_resale_mode: string; notes?: string | null; }

function PositionDialog({ existing, onSaved }: { existing?: Position; onSaved: () => void }) {
  const upFn = useServerFn(upsertPosition);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => ({
    position_name: existing?.position_name ?? "",
    border_from: existing?.border_from ?? "HR",
    border_to: existing?.border_to ?? "BA",
    product_type: existing?.product_type ?? "annual",
    booked_mw: String(existing?.booked_mw ?? "10"),
    annual_booked_price: String(existing?.annual_booked_price ?? "0"),
    start_date: existing?.start_date ?? "2026-01-01",
    end_date: existing?.end_date ?? "2026-12-31",
    fees: String(existing?.fees ?? "0"),
    preferred_resale_mode: existing?.preferred_resale_mode ?? "auto",
    notes: existing?.notes ?? "",
  }));

  const save = async () => {
    try {
      await upFn({
        data: {
          ...(existing ? { id: existing.id } : {}),
          position_name: form.position_name,
          border_from: form.border_from,
          border_to: form.border_to,
          product_type: form.product_type,
          booked_mw: parseFloat(form.booked_mw),
          annual_booked_price: parseFloat(form.annual_booked_price),
          start_date: form.start_date,
          end_date: form.end_date,
          fees: parseFloat(form.fees),
          preferred_resale_mode: form.preferred_resale_mode,
          notes: form.notes,
        },
      });
      toast.success(existing ? "Position updated" : "Position added");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "save failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {existing
          ? <Button size="icon" variant="ghost"><Pencil className="w-3.5 h-3.5" /></Button>
          : <Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" /> Add position</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{existing ? "Edit position" : "New position"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="col-span-2 space-y-1.5"><Label>Name</Label><Input value={form.position_name} onChange={e => setForm({ ...form, position_name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>From</Label><Input value={form.border_from} onChange={e => setForm({ ...form, border_from: e.target.value.toUpperCase() })} /></div>
          <div className="space-y-1.5"><Label>To</Label><Input value={form.border_to} onChange={e => setForm({ ...form, border_to: e.target.value.toUpperCase() })} /></div>
          <div className="space-y-1.5"><Label>Product</Label>
            <Select value={form.product_type} onValueChange={v => setForm({ ...form, product_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="annual">Annual</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="daily">Daily</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Booked MW</Label><Input value={form.booked_mw} onChange={e => setForm({ ...form, booked_mw: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Booked price €/MWh</Label><Input value={form.annual_booked_price} onChange={e => setForm({ ...form, annual_booked_price: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Fees €</Label><Input value={form.fees} onChange={e => setForm({ ...form, fees: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>Start</Label><Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>End</Label><Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></div>
          <div className="col-span-2 space-y-1.5"><Label>Preferred resale</Label>
            <Select value={form.preferred_resale_mode} onValueChange={v => setForm({ ...form, preferred_resale_mode: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="auto">Auto (best PnL)</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="keep">Keep</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5"><Label>Notes</Label><Input value={form.notes ?? ""} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter><Button onClick={save}>{existing ? "Update" : "Create"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Diag() {
  const fn = useServerFn(getResalePnL);
  const q = useQuery({ queryKey: ["cbc_pnl"], queryFn: () => fn({ data: {} }) });
  const rows = q.data?.rows ?? [];
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Panel title="Single-snapshot PnL (legacy)">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr><th className="text-left py-1.5">Position</th><th className="text-right">MW</th><th className="text-right">Monthly €</th><th className="text-right">Daily €</th><th className="text-right">PnL M</th><th className="text-right">PnL D</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.position_id} className="border-t border-border/60">
                <td className="py-1.5">{r.label}</td>
                <td className="text-right num">{fmtMW(r.booked_mw)}</td>
                <td className="text-right num">{fmtPrice(r.monthly_price)}</td>
                <td className="text-right num">{fmtPrice(r.daily_price)}</td>
                <td className={`text-right num ${(r.pnl_monthly ?? 0) > 0 ? "text-success" : "text-destructive"}`}>{fmtEur(r.pnl_monthly, 0)}</td>
                <td className={`text-right num ${(r.pnl_daily ?? 0) > 0 ? "text-success" : "text-destructive"}`}>{fmtEur(r.pnl_daily, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Notes">
        <p className="text-sm text-muted-foreground">
          Monthly & annual A25 prices from ENTSO-E may be published as totals (EUR) rather than EUR/MWh depending on TSO — verify before booking.
          The Resale PnL tab fetches the latest monthly / daily / annual prices per month from ENTSO-E with caching.
        </p>
      </Panel>
    </div>
  );
}
