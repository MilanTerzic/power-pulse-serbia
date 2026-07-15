import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FUTURES_MARKETS, type FuturesMarketCode } from "../futures-markets";
import {
  type ForwardCurveResult,
  type FuturesDataProvider,
  type FuturesHistoryPoint,
  type FuturesPrice,
  type FuturesSnapshot,
} from "../futures";

const HUB_URL = "https://www.eex.com/en/market-data/market-data-hub";
const PUBLIC_API_URL = "https://api.eex-group.com/pub";
const MIN_COLLECTION_INTERVAL_MS = 12 * 60 * 60 * 1000;
const PUBLIC_MARKETS: FuturesMarketCode[] = [
  "RS",
  "HU",
  "RO",
  "BG",
  "HR",
  "SI",
  "GR",
  "IT",
  "AT",
  "DE_LU",
];
const EEX_AREA_BY_MARKET: Partial<Record<FuturesMarketCode, string>> = {
  RS: "RS",
  HU: "HU",
  RO: "RO",
  BG: "BG",
  HR: "HR",
  SI: "SI",
  GR: "GR",
  IT: "IT",
  AT: "AT",
  DE_LU: "DE",
};
const MAX_MONTHS_PER_LOAD = 4;
const MAX_QUARTERS_PER_LOAD = 3;
const MAX_YEARS_PER_LOAD = 3;

type SnapshotRow = {
  provider: FuturesSnapshot["provider"];
  market_code: FuturesMarketCode;
  exchange: string;
  product_name: string;
  external_contract_id: string | null;
  contract_name: string;
  load_type: "base" | "peak";
  maturity_type: "week" | "month" | "quarter" | "year" | "other";
  delivery_start: string | null;
  delivery_end: string | null;
  trading_date: string;
  settlement_price: number | null;
  close_price: number | null;
  last_price: number | null;
  bid_price: number | null;
  ask_price: number | null;
  volume: number | null;
  open_interest: number | null;
  currency: "EUR";
  unit: "MWh";
  source_url: string;
  source_timestamp: string | null;
  collected_at: string;
};

type FilterRow = {
  shortCode: string;
  maturity: string;
  maturityType: "Month" | "Quarter" | "Year" | string;
  area: string;
  product: "Base" | "Peak" | string;
  displayYear: number | null;
  displayMonth: number | null;
  displayQuarter: number | null;
};

type EexJsonTable = {
  header?: string[];
  data?: unknown[][];
  displayYear?: number | null;
  displayMonth?: number | null;
  displayQuarter?: number | null;
  currency?: string;
  uOM?: string;
};

type DbQuery<T> = {
  select: (columns?: string) => DbQuery<T>;
  eq: (column: string, value: unknown) => DbQuery<T>;
  order: (column: string, options?: { ascending?: boolean }) => DbQuery<T>;
  limit: (count: number) => DbQuery<T>;
  maybeSingle: () => Promise<{ data: T | null; error: unknown }>;
  insert: (values: unknown) => Promise<{ data: T | null; error: unknown }> | DbQuery<T>;
  upsert: (
    values: unknown,
    options?: { onConflict?: string },
  ) => Promise<{ data: T | null; error: unknown }> | DbQuery<T>;
  then: Promise<{ data: T[] | null; error: unknown }>["then"];
};

function futuresTable<T>(table: string) {
  return supabaseAdmin.from(table) as unknown as DbQuery<T>;
}

export class EexPublicSnapshotProvider implements FuturesDataProvider {
  providerType = "eex-public-snapshot" as const;

  async getCurrentForwardCurve(market: FuturesMarketCode): Promise<ForwardCurveResult> {
    await maybeCollectPublicSnapshots();
    return getLatestStoredForwardCurve(market);
  }

  async getForwardCurve(market: FuturesMarketCode): Promise<ForwardCurveResult> {
    return this.getCurrentForwardCurve(market);
  }

  async getContractHistory(
    market: FuturesMarketCode,
    contractId: string,
    from: string,
    to: string,
  ): Promise<FuturesHistoryPoint[]> {
    const rows = await selectSnapshotRows(market);
    return rows
      .filter((row) => (row.external_contract_id ?? row.contract_name) === contractId)
      .filter((row) => row.trading_date >= from && row.trading_date <= to)
      .sort((a, b) => a.trading_date.localeCompare(b.trading_date))
      .map((row) => ({
        tradingDate: row.trading_date,
        settlementPrice: row.settlement_price,
        closePrice: row.close_price,
        lastPrice: row.last_price,
        bidPrice: row.bid_price,
        askPrice: row.ask_price,
        volume: row.volume,
        openInterest: row.open_interest,
        sourceContractId: row.external_contract_id ?? row.contract_name,
        sourceContractName: row.contract_name,
      }));
  }

  async getAvailableContracts(market: FuturesMarketCode) {
    const curve = await this.getCurrentForwardCurve(market);
    return curve.contracts.map((price) => price.contract);
  }
}

export async function getLatestStoredForwardCurve(
  market: FuturesMarketCode,
): Promise<ForwardCurveResult> {
  const marketConfig = FUTURES_MARKETS[market];
  const now = new Date().toISOString();
  if (!marketConfig.available) {
    return {
      market,
      tradingDate: null,
      contracts: [],
      source: "EEX",
      sourceType: "Public EEX Snapshot Mode",
      fetchedAt: now,
      status: "unsupported-product",
      providerType: "eex-public-snapshot",
      reason: "No verified EEX futures product",
    };
  }

  const rows = await selectSnapshotRows(market);
  if (!rows.length) {
    return {
      market,
      tradingDate: null,
      contracts: [],
      source: "EEX Market Data Hub",
      sourceType: "Public EEX Snapshot Mode",
      fetchedAt: now,
      status: "unavailable",
      providerType: "eex-public-snapshot",
      reason: "No data collected yet",
    };
  }

  const latestTradingDate = rows.reduce(
    (latest, row) => (row.trading_date > latest ? row.trading_date : latest),
    rows[0].trading_date,
  );
  const latestRows = rows.filter((row) => row.trading_date === latestTradingDate);
  const firstHistoricalDate = rows.reduce(
    (first, row) => (row.trading_date < first ? row.trading_date : first),
    rows[0].trading_date,
  );
  const latestCollectionAt = latestRows.reduce(
    (latest, row) => (row.collected_at > latest ? row.collected_at : latest),
    latestRows[0].collected_at,
  );
  const stale = Date.now() - new Date(latestCollectionAt).getTime() > 36 * 60 * 60 * 1000;
  return {
    market,
    tradingDate: latestTradingDate,
    contracts: latestRows.map(snapshotRowToPrice),
    source: latestRows[0].provider === "manual-import" ? "Manual import" : "EEX Market Data Hub",
    sourceType:
      latestRows[0].provider === "manual-import"
        ? "Manually imported futures reference data"
        : "Public EEX Snapshot Mode",
    fetchedAt: latestCollectionAt,
    status:
      latestRows[0].provider === "manual-import" ? "manual-import" : stale ? "stale" : "cached",
    providerType: latestRows[0].provider,
    latestCollectionAt,
    firstHistoricalDate,
  };
}

export async function upsertFuturesSnapshots(snapshots: FuturesSnapshot[]) {
  for (const snapshot of snapshots) {
    await futuresTable<SnapshotRow>("futures_snapshots").upsert(
      {
        provider: snapshot.provider,
        market_code: snapshot.marketCode,
        exchange: snapshot.exchange,
        product_name: snapshot.productName,
        external_contract_id: snapshot.externalContractId,
        contract_name: snapshot.contractName,
        load_type: snapshot.loadType,
        maturity_type: snapshot.maturityType,
        delivery_start: snapshot.deliveryStart,
        delivery_end: snapshot.deliveryEnd,
        trading_date: snapshot.tradingDate,
        settlement_price: snapshot.settlementPrice,
        close_price: snapshot.closePrice,
        last_price: snapshot.lastPrice,
        bid_price: snapshot.bidPrice,
        ask_price: snapshot.askPrice,
        volume: snapshot.volume,
        open_interest: snapshot.openInterest,
        currency: snapshot.currency,
        unit: snapshot.unit,
        source_url: snapshot.sourceUrl,
        source_timestamp: snapshot.sourceTimestamp,
        collected_at: snapshot.collectedAt,
      },
      { onConflict: "provider,market_code,external_contract_id,trading_date" },
    );
  }
}

export async function collectPublicEexSnapshots(force = false) {
  const now = new Date().toISOString();
  if (!publicSnapshotModeEnabled()) {
    return {
      status: "public-extraction-unavailable",
      collectedAt: now,
      rows: 0,
      reason: "Public snapshot mode disabled.",
    };
  }
  if (!force && !(await shouldAttemptCollection())) {
    return {
      status: "cached",
      collectedAt: now,
      rows: 0,
      reason: "Minimum collection interval not elapsed.",
    };
  }

  await markCollectionAttempt("started", null);
  try {
    const snapshots = await fetchPublicEexSnapshots(now);
    if (snapshots.length) await upsertFuturesSnapshots(snapshots);
    const status = snapshots.length ? "current-eod" : "public-extraction-unavailable";
    const reason = snapshots.length
      ? null
      : "No usable futures rows returned by the public EEX widget endpoints.";
    await markCollectionAttempt(status, reason);
    return { status, collectedAt: now, rows: snapshots.length, reason };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Public EEX collection failed.";
    await markCollectionAttempt("public-extraction-unavailable", reason);
    return { status: "public-extraction-unavailable", collectedAt: now, rows: 0, reason };
  }
}

async function fetchPublicEexSnapshots(collectedAt: string): Promise<FuturesSnapshot[]> {
  const filterRows = await fetchFilterRows();
  const selectedRows = selectCurveRows(filterRows);
  const snapshots: FuturesSnapshot[] = [];
  await allSettledBounded(
    selectedRows.map((row) => async () => {
      const snapshot = await fetchTickerSnapshot(row, collectedAt);
      if (snapshot) snapshots.push(snapshot);
    }),
    6,
  );
  return snapshots;
}

async function fetchFilterRows(): Promise<FilterRow[]> {
  const contracts = [
    {
      commodity: "All",
      pricing: "All",
      area: "All",
      product: "All",
      productSpecific: "All",
      maturityType: "All",
    },
  ];
  const data = toBase64(JSON.stringify(contracts));
  const obj = await fetchEexJson(
    `${PUBLIC_API_URL}/customise-widget/filter-data-with-scope?data=${encodeURIComponent(data)}`,
    {
      method: "POST",
      body: new URLSearchParams({ data }),
    },
  );
  const header = obj.header ?? [];
  const index = indexByHeader(header);
  return (obj.data ?? [])
    .map((row) => ({
      shortCode: String(row[index.shortCode] ?? ""),
      maturity: String(row[index.maturity] ?? ""),
      maturityType: String(row[index.maturityType] ?? ""),
      area: String(row[index.area] ?? ""),
      product: String(row[index.product] ?? ""),
      displayYear: numberOrNull(row[index.displayYear]),
      displayMonth: numberOrNull(row[index.displayMonth]),
      displayQuarter: numberOrNull(row[index.displayQuarter]),
    }))
    .filter(
      (row): row is FilterRow =>
        Boolean(row.shortCode) &&
        row.maturityType !== "" &&
        (row.product === "Base" || row.product === "Peak"),
    );
}

function selectCurveRows(rows: FilterRow[]) {
  const selected: FilterRow[] = [];
  for (const market of PUBLIC_MARKETS) {
    const area = EEX_AREA_BY_MARKET[market];
    if (!area) continue;
    for (const product of ["Base", "Peak"] as const) {
      const scoped = rows
        .filter(
          (row) =>
            row.area === area &&
            row.product === product &&
            ["Month", "Quarter", "Year"].includes(row.maturityType),
        )
        .sort((a, b) => a.maturity.localeCompare(b.maturity));
      selected.push(
        ...scoped.filter((row) => row.maturityType === "Month").slice(0, MAX_MONTHS_PER_LOAD),
      );
      selected.push(
        ...scoped.filter((row) => row.maturityType === "Quarter").slice(0, MAX_QUARTERS_PER_LOAD),
      );
      selected.push(
        ...scoped.filter((row) => row.maturityType === "Year").slice(0, MAX_YEARS_PER_LOAD),
      );
    }
  }
  return selected;
}

async function fetchTickerSnapshot(
  row: FilterRow,
  collectedAt: string,
): Promise<FuturesSnapshot | null> {
  const marketCode = marketFromArea(row.area);
  if (!marketCode) return null;
  const market = FUTURES_MARKETS[marketCode];
  const params = new URLSearchParams({
    shortCode: row.shortCode,
    area: row.area,
    product: row.product,
    commodity: "POWER",
    pricing: "F",
    maturity: row.maturity,
  });
  const ticker = await fetchEexJson(`${PUBLIC_API_URL}/market-data/price-ticker?${params}`);
  const header = ticker.header ?? [];
  const index = indexByHeader(header);
  const first = ticker.data?.[0];
  if (!first) return null;
  const settlementPrice = numberOrNull(first[index.settlPx]);
  const diff = numberOrNull(first[index.diffSettlPx]);
  const lastUpdatedAt = stringOrNull(first[index.lastUpdatedAt]);
  const longName = stringOrNull(first[index.longName]) ?? market.eexProductName;
  if (settlementPrice == null) return null;

  const tradingDate = lastUpdatedAt ? lastUpdatedAt.slice(0, 10) : collectedAt.slice(0, 10);
  const table = await fetchTableData(row, tradingDate).catch(() => null);
  const delivery = deliveryPeriod(row);
  const previousSettlement = diff == null ? null : settlementPrice - diff;
  return {
    provider: "eex-public-snapshot",
    marketCode,
    exchange: market.exchange,
    productName: market.eexProductName,
    externalContractId: `${row.shortCode}:${row.maturity}`,
    contractName: contractLabel(row, longName),
    loadType: row.product === "Peak" ? "peak" : "base",
    maturityType: maturityType(row.maturityType),
    deliveryStart: delivery.start,
    deliveryEnd: delivery.end,
    tradingDate,
    settlementPrice,
    closePrice: previousSettlement,
    lastPrice: null,
    bidPrice: null,
    askPrice: null,
    volume: table?.volume ?? null,
    openInterest: table?.openInterest ?? null,
    currency: "EUR",
    unit: "MWh",
    sourceUrl: HUB_URL,
    sourceTimestamp: lastUpdatedAt,
    collectedAt,
  };
}

async function fetchTableData(row: FilterRow, tradingDate: string) {
  const params = new URLSearchParams({
    shortCode: row.shortCode,
    commodity: "POWER",
    pricing: "F",
    area: row.area,
    product: row.product,
    maturity: row.maturity,
    startDate: tradingDate,
    endDate: tradingDate,
    maturityType: row.maturityType,
    isRolling: "true",
  });
  const table = await fetchEexJson(`${PUBLIC_API_URL}/market-data/table-data?${params}`);
  const header = table.header ?? [];
  const index = indexByHeader(header);
  const first = table.data?.[0];
  if (!first) return null;
  return {
    volume: numberOrNull(first[index.totVolTrdd]),
    openInterest: numberOrNull(first[index.grossOpenInt]),
  };
}

async function fetchEexJson(url: string, init?: RequestInit): Promise<EexJsonTable> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "power-pulse-serbia/1.0 public-snapshot",
      referer: HUB_URL,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`EEX public endpoint returned HTTP ${response.status}`);
  }
  return (await response.json()) as EexJsonTable;
}

async function maybeCollectPublicSnapshots() {
  if (publicSnapshotModeEnabled() && (await shouldAttemptCollection())) {
    await collectPublicEexSnapshots(false);
  }
}

async function shouldAttemptCollection() {
  const { data } = await futuresTable<{ attempted_at: string }>("futures_collection_runs")
    .select("attempted_at")
    .eq("provider", "eex-public-snapshot")
    .order("attempted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.attempted_at) return true;
  return Date.now() - new Date(data.attempted_at).getTime() >= MIN_COLLECTION_INTERVAL_MS;
}

async function markCollectionAttempt(status: string, reason: string | null) {
  await futuresTable("futures_collection_runs").insert({
    provider: "eex-public-snapshot",
    attempted_at: new Date().toISOString(),
    status,
    reason,
  });
}

async function selectSnapshotRows(market: FuturesMarketCode): Promise<SnapshotRow[]> {
  const { data } = await futuresTable<SnapshotRow>("futures_snapshots")
    .select("*")
    .eq("market_code", market)
    .order("trading_date", { ascending: false })
    .order("collected_at", { ascending: false });
  return (data ?? []) as SnapshotRow[];
}

function snapshotRowToPrice(row: SnapshotRow): FuturesPrice {
  const externalContractId = row.external_contract_id ?? `${row.market_code}:${row.contract_name}`;
  return {
    contract: {
      market: row.market_code,
      exchange: row.exchange,
      productName: row.product_name,
      externalContractId,
      contractName: row.contract_name,
      loadType: row.load_type,
      maturityType: row.maturity_type,
      deliveryStart: row.delivery_start ?? "",
      deliveryEnd: row.delivery_end ?? "",
      currency: row.currency,
      unit: row.unit,
    },
    tradingDate: row.trading_date,
    settlementPrice: row.settlement_price,
    previousSettlementPrice: row.provider === "eex-public-snapshot" ? row.close_price : null,
    closePrice: row.provider === "eex-public-snapshot" ? null : row.close_price,
    lastPrice: row.last_price,
    bidPrice: row.bid_price,
    askPrice: row.ask_price,
    volume: row.volume,
    openInterest: row.open_interest,
    source: row.provider === "manual-import" ? "Manual import" : "EEX Market Data Hub",
    sourceType:
      row.provider === "manual-import"
        ? "Manually imported futures reference data"
        : "Public EEX Snapshot Mode",
    sourceTimestamp: row.source_timestamp ?? undefined,
    fetchedAt: row.collected_at,
    status: row.provider === "manual-import" ? "manual-import" : "cached",
    providerType: row.provider,
    sourceUrl: row.source_url,
  };
}

function publicSnapshotModeEnabled() {
  return process.env.FUTURES_PUBLIC_SNAPSHOT_MODE !== "false";
}

function indexByHeader(header: string[]) {
  return Object.fromEntries(header.map((name, index) => [name, index])) as Record<string, number>;
}

function toBase64(value: string) {
  return btoa(value);
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function marketFromArea(area: string): FuturesMarketCode | null {
  const found = Object.entries(EEX_AREA_BY_MARKET).find(([, eexArea]) => eexArea === area);
  return found?.[0] as FuturesMarketCode | null;
}

function maturityType(value: string): FuturesSnapshot["maturityType"] {
  if (value === "Month") return "month";
  if (value === "Quarter") return "quarter";
  if (value === "Year") return "year";
  if (value === "Week") return "week";
  return "other";
}

function contractLabel(row: FilterRow, longName: string) {
  if (row.maturityType === "Year" && row.displayYear) {
    return `${marketFromArea(row.area) ?? row.area} ${row.product} Cal-${String(row.displayYear).slice(2)}`;
  }
  if (row.maturityType === "Quarter" && row.displayYear && row.displayQuarter) {
    return `${marketFromArea(row.area) ?? row.area} ${row.product} Q${row.displayQuarter}-${String(row.displayYear).slice(2)}`;
  }
  if (row.maturityType === "Month" && row.displayYear && row.displayMonth) {
    const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(row.displayYear, row.displayMonth - 1, 1)),
    );
    return `${marketFromArea(row.area) ?? row.area} ${row.product} ${month}-${String(row.displayYear).slice(2)}`;
  }
  return longName;
}

function deliveryPeriod(row: FilterRow) {
  if (row.maturityType === "Year" && row.displayYear) {
    return { start: `${row.displayYear}-01-01`, end: `${row.displayYear}-12-31` };
  }
  if (row.maturityType === "Quarter" && row.displayYear && row.displayQuarter) {
    const startMonth = (row.displayQuarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return {
      start: `${row.displayYear}-${String(startMonth).padStart(2, "0")}-01`,
      end: lastDayOfMonth(row.displayYear, endMonth),
    };
  }
  if (row.maturityType === "Month" && row.displayYear && row.displayMonth) {
    return {
      start: `${row.displayYear}-${String(row.displayMonth).padStart(2, "0")}-01`,
      end: lastDayOfMonth(row.displayYear, row.displayMonth),
    };
  }
  return { start: null, end: null };
}

function lastDayOfMonth(year: number, month: number) {
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

async function allSettledBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number) {
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      try {
        await tasks[index]();
      } catch {
        // Keep successful public rows when one EEX widget request fails.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
}
