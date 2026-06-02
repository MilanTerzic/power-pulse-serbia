import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { runForecast } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { fmtPrice, fmtNum } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/forecast")({
  head: () => ({ meta: [{ title: "SEEPEX Forecast — SEE Trading Desk" }] }),
  component: ForecastPage,
});

function ForecastPage() {
  const fn = useServerFn(runForecast);
  const [horizon, setHorizon] = useState("24");
  const [hist, setHist] = useState("30");

  const m = useMutation({
    mutationFn: () => fn({ data: { horizon_h: parseInt(horizon), history_days: parseInt(hist) } }),
  });


  const fc = m.data?.forecast ?? [];
  const dailyAvg = fc.length ? fc.reduce((a, p) => a + p.forecast, 0) / fc.length : null;
  const peak = fc.length ? Math.max(...fc.map(p => p.forecast)) : null;
  const trough = fc.length ? Math.min(...fc.map(p => p.forecast)) : null;

  const chartData = fc.map(p => ({
    ts: new Date(p.ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit" }),
    forecast: p.forecast,
    lo: p.lo80,
    hi: p.hi80,
    band: [p.lo80, p.hi80],
  }));

  return (
    <>
      <TopBar title="SEEPEX Forecast" subtitle="ARIMA-lite cascade (SARIMA AR/seasonal-naive/rolling) for Serbia DA prices" />
      <div className="p-6 space-y-5">
        <Panel title="Run forecast">
          <div className="grid md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Horizon</Label>
              <Select value={horizon} onValueChange={setHorizon}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">1 day</SelectItem>
                  <SelectItem value="72">3 days</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                  <SelectItem value="336">14 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">History window</Label>
              <Select value={hist} onValueChange={setHist}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["30","60","90","180","365"].map(v => <SelectItem key={v} value={v}>{v} days</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "Forecasting…" : "Run forecast"}</Button>

          </div>
        </Panel>

        {m.data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KPI label="Model" value={<span className="text-base">{m.data.model}</span>} sub={`${m.data.history_points} hist pts · ${m.data.training_days}d`} accent="primary" />
              <KPI label="Backtest MAE" value={fmtNum(m.data.mae)} sub="€/MWh" />
              <KPI label="Backtest MAPE" value={m.data.mape ? `${fmtNum(m.data.mape)}%` : "—"} />
              <KPI label="Daily avg forecast" value={fmtPrice(dailyAvg)} accent="info" />
              <KPI label="Range" value={`${fmtNum(trough)} – ${fmtNum(peak)}`} sub="€/MWh" />
            </div>

            {m.data.warnings.length > 0 && (
              <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded p-3">
                {m.data.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <Panel title="Forecast with 80% confidence band">
              <div className="h-80">
                <ResponsiveContainer>
                  <ComposedChart data={chartData}>
                    <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                    <XAxis dataKey="ts" stroke="var(--color-muted-foreground)" fontSize={10} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" €" />
                    <Tooltip contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area dataKey="band" stroke="none" fill="#1ec8c8" fillOpacity={0.15} name="80% CI" />
                    <Line dataKey="forecast" stroke="#1ec8c8" dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </>
        )}
      </div>
    </>
  );
}
