import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDashboardSnapshot } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { ZONES, IMPORT_ROUTES, EXPORT_ROUTES } from "@/lib/markets";
import { useState } from "react";
import { fmtNum } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/map")({
  head: () => ({ meta: [{ title: "Route Map — SEE Trading Desk" }] }),
  component: MapPage,
});

function MapPage() {
  const fn = useServerFn(getDashboardSnapshot);
  const [demo, setDemo] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["snapshot", demo], queryFn: () => fn({ data: { demo } }) });
  const data = q.data;

  const rsAvg = (() => {
    const a = data?.byZone?.RS ?? [];
    return a.length ? a.reduce((s, p) => s + p.price, 0) / a.length : 0;
  })();

  const computeNet = (from: keyof typeof ZONES, to: keyof typeof ZONES, cap: number) => {
    const src = data?.byZone?.[from] ?? [];
    const dst = data?.byZone?.[to] ?? [];
    const sAvg = src.length ? src.reduce((a, p) => a + p.price, 0) / src.length : 0;
    const dAvg = dst.length ? dst.reduce((a, p) => a + p.price, 0) / dst.length : 0;
    return dAvg - sAvg - cap;
  };

  const allRoutes = [
    ...IMPORT_ROUTES.map(r => ({ ...r, kind: "import" as const, cap: data?.importRoutes?.find(x => x.from === r.from && x.to === r.to)?.cap.data.price_eur_mwh ?? 0 })),
    ...EXPORT_ROUTES.map(r => ({ ...r, kind: "export" as const, cap: data?.exportRoutes?.find(x => x.from === r.from && x.to === r.to)?.cap.data.price_eur_mwh ?? 0 })),
  ].map(r => ({ ...r, net: computeNet(r.from, r.to, r.cap) }));

  const sel = allRoutes.find(r => `${r.from}_${r.to}` === selected);

  return (
    <>
      <TopBar title="Route Map" subtitle="Net margin arrows around Serbia" demo={demo} onRefresh={() => q.refetch()} />
      <div className="p-6 grid lg:grid-cols-[1fr_320px] gap-5">
        <Panel>
          <svg viewBox="0 50 720 460" className="w-full h-[520px]">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 Z" fill="currentColor" />
              </marker>
            </defs>
            {/* edges */}
            {allRoutes.map(r => {
              const a = ZONES[r.from], b = ZONES[r.to];
              const color = r.net > 0 ? "var(--color-success)" : r.net < 0 ? "var(--color-destructive)" : "var(--color-muted-foreground)";
              const strokeWidth = Math.min(6, 1 + Math.abs(r.net) / 5);
              const id = `${r.from}_${r.to}`;
              return (
                <g key={id} onClick={() => setSelected(id)} className="cursor-pointer">
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={strokeWidth} strokeOpacity={selected === id ? 1 : 0.7} markerEnd="url(#arrow)" style={{ color }} />
                </g>
              );
            })}
            {/* nodes */}
            {Object.values(ZONES).map(z => (
              <g key={z.code}>
                <circle cx={z.x} cy={z.y} r="18" fill="var(--color-surface-2)" stroke={z.code === "RS" ? "var(--color-primary)" : "var(--color-border)"} strokeWidth={z.code === "RS" ? 2.5 : 1.5} />
                <text x={z.x} y={z.y + 4} textAnchor="middle" className="fill-foreground text-xs font-bold">{z.code}</text>
                <text x={z.x} y={z.y + 32} textAnchor="middle" className="fill-muted-foreground text-[10px]">{z.name}</text>
              </g>
            ))}
          </svg>
        </Panel>
        <Panel title={sel ? `${ZONES[sel.from].name} → ${ZONES[sel.to].name}` : "Click a route"}>
          {sel ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Kind</span><span>{sel.kind}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Capacity cost</span><span className="num">{fmtNum(sel.cap)} €/MWh</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Net margin</span><span className={`num font-semibold ${sel.net > 0 ? "text-success" : "text-destructive"}`}>{fmtNum(sel.net)} €/MWh</span></div>
              <div className="text-xs text-muted-foreground pt-2 border-t border-border/60">RS day-avg: <span className="num">{fmtNum(rsAvg)} €/MWh</span></div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pick any line on the map to inspect price, capacity cost and net margin.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
