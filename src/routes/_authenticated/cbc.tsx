import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Plus, Trash2, Wand2 } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { DataBadge } from "@/components/data-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { fmtEur, fmtNum, fmtPrice, fmtPct, downloadCSV } from "@/lib/format";
import { useDateRange } from "@/lib/date-range";
import { getCbcComparison, getCbcPnl, getCbcRecommendations } from "@/lib/cbc.functions";
import {
  DEFAULT_POSITIONS,
  UNDIRECTED_BORDERS,
  monthLabel,
  type CbcPosition,
  type ResaleMode,
} from "@/lib/cbc-types";
import type { ZoneCode } from "@/lib/markets";

export const Route = createFileRoute("/_authenticated/cbc")({
  head: () => ({
    meta: [
      { title: "CBC Capacity Resale — SEE Trading Desk" },
      {
        name: "description",
        content:
          "Annual vs monthly vs daily cross-border capacity auction prices, resale PnL and a seasonality-based resale strategy predictor for SEE borders.",
      },
      { property: "og:title", content: "CBC Capacity Resale — SEE Trading Desk" },
      {
        property: "og:description",
        content: "Cross-border capacity resale analytics for Serbia, Bosnia and Montenegro borders.",
      },
    ],
  }),
  component: CBCPage,
});

const POS_KEY = "cbc_positions_v2";
const MODE_KEY = "cbc_modes_v2";

function usePositions() {
  const [positions, setPositions] = useState<CbcPosition[]>(DEFAULT_POSITIONS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) setPositions(JSON.parse(raw) as CbcPosition[]);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(POS_KEY, JSON.stringify(positions));
  }, [positions, loaded]);
  return { positions, setPositions };
}

function useModes() {
  const [modes, setModes] = useState<Record<string, ResaleMode>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MODE_KEY);
      if (raw) setModes(JSON.parse(raw) as Record<string, ResaleMode>);
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(MODE_KEY, JSON.stringify(modes));
  }, [modes, loaded]);
  return { modes, setModes };
}

function useCbcRange() {
  const { range } = useDateRange();
  // Resale analysis is month-based: default to the current year when the global
  // range is a single day.
  return useMemo(() => {
    if (range.from !== range.to) return { start: range.from, end: range.to };
    const y = range.from.slice(0, 4);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }, [range.from, range.to]);
}

function CBCPage() {
  const { positions, setPositions } = usePositions();
  const { modes, setModes } = useModes();
  const { start, end } = useCbcRange();

  return (
    <>
      <TopBar
        title="CBC Capacity Resale"
        subtitle={`ENTSO-E A25 explicit allocations · ${start} → ${end}`}
      />
      <div className="p-6 space-y-4">
        <Tabs defaultValue="pnl">
          <TabsList>
            <TabsTrigger value="pnl">Resale PnL</TabsTrigger>
            <TabsTrigger value="comparison">Comparison</TabsTrigger>
            <TabsTrigger value="predictor">Predictor</TabsTrigger>
            <TabsTrigger value="positions">Positions</TabsTrigger>
          </TabsList>

          <TabsContent value="pnl" className="mt-4">
            <PnlTab
              positions={positions}
              modes={modes}
              setModes={setModes}
              start={start}
              end={end}
            />
          </TabsContent>
          <TabsContent value="comparison" className="mt-4">
            <ComparisonTab start={start} end={end} />
          </TabsContent>
          <TabsContent value="predictor" className="mt-4">
            <PredictorTab
              positions={positions}
              start={start}
              end={end}
              onApply={(applied) => setModes((m) => ({ ...m, ...applied }))}
            />
          </TabsContent>
          <TabsContent value="positions" className="mt-4">
            <PositionsTab positions={positions} setPositions={setPositions} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Resale PnL
function PnlTab({
  positions,
  modes,
  setModes,
  start,
  end,
}: {
  positions: CbcPosition[];
  modes: Record<string, ResaleMode>;
  setModes: (fn: (m: Record<string, ResaleMode>) => Record<string, ResaleMode>) => void;
  start: string;
  end: string;
}) {
  const fn = useServerFn(getCbcPnl);
  const { data: raw, isLoading } = useQuery({
    // modes are applied client-side so switching strategy is instant and persisted
    queryKey: ["cbc-pnl", start, end, positions],
    queryFn: () => fn({ data: { start, end, positions, modes: {} } }),
    enabled: positions.length > 0,
  });

  const data = useMemo(() => {
    if (!raw) return raw;
    return {
      ...raw,
      positions: raw.positions.map((p) => ({
        ...p,
        rows: p.rows.map((r) => {
          const mode = modes[`${r.position_id}:${r.month}`] ?? r.mode;
          const resale = mode === "daily" ? r.daily_price : r.monthly_price;
          const pnl =
            resale != null && r.annual_price != null
              ? (resale - r.annual_price) * r.mw * r.hours
              : null;
          return { ...r, mode, resale_price: resale, pnl };
        }),
      })),
    };
  }, [raw, modes]);

  const totals = useMemo(() => {
    const rows = data?.positions.flatMap((p) => p.rows) ?? [];
    return {
      pnl: rows.reduce((s, r) => s + (r.pnl ?? 0), 0),
      best: rows.reduce((s, r) => s + (r.best_pnl ?? 0), 0),
      mwh: rows.reduce((s, r) => s + r.mw * r.hours, 0),
    };
  }, [data]);


  if (!positions.length) return <Panel title="Resale PnL">Add a position first.</Panel>;
  if (isLoading || !data) return <Panel title="Resale PnL">Loading auction data…</Panel>;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <KPI
          label="PnL — selected strategy"
          value={fmtEur(totals.pnl, 0)}
          accent={totals.pnl >= 0 ? "success" : "destructive"}
          sub={`${start} → ${end}`}
        />
        <KPI
          label="PnL — best per month"
          value={fmtEur(totals.best, 0)}
          accent="info"
          sub="Perfect hindsight on observed auctions"
        />
        <KPI
          label="Uplift left on table"
          value={fmtEur(totals.best - totals.pnl, 0)}
          accent="warning"
        />
        <KPI label="Volume" value={`${fmtNum(totals.mwh, 0)} MWh`} accent="muted" />
      </div>

      {data.positions.map((p) => (
        <Panel
          key={p.position.id}
          title={`${p.position.label} · ${p.position.from}→${p.position.to} · ${p.position.mw} MW`}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Annual cost {fmtPrice(p.annual_cost_price)}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCSV(`cbc-pnl-${p.position.id}.csv`, p.rows as unknown as Record<string, unknown>[])
                }
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          }
        >
          <div className="h-56 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={p.rows.map((r) => ({ ...r, label: monthLabel(r.month) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fill: "#ffffff", fontSize: 11 }} />
                <YAxis tick={{ fill: "#ffffff", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "#171c24", border: "1px solid #303948" }}
                  itemStyle={{ color: "#ffffff" }}
                  labelStyle={{ color: "#ffffff" }}
                  formatter={(v: number) => fmtEur(v, 0)}
                />
                <Legend />
                <Bar dataKey="pnl" name="PnL (selected)" fill="var(--color-primary)" />
                <Bar dataKey="best_pnl" name="PnL (best)" fill="var(--color-success)" opacity={0.5} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2">Month</th>
                  <th className="text-right">Hours</th>
                  <th className="text-right">Annual cost</th>
                  <th className="text-right">Monthly</th>
                  <th className="text-right">Daily</th>
                  <th className="text-left pl-4">Sell as</th>
                  <th className="text-right">PnL</th>
                  <th className="text-right">Best</th>
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.month} className="border-b border-border/40">
                    <td className="py-1.5">{monthLabel(r.month)}</td>
                    <td className="text-right">{r.hours}</td>
                    <td className="text-right">{fmtPrice(r.annual_price)}</td>
                    <td className="text-right">{fmtPrice(r.monthly_price)}</td>
                    <td className="text-right">{fmtPrice(r.daily_price)}</td>
                    <td className="pl-4">
                      <Select
                        value={r.mode}
                        onValueChange={(v) =>
                          setModes((m) => ({ ...m, [`${r.position_id}:${r.month}`]: v as ResaleMode }))
                        }
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td
                      className={`text-right font-medium ${
                        (r.pnl ?? 0) >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {fmtEur(r.pnl, 0)}
                    </td>
                    <td className="text-right text-muted-foreground">
                      {r.best_mode ? `${r.best_mode} · ${fmtEur(r.best_pnl, 0)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- Comparison
function ComparisonTab({ start, end }: { start: string; end: string }) {
  const [border, setBorder] = useState("all");
  const fn = useServerFn(getCbcComparison);
  const { data, isLoading } = useQuery({
    queryKey: ["cbc-comparison", start, end, border],
    queryFn: () => fn({ data: { start, end, border } }),
  });

  const rows = data?.rows ?? [];
  const withData = rows.filter((r) => r.status !== "missing");

  return (
    <div className="space-y-4">
      <Panel title="Border filter" dense>
        <Select value={border} onValueChange={setBorder}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All directional borders</SelectItem>
            <SelectItem value="RS">Serbia borders</SelectItem>
            <SelectItem value="BA">Bosnia borders</SelectItem>
            <SelectItem value="ME">Montenegro borders</SelectItem>
          </SelectContent>
        </Select>
      </Panel>

      <Panel
        title={`Annual vs monthly vs daily — ${withData.length}/${rows.length} borders with data`}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCSV("cbc-comparison.csv", rows as unknown as Record<string, unknown>[])}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        }
      >
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading ENTSO-E allocations…</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2">Border</th>
                  <th className="text-right">Annual</th>
                  <th className="text-right">Monthly avg</th>
                  <th className="text-right">Daily avg</th>
                  <th className="text-right">M − A</th>
                  <th className="text-right">D − A</th>
                  <th className="text-left pl-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-border/40">
                    <td className="py-1.5 font-medium">{r.border}</td>
                    <td className="text-right">{fmtPrice(r.annual_price)}</td>
                    <td className="text-right">{fmtPrice(r.monthly_price)}</td>
                    <td className="text-right">{fmtPrice(r.daily_price)}</td>
                    <td
                      className={`text-right ${
                        (r.monthly_resale_spread ?? 0) >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {fmtNum(r.monthly_resale_spread, 2)}
                    </td>
                    <td
                      className={`text-right ${
                        (r.daily_resale_spread ?? 0) >= 0 ? "text-success" : "text-destructive"
                      }`}
                    >
                      {fmtNum(r.daily_resale_spread, 2)}
                    </td>
                    <td className="pl-4">
                      <DataBadge source={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {withData.slice(0, 4).map((r) => (
        <Panel key={r.key} title={`${r.border} — monthly vs daily auction price`}>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={r.monthly_series.map((s) => ({ ...s, label: monthLabel(s.month) }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="label" tick={{ fill: "#ffffff", fontSize: 11 }} />
                <YAxis tick={{ fill: "#ffffff", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "#171c24", border: "1px solid #303948" }}
                  itemStyle={{ color: "#ffffff" }}
                  labelStyle={{ color: "#ffffff" }}
                  formatter={(v: number) => fmtPrice(v)}
                />
                <Legend />
                <Line dataKey="monthly" name="Monthly" stroke="var(--color-primary)" dot={false} />
                <Line dataKey="daily" name="Daily" stroke="var(--color-warning)" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">{r.message}</div>
        </Panel>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Predictor
function PredictorTab({
  positions,
  start,
  end,
  onApply,
}: {
  positions: CbcPosition[];
  start: string;
  end: string;
  onApply: (modes: Record<string, ResaleMode>) => void;
}) {
  const fn = useServerFn(getCbcRecommendations);
  const [run, setRun] = useState(false);
  const { data, isFetching } = useQuery({
    queryKey: ["cbc-reco", start, end, positions],
    queryFn: () => fn({ data: { start, end, positions } }),
    enabled: run && positions.length > 0,
  });

  return (
    <div className="space-y-4">
      <Panel title="Resale strategy predictor" dense>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={() => setRun(true)} disabled={isFetching}>
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
            {isFetching ? "Scanning 3 years of auctions…" : "Run prediction"}
          </Button>
          {data && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onApply(
                  Object.fromEntries(
                    data.positions
                      .flatMap((p) => p.rows)
                      .filter((r) => r.recommendation !== "missing")
                      .map((r) => [`${r.position_id}:${r.month}`, r.recommendation as ResaleMode]),
                  ),
                )
              }
            >
              Apply to PnL strategy
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground max-w-xl">
            {data?.method ??
              "Weighted same-month seasonality over the last 3 years plus recent level and trend."}
          </span>
        </div>
      </Panel>

      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <KPI
              label="Expected PnL"
              value={fmtEur(data.summary.total_expected_pnl, 0)}
              accent={data.summary.total_expected_pnl >= 0 ? "success" : "destructive"}
            />
            <KPI
              label="Uplift vs other product"
              value={fmtEur(data.summary.total_incremental, 0)}
              accent="info"
            />
            <KPI
              label="Sell daily / monthly"
              value={`${data.summary.daily_count} / ${data.summary.monthly_count}`}
              accent="muted"
            />
            <KPI label="Months without history" value={data.summary.missing} accent="warning" />
          </div>

          {data.positions.map((p) => (
            <Panel key={p.position.id} title={`${p.position.label} · ${p.position.mw} MW`}>
              <div className="overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left py-2">Month</th>
                      <th className="text-right">Monthly fc</th>
                      <th className="text-right">Daily fc</th>
                      <th className="text-left pl-4">Recommend</th>
                      <th className="text-right">Probability</th>
                      <th className="text-right">Confidence</th>
                      <th className="text-right">Expected PnL</th>
                      <th className="text-right">Uplift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.rows.map((r) => (
                      <tr key={r.month} className="border-b border-border/40">
                        <td className="py-1.5">{monthLabel(r.month)}</td>
                        <td className="text-right">{fmtPrice(r.monthly_fc)}</td>
                        <td className="text-right">{fmtPrice(r.daily_fc)}</td>
                        <td className="pl-4">
                          <Badge
                            variant="outline"
                            className={
                              r.recommendation === "daily"
                                ? "border-warning/40 text-warning"
                                : r.recommendation === "monthly"
                                  ? "border-primary/40 text-primary"
                                  : "border-muted text-muted-foreground"
                            }
                          >
                            {r.recommendation}
                          </Badge>
                        </td>
                        <td className="text-right">{fmtPct(r.probability)}</td>
                        <td className="text-right">{fmtPct(r.confidence)}</td>
                        <td
                          className={`text-right ${
                            (r.expected_pnl ?? 0) >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {fmtEur(r.expected_pnl, 0)}
                        </td>
                        <td className="text-right text-muted-foreground">
                          {fmtEur(r.incremental_vs_other, 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Positions
const ZONE_OPTIONS: ZoneCode[] = Array.from(
  new Set(UNDIRECTED_BORDERS.flat()),
) as ZoneCode[];

function PositionsTab({
  positions,
  setPositions,
}: {
  positions: CbcPosition[];
  setPositions: (p: CbcPosition[]) => void;
}) {
  const update = (id: string, patch: Partial<CbcPosition>) =>
    setPositions(positions.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <Panel
      title="Booked annual capacity positions"
      actions={
        <Button
          size="sm"
          onClick={() =>
            setPositions([
              ...positions,
              {
                id: `pos_${Date.now()}`,
                label: "New position",
                from: "RS",
                to: "HU",
                mw: 10,
                annual_booked_price: null,
              },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      }
    >
      <div className="space-y-3">
        {positions.map((p) => (
          <div key={p.id} className="grid gap-3 md:grid-cols-6 items-end border-b border-border/40 pb-3">
            <div className="md:col-span-2">
              <Label className="text-[11px]">Label</Label>
              <Input value={p.label} onChange={(e) => update(p.id, { label: e.target.value })} />
            </div>
            <div>
              <Label className="text-[11px]">From</Label>
              <Select value={p.from} onValueChange={(v) => update(p.id, { from: v as ZoneCode })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ZONE_OPTIONS.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">To</Label>
              <Select value={p.to} onValueChange={(v) => update(p.id, { to: v as ZoneCode })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ZONE_OPTIONS.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px]">MW</Label>
              <Input
                type="number"
                value={p.mw}
                onChange={(e) => update(p.id, { mw: Number(e.target.value) })}
              />
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label className="text-[11px]">Booked €/MWh (blank = market)</Label>
                <Input
                  type="number"
                  value={p.annual_booked_price ?? ""}
                  onChange={(e) =>
                    update(p.id, {
                      annual_booked_price: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setPositions(positions.filter((x) => x.id !== p.id))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
