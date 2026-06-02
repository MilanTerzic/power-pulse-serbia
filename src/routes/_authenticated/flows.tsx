import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getFlows } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtMW, fmtNum, downloadCSV } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/flows")({
  head: () => ({ meta: [{ title: "Flows — SEE Trading Desk" }] }),
  component: FlowsPage,
});

function FlowsPage() {
  const fn = useServerFn(getFlows);
  const [demo, setDemo] = useState(false);
  const q = useQuery({ queryKey: ["flows", demo], queryFn: () => fn({ data: { demo } }) });

  const rows = (q.data?.rows ?? []).map(r => {
    const mw = r.data.points.map(p => p.mw);
    const avg = mw.length ? mw.reduce((a, b) => a + b, 0) / mw.length : null;
    const mx = mw.length ? Math.max(...mw) : null;
    const mn = mw.length ? Math.min(...mw) : null;
    return { route: `${r.from} → ${r.to}`, avg, max: mx, min: mn, source: r.source };
  });

  return (
    <>
      <TopBar title="Physical Flows (A11)" subtitle="Hourly cross-border flows" demo={demo} onRefresh={() => q.refetch()} />
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Button size="sm" variant={demo ? "outline" : "default"} onClick={() => setDemo(false)}>Live</Button>
          <Button size="sm" variant={demo ? "default" : "outline"} onClick={() => setDemo(true)}>Demo</Button>
        </div>
        <Panel title="Flow summary" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("flows.csv", rows as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left py-1.5">Route</th><th className="text-right">Avg MW</th><th className="text-right">Max MW</th><th className="text-right">Min MW</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.route} className="border-t border-border/60">
                  <td className="py-1.5">{r.route}</td>
                  <td className="text-right num">{fmtMW(r.avg)}</td>
                  <td className="text-right num">{fmtMW(r.max)}</td>
                  <td className="text-right num text-muted-foreground">{fmtMW(r.min)}</td>
                  <td className="text-right"><DataBadge source={r.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
