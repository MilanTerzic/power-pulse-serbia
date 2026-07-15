import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Download, RefreshCw, Upload } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { Button } from "@/components/ui/button";
import {
  getFuturesDashboard,
  importManualFuturesData,
  refreshPublicFuturesSnapshots,
} from "@/lib/eex-futures.server";
import {
  FUTURES_PRESETS,
  type FuturesLoadType,
  type FuturesMarketCode,
  type FuturesMaturityType,
} from "@/lib/futures-markets";
import {
  classifyCurveShape,
  contractComparisonKey,
  dailyChange,
  dailyPctChange,
  type FuturesPrice,
} from "@/lib/futures";
import { downloadCSV, fmtNum, fmtPrice } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/futures")({
  head: () => ({ meta: [{ title: "Futures - SEE Trading Desk" }] }),
  component: FuturesPage,
});

const MARKET_COLORS: Record<string, string> = {
  RS: "#1ec8c8",
  HU: "#5aa9e6",
  RO: "#f5b14c",
  BG: "#a78bfa",
  HR: "#34d399",
  SI: "#94a3b8",
  GR: "#fb7185",
  IT: "#f97316",
  AT: "#60a5fa",
  DE_LU: "#64748b",
};
const EMPTY_CURVES: Awaited<ReturnType<typeof getFuturesDashboard>>["curves"] = [];
const EMPTY_MARKETS: Awaited<ReturnType<typeof getFuturesDashboard>>["markets"] = [];

function FuturesPage() {
  const fn = useServerFn(getFuturesDashboard);
  const importFn = useServerFn(importManualFuturesData);
  const refreshPublicFn = useServerFn(refreshPublicFuturesSnapshots);
  const [selectedMarket, setSelectedMarket] = useState<FuturesMarketCode>("RS");
  const [selectedMarkets, setSelectedMarkets] = useState<FuturesMarketCode[]>(
    FUTURES_PRESETS.directRegion,
  );
  const [loadType, setLoadType] = useState<FuturesLoadType>("base");
  const [maturityFilter, setMaturityFilter] = useState<"combined" | FuturesMaturityType>(
    "combined",
  );
  const [manualText, setManualText] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["futures_dashboard"],
    queryFn: () => fn(),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const curves = q.data?.curves ?? EMPTY_CURVES;
  const markets = q.data?.markets ?? EMPTY_MARKETS;
  const history = q.data?.history ?? [];
  const selectedCurve = curves.find((curve) => curve.market === selectedMarket);
  const selectedRows = filterContracts(selectedCurve?.contracts ?? [], loadType, maturityFilter);
  const allRows = curves.flatMap((curve) => curve.contracts);
  const rsRows = curves.find((curve) => curve.market === "RS")?.contracts ?? [];

  const frontMonth = frontContract(rsRows, "month", "base");
  const frontQuarter = frontContract(rsRows, "quarter", "base");
  const frontYear = frontContract(rsRows, "year", "base");
  const huYear = frontContract(
    curves.find((curve) => curve.market === "HU")?.contracts ?? [],
    "year",
    "base",
  );
  const deYear = frontContract(
    curves.find((curve) => curve.market === "DE_LU")?.contracts ?? [],
    "year",
    "base",
  );
  const rsHuSpread =
    frontYear?.settlementPrice != null && huYear?.settlementPrice != null
      ? frontYear.settlementPrice - huYear.settlementPrice
      : null;
  const rsDeSpread =
    frontYear?.settlementPrice != null && deYear?.settlementPrice != null
      ? frontYear.settlementPrice - deYear.settlementPrice
      : null;

  const comparisonData = useMemo(
    () =>
      buildComparisonData(
        curves.flatMap((curve) => curve.contracts),
        selectedMarkets,
        loadType,
      ),
    [curves, selectedMarkets, loadType],
  );
  const spreadRows = buildSpreadRows(rsRows, allRows);
  const marketStatus = markets.map((market) => {
    const curve = curves.find((item) => item.market === market.code);
    return {
      ...market,
      status:
        curve?.status ?? (market.available ? "configuration-required" : "unsupported-product"),
      reason: curve?.reason ?? market.status,
      contracts: curve?.contracts.length ?? 0,
    };
  });
  const historyRows = buildHistoryRows(history, selectedMarket, loadType);
  const latestStatus =
    q.data?.provider === "eex-datasource"
      ? "Licensed EEX DataSource"
      : q.data?.latestTradingDate
        ? "Cached public snapshot"
        : "No data collected yet";

  return (
    <>
      <TopBar
        title="Futures"
        subtitle="Regional EEX/PXE electricity forward curves, settlement spreads and contract history."
        onRefresh={() => q.refetch()}
        isRefreshing={q.isFetching}
        lastRefresh={q.data?.fetchedAt}
        hideRange
      />
      <div className="space-y-5 p-4 md:p-6">
        <Panel title="Public EEX Snapshot Mode">
          <div className="flex flex-col gap-3 text-sm text-muted-foreground md:flex-row md:items-start md:justify-between">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <div>
                <p className="font-medium text-foreground">Public EEX Snapshot Mode</p>
                <p className="mt-1 max-w-4xl">
                  The dashboard uses periodic snapshots of publicly displayed EEX Market Data Hub
                  information. This is not a licensed real-time EEX DataSource feed.
                </p>
                <p className="mt-1 max-w-4xl">
                  Source reference: EEX Market Data Hub. Data displayed as periodic analytical
                  snapshots. For information and analytical purposes. Verify prices through an
                  authorised market-data source before trading or commercial use.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label={latestStatus} />
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={q.isFetching}
                onClick={async () => {
                  await refreshPublicFn();
                  await q.refetch();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh snapshot
              </Button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
            <Metric label="Provider" value={q.data?.provider ?? "eex-public-snapshot"} />
            <Metric label="Latest trading date" value={q.data?.latestTradingDate ?? "N/A"} />
            <Metric label="Latest collection" value={formatDateTime(q.data?.latestCollectionAt)} />
            <Metric label="History since" value={q.data?.firstHistoricalDate ?? "N/A"} />
          </div>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FuturesKpi label="Serbia front-month base" price={frontMonth} />
          <FuturesKpi label="Serbia front-quarter base" price={frontQuarter} />
          <FuturesKpi label="Serbia front-year base" price={frontYear} />
          <KPI
            label="RS front-year spreads"
            value={rsHuSpread == null && rsDeSpread == null ? "N/A" : fmtPrice(rsHuSpread)}
            sub={`vs HU ${fmtPrice(rsHuSpread)} · vs DE ${fmtPrice(rsDeSpread)}`}
            source={frontYear?.status ?? "empty"}
            accent={rsHuSpread != null || rsDeSpread != null ? "primary" : "warning"}
          />
        </div>

        <Panel
          title="Current forward curve"
          actions={<span className="text-[10px] text-muted-foreground">Source: EEX</span>}
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={selectedMarket}
              onChange={(event) => setSelectedMarket(event.target.value as FuturesMarketCode)}
              className="rounded border border-border/60 bg-surface-2 px-2 py-1 text-xs"
            >
              {markets.map((market) => (
                <option key={market.code} value={market.code}>
                  {market.flag} {market.country}
                </option>
              ))}
            </select>
            <Segmented
              values={["base", "peak"]}
              active={loadType}
              onChange={(value) => setLoadType(value as FuturesLoadType)}
            />
            <Segmented
              values={["combined", "month", "quarter", "year"]}
              active={maturityFilter}
              onChange={(value) => setMaturityFilter(value as typeof maturityFilter)}
            />
          </div>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={selectedRows.map(toChartPoint)}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" EUR" />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                  }}
                />
                <Line
                  dataKey="settlement"
                  name="Settlement"
                  stroke="var(--color-primary)"
                  strokeWidth={2.4}
                  dot
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!selectedRows.length && (
            <EmptyState text="No EEX futures settlements available for this market yet." />
          )}
        </Panel>

        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <Panel title="Regional forward-curve comparison">
            <MarketPresetSelector selected={selectedMarkets} setSelected={setSelectedMarkets} />
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={comparisonData}>
                  <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" EUR" />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-surface-2)",
                      border: "1px solid var(--color-border)",
                    }}
                  />
                  {selectedMarkets.map((market) => (
                    <Line
                      key={market}
                      dataKey={market}
                      name={market}
                      stroke={MARKET_COLORS[market] ?? "#94a3b8"}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {!comparisonData.length && (
              <EmptyState text="Equivalent contract comparison will appear after public or manually imported snapshots are stored." />
            )}
          </Panel>

          <Panel title="Serbia curve analytics">
            <div className="space-y-3 text-sm">
              <Metric label="Curve shape" value={classifyCurveShape(rsRows)} />
              <Metric label="Serbia vs Hungary front-year" value={fmtPrice(rsHuSpread)} />
              <Metric label="Serbia vs Germany front-year" value={fmtPrice(rsDeSpread)} />
              <Metric label="History source" value="Public EEX snapshots or manual imports" />
              <Metric
                label="Historical records"
                value={
                  q.data?.firstHistoricalDate
                    ? `Available since ${q.data.firstHistoricalDate}`
                    : "No data collected yet"
                }
              />
            </div>
          </Panel>
        </div>

        <Panel
          title="Serbia futures spreads"
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => downloadCSV("serbia-futures-spreads.csv", spreadRows as never)}
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          }
        >
          <WideTable>
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 text-left">Market</th>
                <th className="text-left">Contract</th>
                <th className="text-right">Current spread</th>
                <th className="text-right">Previous-day spread</th>
                <th className="text-right">Daily change</th>
                <th className="text-right">7D avg</th>
                <th className="text-right">30D avg</th>
                <th className="text-right">Percentile</th>
              </tr>
            </thead>
            <tbody>
              {spreadRows.length ? (
                spreadRows.map((row) => (
                  <tr key={`${row.market}-${row.contract}`} className="border-t border-border/60">
                    <td className="py-1.5">{row.market}</td>
                    <td>{row.contract}</td>
                    <td className="num text-right">{fmtPrice(row.currentSpread)}</td>
                    <td className="num text-right">{fmtPrice(row.previousSpread)}</td>
                    <td className="num text-right">{fmtPrice(row.dailyChange)}</td>
                    <td className="num text-right">N/A</td>
                    <td className="num text-right">N/A</td>
                    <td className="num text-right">N/A</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                    Serbia spreads require exact matching EEX contracts and historical snapshots.
                  </td>
                </tr>
              )}
            </tbody>
          </WideTable>
        </Panel>

        <Panel title="Contract price history">
          <p className="mb-3 text-xs text-muted-foreground">
            Historical futures prices are based on public EEX snapshots collected by this
            application. History available since {q.data?.firstHistoricalDate ?? "N/A"}.
          </p>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={historyRows}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="tradingDate" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" EUR" />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                  }}
                />
                <Line
                  dataKey="price"
                  name="Historical price"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {!historyRows.length && (
            <EmptyState text="No local futures history for the selected market/load yet." />
          )}
        </Panel>

        <Panel title="Import futures data">
          <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
            <textarea
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              className="min-h-32 rounded border border-border/60 bg-surface-2 p-3 font-mono text-xs"
              placeholder={
                "market,contract,load_type,delivery_start,delivery_end,trading_date,settlement_price\nRS,Cal-27,base,2027-01-01,2027-12-31,2026-07-15,95.20"
              }
            />
            <div className="space-y-3 text-xs text-muted-foreground">
              <p>
                Paste CSV or a copied table. Values are stored as Manually imported futures
                reference data and are not labelled as live EEX data.
              </p>
              <Button
                className="gap-1.5"
                disabled={!manualText.trim()}
                onClick={async () => {
                  const result = await importFn({ data: { text: manualText } });
                  setImportResult(`Imported ${result.imported} validated rows.`);
                  setManualText("");
                  await q.refetch();
                }}
              >
                <Upload className="h-3.5 w-3.5" />
                Import futures data
              </Button>
              {importResult && <p className="text-primary">{importResult}</p>}
            </div>
          </div>
        </Panel>

        <Panel
          title="Futures table"
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() =>
                downloadCSV("futures-contracts.csv", allRows.map(flattenPrice) as never)
              }
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          }
        >
          <WideTable>
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 text-left">Market</th>
                <th className="text-left">Exchange</th>
                <th className="text-left">Contract</th>
                <th>Load</th>
                <th>Maturity</th>
                <th className="text-left">Delivery</th>
                <th className="text-right">Settlement</th>
                <th className="text-right">Previous</th>
                <th className="text-right">Daily</th>
                <th className="text-right">Daily %</th>
                <th className="text-right">Bid</th>
                <th className="text-right">Ask</th>
                <th className="text-right">Last</th>
                <th className="text-right">Volume</th>
                <th className="text-right">Open interest</th>
                <th className="text-right">Trading date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {allRows.length ? (
                allRows.map((price) => (
                  <tr
                    key={`${price.contract.market}-${price.contract.externalContractId}`}
                    className="border-t border-border/60"
                  >
                    <td className="py-1.5">{price.contract.market}</td>
                    <td>{price.contract.exchange}</td>
                    <td>{price.contract.contractName}</td>
                    <td>{price.contract.loadType}</td>
                    <td>{price.contract.maturityType}</td>
                    <td>
                      {price.contract.deliveryStart} → {price.contract.deliveryEnd}
                    </td>
                    <td className="num text-right">{fmtPrice(price.settlementPrice)}</td>
                    <td className="num text-right">{fmtPrice(price.previousSettlementPrice)}</td>
                    <td className="num text-right">{fmtPrice(dailyChange(price))}</td>
                    <td className="num text-right">{fmtNum(dailyPctChange(price))}</td>
                    <td className="num text-right">{fmtPrice(price.bidPrice)}</td>
                    <td className="num text-right">{fmtPrice(price.askPrice)}</td>
                    <td className="num text-right">{fmtPrice(price.lastPrice)}</td>
                    <td className="num text-right">{fmtNum(price.volume)}</td>
                    <td className="num text-right">{fmtNum(price.openInterest)}</td>
                    <td className="num text-right">{price.tradingDate || "N/A"}</td>
                    <td>{statusLabel(price.status)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={17} className="py-6 text-center text-xs text-muted-foreground">
                    No futures contracts loaded. Use public snapshot refresh or import reference
                    data.
                  </td>
                </tr>
              )}
            </tbody>
          </WideTable>
        </Panel>

        <Panel title="Market availability">
          <WideTable>
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 text-left">Market</th>
                <th className="text-left">Product</th>
                <th className="text-left">Exchange</th>
                <th>Status</th>
                <th className="text-left">Reason</th>
                <th className="text-right">Contracts</th>
              </tr>
            </thead>
            <tbody>
              {marketStatus.map((market) => (
                <tr key={market.code} className="border-t border-border/60">
                  <td className="py-1.5">
                    {market.flag} {market.country}
                  </td>
                  <td>{market.eexProductName}</td>
                  <td>{market.exchange}</td>
                  <td>{statusLabel(market.status)}</td>
                  <td className="text-muted-foreground">{market.reason ?? "N/A"}</td>
                  <td className="num text-right">{market.contracts}</td>
                </tr>
              ))}
            </tbody>
          </WideTable>
          <p className="mt-3 text-xs text-muted-foreground">
            {q.data?.sourceNote ??
              "Source: EEX. Live display requires licence and server-side credentials."}
          </p>
        </Panel>
      </div>
    </>
  );
}

function FuturesKpi({ label, price }: { label: string; price?: FuturesPrice }) {
  return (
    <KPI
      label={label}
      value={fmtPrice(price?.settlementPrice)}
      sub={
        price
          ? `${price.contract.contractName} · daily ${fmtPrice(dailyChange(price))}`
          : "EEX settlement unavailable"
      }
      source={price?.status ?? "empty"}
      accent={price?.settlementPrice == null ? "warning" : "primary"}
    />
  );
}

function filterContracts(
  rows: FuturesPrice[],
  loadType: FuturesLoadType,
  maturityFilter: "combined" | FuturesMaturityType,
) {
  return rows
    .filter((row) => row.contract.loadType === loadType)
    .filter((row) => maturityFilter === "combined" || row.contract.maturityType === maturityFilter)
    .sort((a, b) => a.contract.deliveryStart.localeCompare(b.contract.deliveryStart));
}

function frontContract(
  rows: FuturesPrice[],
  maturity: FuturesMaturityType,
  loadType: FuturesLoadType,
) {
  return rows
    .filter((row) => row.contract.maturityType === maturity && row.contract.loadType === loadType)
    .sort((a, b) => a.contract.deliveryStart.localeCompare(b.contract.deliveryStart))[0];
}

function toChartPoint(price: FuturesPrice) {
  return {
    label: price.contract.contractName,
    settlement: price.settlementPrice,
    tradingDate: price.tradingDate,
  };
}

function buildComparisonData(
  rows: FuturesPrice[],
  selectedMarkets: FuturesMarketCode[],
  loadType: FuturesLoadType,
) {
  const byKey = new Map<string, Record<string, number | string | null>>();
  for (const row of rows) {
    if (!selectedMarkets.includes(row.contract.market) || row.contract.loadType !== loadType)
      continue;
    const key = contractComparisonKey(row.contract);
    const bucket = byKey.get(key) ?? {
      key,
      label: row.contract.contractName,
      deliveryStart: row.contract.deliveryStart,
    };
    bucket[row.contract.market] = row.settlementPrice;
    byKey.set(key, bucket);
  }
  return [...byKey.values()].sort((a, b) =>
    String(a.deliveryStart).localeCompare(String(b.deliveryStart)),
  );
}

function buildSpreadRows(rsRows: FuturesPrice[], allRows: FuturesPrice[]) {
  const rsByKey = new Map(rsRows.map((price) => [contractComparisonKey(price.contract), price]));
  return allRows
    .filter((price) => price.contract.market !== "RS")
    .flatMap((price) => {
      const rs = rsByKey.get(contractComparisonKey(price.contract));
      if (!rs || rs.settlementPrice == null || price.settlementPrice == null) return [];
      const previousSpread =
        rs.previousSettlementPrice != null && price.previousSettlementPrice != null
          ? rs.previousSettlementPrice - price.previousSettlementPrice
          : null;
      const currentSpread = rs.settlementPrice - price.settlementPrice;
      return [
        {
          market: price.contract.market,
          contract: price.contract.contractName,
          currentSpread,
          previousSpread,
          dailyChange: previousSpread == null ? null : currentSpread - previousSpread,
        },
      ];
    });
}

function MarketPresetSelector({
  selected,
  setSelected,
}: {
  selected: FuturesMarketCode[];
  setSelected: (markets: FuturesMarketCode[]) => void;
}) {
  const buttons = [
    ["Serbia only", FUTURES_PRESETS.serbiaOnly],
    ["Direct region", FUTURES_PRESETS.directRegion],
    ["Southeast Europe", FUTURES_PRESETS.southeastEurope],
    ["Benchmarks", FUTURES_PRESETS.europeanBenchmarks],
    ["All available", FUTURES_PRESETS.allAvailable],
  ] as const;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {buttons.map(([label, markets]) => (
        <Button
          key={label}
          size="sm"
          variant={arraysEqual(selected, markets) ? "default" : "outline"}
          className="h-7 px-2 text-[11px]"
          onClick={() => setSelected([...markets])}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function Segmented({
  values,
  active,
  onChange,
}: {
  values: readonly string[];
  active: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex rounded border border-border/60 bg-surface-2 p-0.5">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`rounded px-2 py-1 text-[11px] capitalize ${
            active === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/50 pb-2 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="num text-right text-foreground">{value}</span>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] uppercase tracking-wider text-primary">
      {label}
    </span>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Belgrade",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildHistoryRows(
  history: Array<{
    market: string;
    loadType: string;
    tradingDate: string;
    settlementPrice: number | null;
    closePrice: number | null;
    lastPrice: number | null;
    bidPrice: number | null;
    askPrice: number | null;
    contract: string;
  }>,
  market: FuturesMarketCode,
  loadType: FuturesLoadType,
) {
  return history
    .filter((row) => row.market === market && row.loadType === loadType)
    .map((row) => ({
      tradingDate: row.tradingDate,
      contract: row.contract,
      price:
        row.settlementPrice ??
        row.closePrice ??
        row.lastPrice ??
        row.bidPrice ??
        row.askPrice ??
        null,
    }))
    .filter((row) => row.price != null)
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
}

function WideTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">{children}</table>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded border border-border/60 bg-surface-2/50 px-3 py-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

function statusLabel(status: string) {
  return (
    <span className="rounded border border-border/60 bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
      {status.replaceAll("-", " ")}
    </span>
  );
}

function flattenPrice(price: FuturesPrice) {
  return {
    market: price.contract.market,
    exchange: price.contract.exchange,
    contract: price.contract.contractName,
    loadType: price.contract.loadType,
    maturityType: price.contract.maturityType,
    deliveryStart: price.contract.deliveryStart,
    deliveryEnd: price.contract.deliveryEnd,
    settlement: price.settlementPrice,
    previousSettlement: price.previousSettlementPrice,
    dailyChange: dailyChange(price),
    dailyPct: dailyPctChange(price),
    bid: price.bidPrice,
    ask: price.askPrice,
    last: price.lastPrice,
    volume: price.volume,
    openInterest: price.openInterest,
    tradingDate: price.tradingDate,
    sourceStatus: price.status,
  };
}

function arraysEqual(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
