import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getCapacity, getCapacityHistory } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtPrice, fmtMW, downloadCSV } from "@/lib/format";
import { useDateRange } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { Download, AlertTriangle, Info } from "lucide-react";
import { BORDERS, PRODUCTS, type ZoneCode, type ProductType } from "@/lib/markets";
import { useState, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export const Route = createFileRoute("/_authenticated/capacity")({
  head: () => ({ meta: [{ title: "Capacity — SEE Trading Desk" }] }),
  component: CapacityPage,
});

function CapacityPage() {
  const fn = useServerFn(getCapacity);
  const { range } = useDateRange();
  const q = useQuery({ queryKey: ["capacity", range.from, range.to], queryFn: () => fn({ data: { from: range.from, to: range.to } }) });

  type CapRow = NonNullable<typeof q.data>["rows"][number];
  const grouped: Record<string, { from: string; to: string; daily?: CapRow; monthly?: CapRow; annual?: CapRow }> = {};
  for (const [a, b] of BORDERS) grouped[`${a}_${b}`] = { from: a, to: b };
  for (const row of q.data?.rows ?? []) {
    const key = `${row.data.from}_${row.data.to}`;
    (grouped[key] as Record<string, unknown>)[row.data.product] = row;
  }

  const rows = Object.values(grouped);

  // ---- Historical view state ----
  // BORDERS already contains both directions — don't duplicate.
  const directions = useMemo(() => BORDERS as ReadonlyArray<[ZoneCode, ZoneCode]>, []);
  const [dirIdx, setDirIdx] = useState(0);
  const [product, setProduct] = useState<ProductType>("daily");
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const [hFrom, setHFrom] = useState(defaultFrom);
  const [hTo, setHTo] = useState(today);
  const [hFrom_z, hTo_z] = directions[dirIdx];

  const histFn = useServerFn(getCapacityHistory);
  const hq = useQuery({
    queryKey: ["capacity-history", hFrom_z, hTo_z, product, hFrom, hTo],
    queryFn: () => histFn({ data: { from: hFrom_z, to: hTo_z, product, from_date: hFrom, to_date: hTo } }),
  });

  const allRows = hq.data?.rows ?? [];
  // Only show real ENTSO-E data; hide synthetic "demo" fallback rows.
  const realRows = allRows.filter(r => r.source !== "demo" && r.price_eur_mwh != null);
  const chartData = realRows.map(r => ({ day: r.day, price: r.price_eur_mwh }));
  const hasData = chartData.length > 0;
  const demoCount = allRows.length - realRows.length;
  const productLabel = product === "daily" ? "Daily" : product === "monthly" ? "Monthly" : "Annual";

  return (
    <>
      <TopBar title="Capacity (A25)" subtitle="Explicit allocation prices and volumes per border × product" onRefresh={() => { q.refetch(); hq.refetch(); }} lastRefresh={q.data?.rows?.[0]?.fetched_at} />
      <div className="p-6 space-y-5">

        <div className="flex items-start gap-2 text-xs text-warning bg-warning/10 border border-warning/30 rounded p-3">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <span>Monthly/annual A25 prices may be published as totals (EUR) rather than EUR/MWh depending on the TSO. Verify before booking.</span>
        </div>

        <Panel title="Capacity prices by border" actions={<Button size="sm" variant="ghost" onClick={() => downloadCSV("capacity.csv", rows.map(r => ({ from: r.from, to: r.to, annual: r.annual?.data?.price_eur_mwh, monthly: r.monthly?.data?.price_eur_mwh, daily: r.daily?.data?.price_eur_mwh })))} className="gap-1.5"><Download className="w-3.5 h-3.5" />CSV</Button>}>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left py-1.5">Border</th><th className="text-right">Annual</th><th className="text-right">Monthly</th><th className="text-right">Daily €/MWh</th><th className="text-right">Offered MW</th><th className="text-right">Allocated MW</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={`${r.from}_${r.to}`} className="border-t border-border/60">
                  <td className="py-1.5">{r.from} → {r.to}</td>
                  <td className="text-right num">{fmtPrice(r.annual?.data?.price_eur_mwh)}</td>
                  <td className="text-right num">{fmtPrice(r.monthly?.data?.price_eur_mwh)}</td>
                  <td className="text-right num font-medium">{fmtPrice(r.daily?.data?.price_eur_mwh)}</td>
                  <td className="text-right num text-muted-foreground">{fmtMW(r.daily?.data?.offered_mw ?? null)}</td>
                  <td className="text-right num text-muted-foreground">{fmtMW(r.daily?.data?.allocated_mw ?? null)}</td>
                  <td className="text-right"><DataBadge source={r.daily?.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title={`Historical ${productLabel} Capacity Prices: ${hFrom_z} → ${hTo_z}`}
          actions={
            <div className="flex items-center gap-2">
              <TooltipProvider>
                <UITooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Monthly/annual A25 prices may be totals (EUR) rather than EUR/MWh depending on TSO. Units preserved as received.
                  </TooltipContent>
                </UITooltip>
              </TooltipProvider>
              <Button
                size="sm" variant="ghost" className="gap-1.5"
                onClick={() => downloadCSV(`capacity-history_${hFrom_z}-${hTo_z}_${product}.csv`, hq.data?.rows ?? [])}
              >
                <Download className="w-3.5 h-3.5" />CSV
              </Button>
            </div>
          }
        >
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Border direction</span>
              <select
                className="bg-background border border-border rounded px-2 py-1.5 text-sm min-w-[140px]"
                value={dirIdx}
                onChange={e => setDirIdx(Number(e.target.value))}
              >
                {directions.map(([a, b], i) => (
                  <option key={`${a}_${b}`} value={i}>{a} → {b}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Product</span>
              <div className="inline-flex rounded border border-border overflow-hidden">
                {PRODUCTS.map(p => (
                  <button
                    key={p}
                    onClick={() => setProduct(p)}
                    className={`px-3 py-1.5 text-sm capitalize ${product === p ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px]">From</span>
              <input type="date" value={hFrom} max={hTo} onChange={e => setHFrom(e.target.value)} className="bg-background border border-border rounded px-2 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px]">To</span>
              <input type="date" value={hTo} min={hFrom} max={today} onChange={e => setHTo(e.target.value)} className="bg-background border border-border rounded px-2 py-1.5 text-sm" />
            </label>
          </div>

          {hq.isLoading ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
          ) : !hasData ? (
            <div className="h-64 flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground border border-dashed border-border rounded p-4 text-center">
              <span>No published ENTSO-E A25 capacity prices for {hFrom_z} → {hTo_z} ({product}) in this range.</span>
              <span className="text-xs">Try the opposite direction, a different product, or an earlier date range. Many SEE borders publish A25 only sporadically.</span>
            </div>
          ) : (
            <>
              {demoCount > 0 && (
                <div className="mb-3 text-[11px] text-muted-foreground">
                  {demoCount} day{demoCount === 1 ? "" : "s"} hidden — ENTSO-E returned no A25 price (synthetic fallback suppressed).
                </div>
              )}
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      formatter={(v: number) => [fmtPrice(v), "€/MWh"]}
                    />
                    <Line type="monotone" dataKey="price" stroke="#1ec8c8" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-card">
                    <tr>
                      <th className="text-left py-1.5">Period</th>
                      <th className="text-left">Direction</th>
                      <th className="text-left">Product</th>
                      <th className="text-right">Price</th>
                      <th className="text-left pl-3">Unit</th>
                      <th className="text-right">Offered MW</th>
                      <th className="text-right">Allocated MW</th>
                      <th className="text-right">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realRows.map(r => (
                      <tr key={r.day} className="border-t border-border/60">
                        <td className="py-1.5">{r.day}</td>
                        <td>{r.from} → {r.to}</td>
                        <td className="capitalize">{r.product}</td>
                        <td className="text-right num">{fmtPrice(r.price_eur_mwh)}</td>
                        <td className="pl-3 text-muted-foreground text-xs">{r.unit_warning ? "EUR (verify)" : "€/MWh"}</td>
                        <td className="text-right num text-muted-foreground">{fmtMW(r.offered_mw)}</td>
                        <td className="text-right num text-muted-foreground">{fmtMW(r.allocated_mw)}</td>
                        <td className="text-right"><DataBadge source={r.source} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
