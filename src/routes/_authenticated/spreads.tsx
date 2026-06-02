import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDashboardSnapshot, getSettings } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtNum, fmtPrice, fmtEur, downloadCSV } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { Download } from "lucide-react";
import { ZONES } from "@/lib/markets";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/spreads")({
  head: () => ({ meta: [{ title: "Spreads — SEE Trading Desk" }] }),
  component: SpreadsPage,
});

function SpreadsPage() {
  const fn = useServerFn(getDashboardSnapshot);
  const sFn = useServerFn(getSettings);
  const { range } = useDateRange();
  const q = useQuery({ queryKey: ["snapshot", range.from, range.to], queryFn: () => fn({ data: { from: range.from, to: range.to } }) });

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => sFn() });
  const maxMW = Number(settings.data?.max_mw ?? 100);
  const data = q.data;

  const rs = data?.byZone?.RS ?? [];
  const rsAvg = rs.length ? rs.reduce((a, p) => a + p.price, 0) / rs.length : 0;

  const importRows = (data?.importRoutes ?? []).map(r => {
    const srcPoints = data?.byZone?.[r.from] ?? [];
    const srcAvg = srcPoints.length ? srcPoints.reduce((a, p) => a + p.price, 0) / srcPoints.length : 0;
    const gross = rsAvg - srcAvg;
    const cap = r.cap.data.price_eur_mwh ?? 0;
    const net = gross - cap;
    const profitableHours = rs.filter((p, i) => (p.price - (srcPoints[i]?.price ?? 0) - cap) > 0).length;
    return { route: `${ZONES[r.from].name} → ${ZONES[r.to].name}`, gross, cap, net, value: net * maxMW * 24, profitableHours, source: r.cap.source };
  }).sort((a, b) => b.net - a.net);

  const exportRows = (data?.exportRoutes ?? []).map(r => {
    const dstPoints = data?.byZone?.[r.to] ?? [];
    const dstAvg = dstPoints.length ? dstPoints.reduce((a, p) => a + p.price, 0) / dstPoints.length : 0;
    const gross = dstAvg - rsAvg;
    const cap = r.cap.data.price_eur_mwh ?? 0;
    const net = gross - cap;
    const profitableHours = rs.filter((p, i) => ((dstPoints[i]?.price ?? 0) - p.price - cap) > 0).length;
    return { route: `${ZONES[r.from].name} → ${ZONES[r.to].name}`, gross, cap, net, value: net * maxMW * 24, profitableHours, source: r.cap.source };
  }).sort((a, b) => b.net - a.net);

  const renderTable = (rows: typeof importRows) => (
    <table className="w-full text-sm">
      <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
        <tr>
          <th className="text-left py-1.5">Route</th>
          <th className="text-right">Gross €/MWh</th>
          <th className="text-right">Capacity</th>
          <th className="text-right">Net</th>
          <th className="text-right">Profitable hrs</th>
          <th className="text-right">Daily value @ {maxMW} MW</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.route} className="border-t border-border/60">
            <td className="py-1.5">{r.route}</td>
            <td className="text-right num">{fmtNum(r.gross)}</td>
            <td className="text-right num text-muted-foreground">{fmtNum(r.cap)}</td>
            <td className={`text-right num font-semibold ${r.net > 0 ? "text-success" : "text-destructive"}`}>{fmtNum(r.net)}</td>
            <td className="text-right num">{r.profitableHours}/24</td>
            <td className={`text-right num ${r.value > 0 ? "text-success" : ""}`}>{fmtEur(r.value, 0)}</td>
            <td className="text-right"><DataBadge source={r.source} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <TopBar title="Spreads / Arbitrage" subtitle={`Tradable cap: ${maxMW} MW · gross − capacity cost`} onRefresh={() => q.refetch()} lastRefresh={data?.prices?.[0]?.fetched_at} />
      <div className="p-6 space-y-5">

        <Tabs defaultValue="import">
          <TabsList>
            <TabsTrigger value="import">Import into RS</TabsTrigger>
            <TabsTrigger value="export">Export from RS</TabsTrigger>
          </TabsList>
          <TabsContent value="import" className="mt-4">
            <Panel title="Import opportunities" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("imports.csv", importRows as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
              {renderTable(importRows)}
            </Panel>
          </TabsContent>
          <TabsContent value="export" className="mt-4">
            <Panel title="Export opportunities" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("exports.csv", exportRows as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
              {renderTable(exportRows)}
            </Panel>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
