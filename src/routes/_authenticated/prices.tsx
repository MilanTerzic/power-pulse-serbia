import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download } from "lucide-react";
import { getAverageDAProfile } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { DataBadge } from "@/components/data-badge";
import { fmtPrice, downloadCSV, fmtNum } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";
import {
  MARKET_PRESETS,
  PRICE_MARKETS,
  PRICE_MARKET_LIST,
  type PriceMarketCode,
} from "@/lib/price-markets";

export const Route = createFileRoute("/_authenticated/prices")({
  head: () => ({ meta: [{ title: "Prices - SEE Trading Desk" }] }),
  component: PricesPage,
});

function PricesPage() {
  const fn = useServerFn(getAverageDAProfile);
  const { range } = useDateRange();
  const q = useQuery({
    queryKey: ["da_profile", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const rows = q.data?.rows ?? [];
  const [selectedMarkets, setSelectedMarkets] = useState<PriceMarketCode[]>(MARKET_PRESETS.core);

  const chartData = Array.from({ length: 24 }, (_, hour) => {
    const row: Record<string, number | string | null> = {
      hour: `${String(hour).padStart(2, "0")}:00`,
    };
    for (const r of rows) row[r.zone] = r.profile[hour];
    return row;
  });

  const stats = rows.map((r) => {
    const profile = r.profile as Array<number | null>;
    const valid = profile.filter((v): v is number => v != null && Number.isFinite(v));
    const avg = mean(valid);
    const peak = profile.slice(8, 20).filter((v): v is number => v != null && Number.isFinite(v));
    const off = [...profile.slice(0, 8), ...profile.slice(20, 24)].filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    const peakAvg = mean(peak);
    const offAvg = mean(off);
    const min = valid.length ? Math.min(...valid) : null;
    const max = valid.length ? Math.max(...valid) : null;
    const vol =
      avg != null && valid.length > 1
        ? Math.sqrt(valid.reduce((s, x) => s + (x - avg) ** 2, 0) / valid.length)
        : null;
    return {
      zone: r.zone as PriceMarketCode,
      avg,
      peakAvg,
      offAvg,
      min,
      max,
      vol,
      negativeIntervals: valid.filter((value) => value < 0).length,
      receivedIntervals: valid.length,
      expectedIntervals: 24,
      source: r.source,
      reason: r.reason,
    };
  });

  const rangeLabel = range.from === range.to ? range.from : `${range.from} -> ${range.to}`;

  return (
    <>
      <TopBar
        title="Prices"
        subtitle={`Average hourly DA profile across ${rangeLabel} · Europe/Belgrade local time`}
        onRefresh={() => q.refetch()}
        isRefreshing={q.isFetching}
        lastRefresh={rows[0]?.fetched_at}
      />
      <div className="space-y-5 p-6">
        <Panel
          title="Average DA price per hour"
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => downloadCSV("da-hourly-avg.csv", chartData as never)}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          }
        >
          <MarketPresetSelector selected={selectedMarkets} setSelected={setSelectedMarkets} />
          <div className="h-80">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" EUR" />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {rows
                  .filter((r) => selectedMarkets.includes(r.zone as PriceMarketCode))
                  .map((r) => {
                    const market = PRICE_MARKETS[r.zone as PriceMarketCode];
                    return (
                      <Line
                        key={r.zone}
                        dataKey={r.zone}
                        name={market?.label ?? r.zone}
                        stroke={market?.chartColor ?? "#94a3b8"}
                        dot={false}
                        strokeWidth={r.zone === "RS" ? 2.5 : 1.2}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    );
                  })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title="Statistics (range average)"
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => downloadCSV("price-stats.csv", stats as never)}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1.5 text-left">Market</th>
                  <th className="text-right">Baseload</th>
                  <th className="text-right">Peak (8-20h)</th>
                  <th className="text-right">Off-peak</th>
                  <th className="text-right">Min</th>
                  <th className="text-right">Max</th>
                  <th className="text-right">Volatility</th>
                  <th className="text-right">Negative</th>
                  <th className="text-right">Intervals</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.zone} className="border-t border-border/60">
                    <td className="py-1.5 font-medium" title={s.reason}>
                      {PRICE_MARKETS[s.zone]?.displayLabel ?? s.zone}
                    </td>
                    <td className="num text-right">{fmtPrice(s.avg)}</td>
                    <td className="num text-right">{fmtPrice(s.peakAvg)}</td>
                    <td className="num text-right">{fmtPrice(s.offAvg)}</td>
                    <td className="num text-right">{fmtPrice(s.min)}</td>
                    <td className="num text-right">{fmtPrice(s.max)}</td>
                    <td className="num text-right">{fmtNum(s.vol)}</td>
                    <td className="num text-right">{s.negativeIntervals}</td>
                    <td className="num text-right">
                      {s.receivedIntervals}/{s.expectedIntervals}
                    </td>
                    <td className="text-right">
                      <DataBadge source={s.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function MarketPresetSelector({
  selected,
  setSelected,
}: {
  selected: PriceMarketCode[];
  setSelected: (markets: PriceMarketCode[]) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-1.5">
      {PRICE_MARKET_LIST.map((market) => {
        const on = selected.includes(market.code);
        return (
          <button
            key={market.code}
            type="button"
            title={market.displayLabel}
            onClick={() =>
              setSelected(
                on ? selected.filter((code) => code !== market.code) : [...selected, market.code],
              )
            }
            className={`rounded border px-2 py-0.5 text-[11px] transition ${
              on
                ? "border-transparent text-background"
                : "border-border/60 bg-surface-2 text-muted-foreground"
            }`}
            style={on ? { background: market.chartColor } : undefined}
          >
            {market.code}
          </button>
        );
      })}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelected(MARKET_PRESETS.core)}
      >
        Core
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelected(MARKET_PRESETS.directNeighbours)}
      >
        Direct neighbours
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelected(MARKET_PRESETS.regional)}
      >
        Regional
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelected(MARKET_PRESETS.europeanBenchmarks)}
      >
        Benchmarks
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelected(MARKET_PRESETS.all)}
      >
        All markets
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 text-[11px]"
        onClick={() => setSelected(MARKET_PRESETS.serbiaOnly)}
      >
        Serbia only
      </Button>
    </div>
  );
}
