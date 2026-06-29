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

type HistoryRow = {
  day: string;
  from: ZoneCode;
  to: ZoneCode;
  product: ProductType;
  price_eur_mwh: number | null;
  offered_mw: number | null;
  allocated_mw: number | null;
  unit_warning?: string;
  source: string;
  fetched_at: string;
};

type DisplayHistoryRow = HistoryRow & {
  sample_count?: number;
  weighted_days?: number;
  sample_dates?: string[];
};

const DAY_MS = 86400_000;

function parseDay(day: string) {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t) : null;
}

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function monthEnd(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function daysInclusive(from: Date, to: Date) {
  return Math.max(1, Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1);
}

function weightedNullable(sum: number, days: number) {
  return days > 0 ? sum / days : null;
}

function aggregateMonthlyRows(rows: HistoryRow[]): DisplayHistoryRow[] {
  const sorted = [...rows]
    .filter(r => r.product === "monthly" && r.price_eur_mwh != null)
    .sort((a, b) => a.day.localeCompare(b.day));

  const grouped = new Map<string, {
    first: HistoryRow;
    priceSum: number;
    priceDays: number;
    offeredSum: number;
    offeredDays: number;
    allocatedSum: number;
    allocatedDays: number;
    sources: Set<string>;
    sampleDates: string[];
    fetchedAt: string;
    unitWarning?: string;
  }>();

  sorted.forEach((row, idx) => {
    const current = parseDay(row.day);
    if (!current || row.price_eur_mwh == null) return;

    const start = monthStart(current);
    const end = monthEnd(current);
    const next = parseDay(sorted[idx + 1]?.day ?? "");
    const segmentEnd = next && next.getTime() > current.getTime()
      ? new Date(Math.min(end.getTime(), next.getTime() - DAY_MS))
      : end;
    const weightDays = daysInclusive(current, segmentEnd);
    const key = isoDay(start);

    const g = grouped.get(key) ?? {
      first: { ...row, day: key },
      priceSum: 0,
      priceDays: 0,
      offeredSum: 0,
      offeredDays: 0,
      allocatedSum: 0,
      allocatedDays: 0,
      sources: new Set<string>(),
      sampleDates: [],
      fetchedAt: row.fetched_at,
      unitWarning: row.unit_warning,
    };

    g.priceSum += row.price_eur_mwh * weightDays;
    g.priceDays += weightDays;
    if (row.offered_mw != null && Number.isFinite(row.offered_mw)) {
      g.offeredSum += row.offered_mw * weightDays;
      g.offeredDays += weightDays;
    }
    if (row.allocated_mw != null && Number.isFinite(row.allocated_mw)) {
      g.allocatedSum += row.allocated_mw * weightDays;
      g.allocatedDays += weightDays;
    }
    g.sources.add(row.source);
    g.sampleDates.push(row.day);
    g.fetchedAt = row.fetched_at > g.fetchedAt ? row.fetched_at : g.fetchedAt;
    if (row.unit_warning) g.unitWarning = row.unit_warning;
    grouped.set(key, g);
  });

  return [...grouped.entries()].map(([monthDate, g]) => ({
    ...g.first,
    day: monthDate,
    price_eur_mwh: weightedNullable(g.priceSum, g.priceDays),
    offered_mw: weightedNullable(g.offeredSum, g.offeredDays),
    allocated_mw: weightedNullable(g.allocatedSum, g.allocatedDays),
    source: g.sources.size === 1 ? [...g.sources][0] : "partial",
    fetched_at: g.fetchedAt,
    unit_warning: g.unitWarning,
    sample_count: g.sampleDates.length,
    weighted_days: g.priceDays,
    sample_dates: g.sampleDates,
  }));
}

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
  const realRows = allRows.filter(r => r.source !== "demo" && r.price_eur_mwh != null) as HistoryRow[];
  const displayRows: DisplayHistoryRow[] = product === "monthly" ? aggregateMonthlyRows(realRows) : realRows;
  const chartData = displayRows.map(r => ({
    day: r.day,
    price: r.price_eur_mwh,
    sample_dates: r.sample_dates,
    sample_count: r.sample_count,
    weighted_days: r.weighted_days,
  }));
  const hasData = chartData.length > 0;
  const missingCount = allRows.length - realRows.length;
  const productLabel = product === "daily" ? "Daily" : product === "monthly" ? "Monthly" : "Annual";
  const dateColumnLabel = product === "monthly" ? "Month date" : product === "annual" ? "Year date" : "Date";

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
                    Monthly rows are grouped by exact calendar month date. If more than one sample falls in the same month, price is day-weighted inside that month.
                  </TooltipContent>
                </UITooltip>
              </TooltipProvider>
              <Button
                size="sm" variant="ghost" className="gap-1.5"
                onClick={() => downloadCSV(`capacity-history_${hFrom_z}-${hTo_z}_${product}.csv`, displayRows.map(r => ({
                  date: r.day,
                  direction: `${r.from} -> ${r.to}`,
                  product: r.product,
                  price_eur_mwh: r.price_eur_mwh,
                  offered_mw: r.offered_mw,
                  allocated_mw: r.allocated_mw,
                  weighted_days: r.weighted_days ?? "",
                  sample_count: r.sample_count ?? "",
                  sample_dates: r.sample_dates?.join("; ") ?? "",
                  source: r.source,
                  fetched_at: r.fetched_at,
                })))}
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
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>
          ) : !hasData ? (
            <div className="h-64 flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground border border-dashed border-border rounded p-4 text-center">
              <span>No published ENTSO-E A25 capacity prices for {hFrom_z} → {hTo_z} ({product}) in this range.</span>
              <span className="text-xs">Try the opposite direction, a different product, or an earlier date range. Many SEE borders publish A25 only sporadically.</span>
            </div>
          ) : (
            <>
              {missingCount > 0 && (
                <div className="mb-3 text-[11px] text-muted-foreground">
                  {missingCount} sample{missingCount === 1 ? "" : "s"} hidden because no price was available.
                </div>
              )}
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" tick={{ fill: "#ffffff" }} axisLine={{ stroke: "hsl(var(--muted-foreground))" }} fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "#ffffff" }} axisLine={{ stroke: "hsl(var(--muted-foreground))" }} fontSize={11} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                      itemStyle={{ color: "#ffffff" }}
                      labelStyle={{ color: "#ffffff" }}
                      formatter={(v: number) => [fmtPrice(v), "€/MWh"]}
                      labelFormatter={(label, items) => {
                        const payload = items?.[0]?.payload as { sample_count?: number; sample_dates?: string[]; weighted_days?: number } | undefined;
                        if (payload?.sample_count && payload.sample_count > 1) {
                          return `${label} · ${payload.weighted_days} weighted days from ${payload.sample_dates?.join(", ")}`;
                        }
                        return String(label);
                      }}
                    />
                    <Line type="monotone" dataKey="price" stroke="#1ec8c8" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground sticky top-0 bg-card">
                    <tr>
                      <th className="text-left py-1.5">{dateColumnLabel}</th>
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
                    {displayRows.map(r => (
                      <tr key={r.day} className="border-t border-border/60">
                        <td className="py-1.5 font-medium">
                          {r.day}
                          {r.sample_count && r.sample_count > 1 && (
                            <div className="text-[10px] text-muted-foreground font-normal">
                              weighted avg from {r.sample_dates?.join(", ")}
                            </div>
                          )}
                        </td>
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
