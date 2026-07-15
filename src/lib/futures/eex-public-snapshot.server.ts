import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FUTURES_MARKETS, type FuturesMarketCode } from "../futures-markets";
import {
  type ForwardCurveResult,
  type FuturesDataProvider,
  type FuturesHistoryPoint,
  type FuturesPrice,
  type FuturesSnapshot,
} from "../futures";
import { confirmedSnapshots, parsePublicEexVisibleTable } from "../futures-public-parser";

const HUB_URL = "https://www.eex.com/en/market-data/market-data-hub";
const MIN_COLLECTION_INTERVAL_MS = 12 * 60 * 60 * 1000;

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
    const response = await fetch(HUB_URL, {
      headers: { "user-agent": "power-pulse-serbia/1.0 public-snapshot" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`EEX public page returned HTTP ${response.status}`);
    const html = await response.text();
    const parsed = parsePublicEexVisibleTable(htmlToDelimitedTables(html), {
      provider: "eex-public-snapshot",
      sourceUrl: HUB_URL,
      collectedAt: now,
      defaultTradingDate: now.slice(0, 10),
    });
    const snapshots = confirmedSnapshots(parsed);
    if (snapshots.length) await upsertFuturesSnapshots(snapshots);
    const status = snapshots.length ? "current-eod" : "public-extraction-unavailable";
    const reason = snapshots.length
      ? null
      : "No usable public structured futures table found in the EEX Market Data Hub HTML.";
    await markCollectionAttempt(status, reason);
    return { status, collectedAt: now, rows: snapshots.length, reason };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Public EEX collection failed.";
    await markCollectionAttempt("public-extraction-unavailable", reason);
    return { status: "public-extraction-unavailable", collectedAt: now, rows: 0, reason };
  }
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
    previousSettlementPrice: null,
    closePrice: row.close_price,
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

function htmlToDelimitedTables(html: string) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/t[dh]>/gi, ",")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ");
  const lines = text
    .split(/\n/)
    .map((line) => line.replace(/,+/g, ",").replace(/^,|,$/g, "").trim())
    .filter((line) => /market|contract|settlement|trading/i.test(line));
  return lines.join("\n");
}
