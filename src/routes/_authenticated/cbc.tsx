import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCBCComparison, getResalePnL, listPositions, upsertPosition, deletePosition,
} from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtPrice, fmtEur, fmtMW, downloadCSV } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Trash2, Pencil, Download } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/cbc")({
  head: () => ({ meta: [{ title: "CBC Capacity Resale — SEE Trading Desk" }] }),
  component: CBCPage,
});

function CBCPage() {
  return (
    <>
      <TopBar title="CBC Capacity Resale" subtitle="Annual vs Monthly vs Daily — resell PnL & recommendations" />
      <div className="p-6">
        <Tabs defaultValue="comparison">
          <TabsList>
            <TabsTrigger value="comparison">Comparison</TabsTrigger>
            <TabsTrigger value="pnl">Resale PnL</TabsTrigger>
            <TabsTrigger value="predictor">Predictor</TabsTrigger>
            <TabsTrigger value="manual">Manual Inputs</TabsTrigger>
            <TabsTrigger value="diag">Diagnostics</TabsTrigger>
          </TabsList>
          <TabsContent value="comparison" className="mt-4"><Comparison /></TabsContent>
          <TabsContent value="pnl" className="mt-4"><PnL /></TabsContent>
          <TabsContent value="predictor" className="mt-4"><Predictor /></TabsContent>
          <TabsContent value="manual" className="mt-4"><Manual /></TabsContent>
          <TabsContent value="diag" className="mt-4"><Diag /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}

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

function PnL() {
  const fn = useServerFn(getResalePnL);
  const q = useQuery({ queryKey: ["cbc_pnl"], queryFn: () => fn({ data: {} }) });
  const rows = q.data?.rows ?? [];
  return (
    <Panel title="Resale PnL per position" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("resale-pnl.csv", rows as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr><th className="text-left py-1.5">Position</th><th className="text-right">MW</th><th className="text-right">Booked €</th><th className="text-right">Monthly €</th><th className="text-right">Daily €</th><th className="text-right">PnL monthly</th><th className="text-right">PnL daily</th><th>Recommendation</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.position_id} className="border-t border-border/60">
              <td className="py-1.5">{r.label}</td>
              <td className="text-right num">{fmtMW(r.booked_mw)}</td>
              <td className="text-right num">{fmtPrice(r.annual_booked_price)}</td>
              <td className="text-right num">{fmtPrice(r.monthly_price)}</td>
              <td className="text-right num">{fmtPrice(r.daily_price)}</td>
              <td className={`text-right num ${(r.pnl_monthly ?? 0) > 0 ? "text-success" : "text-destructive"}`}>{fmtEur(r.pnl_monthly, 0)}</td>
              <td className={`text-right num ${(r.pnl_daily ?? 0) > 0 ? "text-success" : "text-destructive"}`}>{fmtEur(r.pnl_daily, 0)}</td>
              <td><RecBadge rec={r.recommendation} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="text-center text-muted-foreground py-6 text-sm">No positions. Add some in Manual Inputs.</td></tr>}
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
  // Simple transparent predictor: which product looked cheaper most often vs annual
  return (
    <Panel title="Predictor — daily vs monthly bias">
      <p className="text-xs text-muted-foreground mb-3">
        Heuristic: compares current monthly and daily prices vs the annual reference. The product
        with the larger positive spread vs annual is the better resell candidate today. Combine with
        the historical spread before deciding.
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

function Manual() {
  const listFn = useServerFn(listPositions);
  const upFn = useServerFn(upsertPosition);
  const delFn = useServerFn(deletePosition);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["positions"], queryFn: () => listFn() });
  const del = useMutation({ mutationFn: (id: string) => delFn({ data: { id } }), onSuccess: () => { toast.success("Position deleted"); qc.invalidateQueries({ queryKey: ["positions"] }); qc.invalidateQueries({ queryKey: ["cbc_pnl"] }); } });

  return (
    <Panel title="Portfolio positions" actions={<PositionDialog onSaved={() => { qc.invalidateQueries({ queryKey: ["positions"] }); qc.invalidateQueries({ queryKey: ["cbc_pnl"] }); }} />}>
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
                <PositionDialog existing={p} onSaved={() => { qc.invalidateQueries({ queryKey: ["positions"] }); qc.invalidateQueries({ queryKey: ["cbc_pnl"] }); }} />
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
  const fn = useServerFn(getCBCComparison);
  const q = useQuery({ queryKey: ["cbc_cmp"], queryFn: () => fn({ data: {} }) });
  const sourceCount: Record<string, number> = {};
  for (const r of q.data?.rows ?? []) {
    for (const v of Object.values(r.sources)) sourceCount[v] = (sourceCount[v] ?? 0) + 1;
  }
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Panel title="Source breakdown">
        <ul className="text-sm space-y-1.5">
          {Object.entries(sourceCount).map(([k, v]) => (
            <li key={k} className="flex justify-between"><span><DataBadge source={k} /></span><span className="num">{v}</span></li>
          ))}
          {Object.keys(sourceCount).length === 0 && <li className="text-muted-foreground">No data yet — run the Comparison tab.</li>}
        </ul>
      </Panel>
      <Panel title="Notes">
        <p className="text-sm text-muted-foreground">
          Live A25 monthly/annual prices may be returned as totals depending on TSO publication. Treat the unit warnings as cues to verify the source before booking.
        </p>
      </Panel>
    </div>
  );
}
