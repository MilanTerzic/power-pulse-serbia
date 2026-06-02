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
// Resale PnL — per-position monthly breakdown
// ============================================================================

type SellAs = "monthly" | "daily" | "annual";

function PnLBreakdown() {
  const fn = useServerFn(getMonthlyResaleBreakdown);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["cbc_breakdown", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });

  // sell-as selection: { [position_id]: { [`${year}-${month}`]: SellAs } }
  const [sellAs, setSellAs] = useState<Record<string, Record<string, SellAs>>>({});
  const positions = q.data?.positions ?? [];

  // Helper: resolve effective resale price for a row given user choice
  const resolveRow = (
    pos: (typeof positions)[number],
    row: (typeof positions)[number]["rows"][number],
    mode: SellAs,
  ) => {
    let price: number | null = null;
    if (mode === "monthly") price = row.monthly_price;
    else if (mode === "daily") price = row.daily_price;
    else if (mode === "annual") price = pos.annual_current_price;
    if (price == null) return { mode, price: null, spread: null, pnl: null };
    const spread = price - pos.annual_booked_price;
    const pnl = spread * pos.booked_mw * row.hours;
    return { mode, price, spread, pnl };
  };

  const getMode = (posId: string, key: string): SellAs =>
    sellAs[posId]?.[key] ?? "monthly";

  const setMode = (posId: string, key: string, mode: SellAs) =>
    setSellAs(s => ({ ...s, [posId]: { ...(s[posId] ?? {}), [key]: mode } }));

  // Portfolio aggregates
  const agg = useMemo(() => {
    let totalPnL = 0;
    let calculated = 0;
    let missing = 0;
    for (const pos of positions) {
      for (const row of pos.rows) {
        const mode = getMode(pos.position_id, `${row.year}-${row.month}`);
        const r = resolveRow(pos, row, mode);
        if (r.pnl == null) missing++;
        else { totalPnL += r.pnl; calculated++; }
      }
    }
    return { totalPnL, calculated, missing };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, sellAs]);

  const rangeLabel = range.from === range.to ? range.from : `${range.from} → ${range.to}`;
  const posSummary = positions.map(p => `${p.from}→${p.to} ${fmtNum(p.booked_mw, 0)} MW`).join(", ") || "—";

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI
          label="Portfolio PnL"
          value={<span className={agg.totalPnL >= 0 ? "text-success" : "text-destructive"}>{fmtEur(agg.totalPnL, 0)}</span>}
          sub={`EUR · ${rangeLabel}`}
          accent={agg.totalPnL >= 0 ? "success" : "destructive"}
        />
        <KPI
          label="Positions"
          value={positions.length}
          sub={posSummary}
          accent="info"
        />
        <KPI
          label="Calculated rows"
          value={agg.calculated}
          sub={agg.missing ? `${agg.missing} missing price rows` : "All months priced"}
          accent={agg.missing ? "warning" : "success"}
        />
        <KPI
          label="Formula"
          value={<span className="text-base font-mono">spread × MW × hours</span>}
          sub="spread = selected resale price − annual"
          accent="muted"
        />
      </div>

      {q.isLoading && <Panel title="Loading…"><div className="text-sm text-muted-foreground py-3">Fetching positions and prices…</div></Panel>}

      {!q.isLoading && positions.length === 0 && (
        <Panel title="No positions">
          <div className="text-sm text-muted-foreground py-3">Add positions in <span className="font-medium">Manual Inputs</span> to see monthly resale PnL.</div>
        </Panel>
      )}

      {/* Per-position cards */}
      {positions.map(pos => (
        <PositionBreakdownCard
          key={pos.position_id}
          pos={pos}
          modeFor={(key: string) => getMode(pos.position_id, key)}
          setModeFor={(key, mode) => setMode(pos.position_id, key, mode)}
        />
      ))}
    </div>
  );
}

function PositionBreakdownCard({
  pos, modeFor, setModeFor, resolve,
}: {
  pos: {
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
  };
  getMode: (m: SellAs) => SellAs;
  modeFor: (key: string) => SellAs;
  setModeFor: (key: string, mode: SellAs) => void;
  resolve: (pos: unknown, row: unknown, mode: SellAs) => { mode: SellAs; price: number | null; spread: number | null; pnl: number | null };
}) {
  const rowsResolved = pos.rows.map(r => {
    const mode = modeFor(`${r.year}-${r.month}`);
    const x = resolve(pos, r, mode);
    return { ...r, ...x };
  });
  const subTotal = rowsResolved.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const missing = rowsResolved.filter(r => r.pnl == null).length;

  const csvRows = rowsResolved.map(r => ({
    month: `${r.year}-${String(r.month).padStart(2, "0")}`,
    date_from: r.date_from, date_to: r.date_to, hours: r.hours,
    annual_booked: pos.annual_booked_price,
    sell_as: r.mode,
    monthly: r.monthly_price ?? "",
    daily: r.daily_price ?? "",
    annual_current: pos.annual_current_price ?? "",
    spread: r.spread ?? "",
    pnl_eur: r.pnl ?? "",
  }));

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
          <span>{missing} of {rowsResolved.length} months are missing the selected price — PnL excluded for those rows.</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left py-1.5 pr-2">Month</th>
              <th className="text-left">Date range</th>
              <th className="text-right">Hours</th>
              <th className="text-right">Annual</th>
              <th className="text-left pl-2">Sell as</th>
              <th className="text-right">Monthly</th>
              <th className="text-right">Daily</th>
              <th className="text-right">Spread</th>
              <th className="text-right">PnL EUR</th>
            </tr>
          </thead>
          <tbody>
            {rowsResolved.map(r => {
              const spreadCls = r.spread == null
                ? "text-muted-foreground"
                : r.spread >= 0 ? "text-success" : "text-destructive";
              const pnlCls = r.pnl == null
                ? "text-muted-foreground"
                : r.pnl >= 0 ? "text-success" : "text-destructive";
              return (
                <tr key={`${r.year}-${r.month}`} className="border-t border-border/60">
                  <td className="py-1.5 pr-2 font-medium">{r.monthLabel} {r.year}</td>
                  <td className="text-xs text-muted-foreground num">{r.date_from} → {r.date_to}</td>
                  <td className="text-right num">{r.hours}</td>
                  <td className="text-right num">{fmtPrice(pos.annual_booked_price)}</td>
                  <td className="pl-2">
                    <Select value={r.mode} onValueChange={v => setModeFor(`${r.year}-${r.month}`, v as SellAs)}>
                      <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
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
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={8} className="py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Subtotal</td>
              <td className={`text-right num font-semibold ${subTotal >= 0 ? "text-success" : "text-destructive"}`}>{fmtEur(subTotal, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
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
  const fn = useServerFn(getCBCComparison);
  const q = useQuery({ queryKey: ["cbc_cmp"], queryFn: () => fn({ data: {} }) });
  const rows = q.data?.rows ?? [];
  return (
    <Panel title="Predictor — daily vs monthly bias">
      <p className="text-xs text-muted-foreground mb-3">
        Heuristic: compares current monthly and daily prices vs the annual reference. The product
        with the larger positive spread vs annual is the better resell candidate today.
      </p>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr><th className="text-left py-1.5">Border</th><th className="text-right">Δ Monthly−Annual</th><th className="text-right">Δ Daily−Annual</th><th>Lean</th></tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const dm = (r.monthly ?? 0) - (r.annual ?? 0);
            const dd = (r.daily ?? 0) - (r.annual ?? 0);
            const lean = dd > dm && dd > 0 ? "daily" : dm > 0 ? "monthly" : "keep";
            return (
              <tr key={`${r.from}_${r.to}`} className="border-t border-border/60">
                <td className="py-1.5">{r.from} → {r.to}</td>
                <td className={`text-right num ${dm > 0 ? "text-success" : "text-muted-foreground"}`}>{fmtPrice(dm)}</td>
                <td className={`text-right num ${dd > 0 ? "text-success" : "text-muted-foreground"}`}>{fmtPrice(dd)}</td>
                <td><RecBadge rec={lean === "daily" ? "resell_daily" : lean === "monthly" ? "resell_monthly" : "keep"} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
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
