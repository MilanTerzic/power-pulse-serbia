import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getOutages } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { DataBadge } from "@/components/data-badge";
import { fmtMW, downloadCSV } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import { Download, AlertTriangle, Wrench } from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/_authenticated/outages")({
  head: () => ({ meta: [{ title: "Outages — SEE Trading Desk" }] }),
  component: OutagesPage,
});

function OutagesPage() {
  const fn = useServerFn(getOutages);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["outages", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });
  const rows = q.data?.rows ?? [];
  const totalMW = rows.reduce((a, r) => a + r.mw, 0);
  const forcedMW = rows.filter(r => r.type === "forced").reduce((a, r) => a + r.mw, 0);
  const plannedMW = totalMW - forcedMW;

  // Aggregate per zone
  const byZone = useMemo(() => {
    const m = new Map<string, { zone: string; forced: number; planned: number; units: number }>();
    for (const r of rows) {
      const e = m.get(r.zone) ?? { zone: r.zone, forced: 0, planned: 0, units: 0 };
      if (r.type === "forced") e.forced += r.mw; else e.planned += r.mw;
      e.units += 1;
      m.set(r.zone, e);
    }
    return [...m.values()].sort((a, b) => (b.forced + b.planned) - (a.forced + a.planned));
  }, [rows]);

  const maxZoneMW = Math.max(1, ...byZone.map(z => z.forced + z.planned));

  return (
    <>
      <TopBar title="Outages (A77/A80)" subtitle={`${rows.length} units unavailable · ${fmtMW(totalMW)} impacted`} onRefresh={() => q.refetch()} />
      <div className="p-6 space-y-5">
        <div className="grid md:grid-cols-4 gap-4">
          <KPI label="Total impacted" value={fmtMW(totalMW)} accent="warning" sub={`${rows.length} units`} />
          <KPI label="Forced" value={fmtMW(forcedMW)} accent="destructive" sub={`${rows.filter(r => r.type === "forced").length} units`} />
          <KPI label="Planned" value={fmtMW(plannedMW)} accent="info" sub={`${rows.filter(r => r.type !== "forced").length} units`} />
          <KPI label="Zones affected" value={String(byZone.length)} accent="primary" />
        </div>

        <Panel title="Impact by zone (MW unavailable)">
          {byZone.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No outages reported.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-4 text-[10px] uppercase tracking-wider text-muted-foreground pb-1">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-destructive" />Forced</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-info" />Planned</span>
              </div>
              {byZone.map(z => {
                const total = z.forced + z.planned;
                const fPct = (z.forced / maxZoneMW) * 100;
                const pPct = (z.planned / maxZoneMW) * 100;
                return (
                  <div key={z.zone} className="flex items-center gap-3 text-sm">
                    <span className="w-10 font-mono font-semibold">{z.zone}</span>
                    <div className="flex-1 h-6 bg-surface-2/60 rounded overflow-hidden flex">
                      <div className="bg-destructive h-full transition-all" style={{ width: `${fPct}%` }} title={`Forced: ${fmtMW(z.forced)}`} />
                      <div className="bg-info h-full transition-all" style={{ width: `${pPct}%` }} title={`Planned: ${fmtMW(z.planned)}`} />
                    </div>
                    <span className="num text-xs text-muted-foreground w-16 text-right">{z.units} units</span>
                    <span className="num font-semibold w-24 text-right">{fmtMW(total)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <div className="grid md:grid-cols-2 gap-5">
          <Panel title={<span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-destructive" />Largest forced outages</span>} dense>
            <ul className="text-sm divide-y divide-border/60">
              {rows.filter(r => r.type === "forced").sort((a, b) => b.mw - a.mw).slice(0, 6).map((r, i) => (
                <li key={i} className="flex justify-between py-1.5">
                  <span className="truncate"><span className="font-mono text-xs text-muted-foreground mr-2">{r.zone}</span>{r.unit}</span>
                  <span className="num text-destructive font-semibold">{fmtMW(r.mw)}</span>
                </li>
              ))}
              {rows.filter(r => r.type === "forced").length === 0 && <li className="text-muted-foreground text-xs py-3 text-center">None</li>}
            </ul>
          </Panel>
          <Panel title={<span className="flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 text-info" />Largest planned outages</span>} dense>
            <ul className="text-sm divide-y divide-border/60">
              {rows.filter(r => r.type !== "forced").sort((a, b) => b.mw - a.mw).slice(0, 6).map((r, i) => (
                <li key={i} className="flex justify-between py-1.5">
                  <span className="truncate"><span className="font-mono text-xs text-muted-foreground mr-2">{r.zone}</span>{r.unit}</span>
                  <span className="num text-info font-semibold">{fmtMW(r.mw)}</span>
                </li>
              ))}
              {rows.filter(r => r.type !== "forced").length === 0 && <li className="text-muted-foreground text-xs py-3 text-center">None</li>}
            </ul>
          </Panel>
        </div>

        <Panel title="All unavailable units" actions={<Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("outages.csv", rows as never)}><Download className="w-3.5 h-3.5" />CSV</Button>}>
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
                  <td><span className={`text-xs ${r.type === "forced" ? "text-destructive" : "text-info"}`}>{r.type}</span></td>
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
