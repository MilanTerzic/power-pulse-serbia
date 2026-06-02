import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getCapacity } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtPrice, fmtMW, downloadCSV } from "@/lib/format";
import { useDateRange } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { Download, AlertTriangle } from "lucide-react";
import { BORDERS } from "@/lib/markets";

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

  return (
    <>
      <TopBar title="Capacity (A25)" subtitle="Explicit allocation prices and volumes per border × product" onRefresh={() => q.refetch()} lastRefresh={q.data?.rows?.[0]?.fetched_at} />
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
      </div>
    </>
  );
}
