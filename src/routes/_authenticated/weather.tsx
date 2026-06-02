import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getWeather } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtNum } from "@/lib/format";
import { ZONES, type ZoneCode } from "@/lib/markets";
import { useMemo } from "react";

export const Route = createFileRoute("/_authenticated/weather")({
  head: () => ({ meta: [{ title: "Weather — SEE Trading Desk" }] }),
  component: WeatherPage,
});

// Map temperature (°C) to OKLCH color: cold→blue, mild→green, hot→red
function tempColor(t: number | null): string {
  if (t == null) return "oklch(0.5 0.02 250)";
  // Range roughly -10..40
  const clamped = Math.max(-10, Math.min(40, t));
  const norm = (clamped + 10) / 50; // 0..1
  const hue = 240 - norm * 240; // 240 (blue) → 0 (red)
  return `oklch(0.62 0.18 ${hue})`;
}

function WeatherPage() {
  const fn = useServerFn(getWeather);
  const q = useQuery({ queryKey: ["weather"], queryFn: () => fn({ data: {} }) });

  const summarized = useMemo(() => {
    return (q.data?.rows ?? []).map(r => {
      const t = r.data.map(p => p.temp_c).filter(Number.isFinite);
      const w = r.data.map(p => p.wind_ms).filter(Number.isFinite);
      const mn = t.length ? Math.min(...t) : null;
      const mx = t.length ? Math.max(...t) : null;
      const avg = t.length ? t.reduce((a, b) => a + b, 0) / t.length : null;
      const aw = w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
      return { ...r, min: mn, max: mx, avg, avgWind: aw };
    });
  }, [q.data]);

  return (
    <>
      <TopBar title="Weather" subtitle="Open-Meteo · Visual Crossing fallback · capital city forecasts" onRefresh={() => q.refetch()} />
      <div className="p-6 space-y-5">
        <Panel
          title="Temperature map — SEE capitals (today)"
          actions={
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>-10°</span>
              <span className="w-32 h-2 rounded-full" style={{ background: "linear-gradient(90deg, oklch(0.62 0.18 240), oklch(0.62 0.18 120), oklch(0.62 0.18 0))" }} />
              <span>+40°</span>
            </div>
          }
        >
          <svg viewBox="0 50 720 460" className="w-full h-[480px]">
            <defs>
              <radialGradient id="wx-bg" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stopColor="oklch(0.22 0.02 250)" />
                <stop offset="100%" stopColor="oklch(0.15 0.015 250)" />
              </radialGradient>
              <filter id="wx-glow">
                <feGaussianBlur stdDeviation="8" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <rect x="0" y="50" width="720" height="460" fill="url(#wx-bg)" rx="8" />
            {/* grid */}
            <g opacity="0.08" stroke="currentColor">
              {Array.from({ length: 9 }).map((_, i) => (
                <line key={`v${i}`} x1={80 * i} y1={50} x2={80 * i} y2={510} strokeWidth="0.5" />
              ))}
              {Array.from({ length: 7 }).map((_, i) => (
                <line key={`h${i}`} x1={0} y1={50 + 80 * i} x2={720} y2={50 + 80 * i} strokeWidth="0.5" />
              ))}
            </g>

            {summarized.map(r => {
              const z = ZONES[r.zone as ZoneCode];
              if (!z) return null;
              const c = tempColor(r.avg);
              return (
                <g key={r.zone}>
                  {/* heat halo */}
                  <circle cx={z.x} cy={z.y} r="38" fill={c} fillOpacity="0.22" filter="url(#wx-glow)" />
                  <circle cx={z.x} cy={z.y} r="22" fill={c} fillOpacity="0.9" stroke="oklch(0.95 0 0 / 0.4)" strokeWidth="1.5" />
                  <text x={z.x} y={z.y + 5} textAnchor="middle"
                    className="fill-white text-[12px] font-bold font-mono"
                    style={{ paintOrder: "stroke", stroke: "oklch(0.15 0.015 250)", strokeWidth: 2 }}>
                    {r.avg != null ? `${Math.round(r.avg)}°` : "—"}
                  </text>
                  <text x={z.x} y={z.y - 28} textAnchor="middle"
                    className="fill-muted-foreground text-[9px] uppercase tracking-wider">
                    {r.zone}
                  </text>
                  {r.min != null && r.max != null && (
                    <text x={z.x} y={z.y + 38} textAnchor="middle"
                      className="fill-foreground/70 text-[9px] font-mono"
                      style={{ paintOrder: "stroke", stroke: "oklch(0.15 0.015 250)", strokeWidth: 2 }}>
                      {Math.round(r.min)}° / {Math.round(r.max)}°
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </Panel>

        <Panel title="Today's temperature & wind in SEE capitals">
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="text-left py-1.5">Zone</th><th className="text-left">City</th><th className="text-right">Min °C</th><th className="text-right">Avg °C</th><th className="text-right">Max °C</th><th className="text-right">Avg wind m/s</th><th>Demand signal</th><th></th></tr>
            </thead>
            <tbody>
              {summarized.map(r => {
                const signal = r.min != null && r.min < 5 ? "heating ↑"
                  : r.max != null && r.max > 28 ? "cooling ↑"
                  : r.avgWind != null && r.avgWind > 8 ? "wind RES ↑"
                  : "neutral";
                return (
                  <tr key={r.zone} className="border-t border-border/60">
                    <td className="py-1.5 font-medium">{r.zone}</td>
                    <td>{r.name}</td>
                    <td className="text-right num">{fmtNum(r.min)}</td>
                    <td className="text-right num font-semibold" style={{ color: tempColor(r.avg) }}>{fmtNum(r.avg)}</td>
                    <td className="text-right num">{fmtNum(r.max)}</td>
                    <td className="text-right num">{fmtNum(r.avgWind)}</td>
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
