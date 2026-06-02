import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getWeather } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtNum } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/weather")({
  head: () => ({ meta: [{ title: "Weather — SEE Trading Desk" }] }),
  component: WeatherPage,
});

function WeatherPage() {
  const fn = useServerFn(getWeather);
  const q = useQuery({ queryKey: ["weather"], queryFn: () => fn() });

  return (
    <>
      <TopBar title="Weather" subtitle="Open-Meteo · capital city forecasts · demand signals" onRefresh={() => q.refetch()} />
      <div className="p-6">
        <Panel title="Today's temperature & wind in SEE capitals">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left py-1.5">Zone</th><th className="text-left">City</th><th className="text-right">Min °C</th><th className="text-right">Max °C</th><th className="text-right">Avg wind m/s</th><th>Demand signal</th><th></th></tr>
            </thead>
            <tbody>
              {(q.data?.rows ?? []).map(r => {
                const t = r.data.map(p => p.temp_c);
                const w = r.data.map(p => p.wind_ms);
                const mn = t.length ? Math.min(...t) : null;
                const mx = t.length ? Math.max(...t) : null;
                const aw = w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
                const signal = mn != null && mn < 5 ? "heating ↑" : mx != null && mx > 28 ? "cooling ↑" : aw != null && aw > 8 ? "wind RES ↑" : "neutral";
                return (
                  <tr key={r.zone} className="border-t border-border/60">
                    <td className="py-1.5 font-medium">{r.zone}</td>
                    <td>{r.name}</td>
                    <td className="text-right num">{fmtNum(mn)}</td>
                    <td className="text-right num">{fmtNum(mx)}</td>
                    <td className="text-right num">{fmtNum(aw)}</td>
                    <td className="text-xs text-muted-foreground">{signal}</td>
                    <td className="text-right"><DataBadge source={r.source} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
