import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getOutages } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtMW, downloadCSV } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { Download } from "lucide-react";

export const Route = createFileRoute("/_authenticated/outages")({
  head: () => ({ meta: [{ title: "Outages — SEE Trading Desk" }] }),
  component: OutagesPage,
});

function OutagesPage() {
  const fn = useServerFn(getOutages);
  const { range } = useDateRange();
  const q = useQuery({ queryKey: ["outages", range.from, range.to], queryFn: () => fn({ data: { from: range.from, to: range.to } }) });
  const rows = q.data?.rows ?? [];
  const totalMW = rows.reduce((a, r) => a + r.mw, 0);

  return (
    <>
      <TopBar title="Outages (A77/A80)" subtitle={`Currently ${rows.length} units unavailable · ${fmtMW(totalMW)} impacted`} onRefresh={() => q.refetch()} />
      <div className="p-6 space-y-5">

        <Panel title="Unavailable generation units" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("outages.csv", rows as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left py-1.5">Zone</th><th className="text-left">Unit</th><th className="text-right">MW</th><th>Type</th><th>Start</th><th>End</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="py-1.5 font-medium">{r.zone}</td>
                  <td>{r.unit}</td>
                  <td className="text-right num">{fmtMW(r.mw)}</td>
                  <td><span className={`text-xs ${r.type === "forced" ? "text-destructive" : "text-warning"}`}>{r.type}</span></td>
                  <td className="text-xs num text-muted-foreground">{new Date(r.start).toLocaleDateString("en-GB")}</td>
                  <td className="text-xs num text-muted-foreground">{new Date(r.end).toLocaleDateString("en-GB")}</td>
                  <td className="text-right"><DataBadge source={r.source} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="text-center text-muted-foreground py-6 text-sm">No outages reported.</td></tr>}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
