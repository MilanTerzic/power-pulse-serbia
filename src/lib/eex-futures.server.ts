import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FUTURES_MARKETS, type FuturesMarketCode } from "./futures-markets";
import {
  type ForwardCurve,
  type FuturesContract,
  type FuturesDataProvider,
  type FuturesHistoryPoint,
} from "./futures";
import { parseEexForwardCurvePayload } from "./futures-parser";
import { confirmedSnapshots, parseManualFuturesCsv } from "./futures-public-parser";
import {
  collectPublicEexSnapshots,
  EexPublicSnapshotProvider,
  upsertFuturesSnapshots,
} from "./futures/eex-public-snapshot.server";

const CACHE_TTL_SECONDS = 6 * 3600;

type StoredFuturesSnapshotRow = {
  provider: string;
  market_code: string;
  contract_name: string;
  external_contract_id: string | null;
  load_type: string;
  maturity_type: string;
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
  collected_at: string;
};

type SelectQuery<T> = {
  select: (columns?: string) => SelectQuery<T>;
  order: (
    column: string,
    options?: { ascending?: boolean },
  ) => Promise<{
    data: T[] | null;
    error: unknown;
  }>;
};

function nowISO() {
  return new Date().toISOString();
}

function dataSourceConfig() {
  return {
    apiUrl: process.env.EEX_DATASOURCE_API_URL ?? "",
    token: process.env.EEX_DATASOURCE_ACCESS_TOKEN ?? "",
  };
}

function configRequiredCurve(
  market: FuturesMarketCode,
  reason = "EEX DataSource credentials are not configured.",
): ForwardCurve {
  return {
    market,
    tradingDate: null,
    contracts: [],
    source: "EEX",
    sourceType: "EEX Group DataSource REST API",
    fetchedAt: nowISO(),
    status: "configuration-required",
    reason,
  };
}

async function cacheGet<T>(key: string): Promise<T | null> {
  const { data } = await supabaseAdmin
    .from("api_cache")
    .select("payload, fetched_at, ttl_seconds")
    .eq("key", key)
    .maybeSingle();
  if (!data) return null;
  const age = (Date.now() - new Date(data.fetched_at as string).getTime()) / 1000;
  if (age > (data.ttl_seconds ?? CACHE_TTL_SECONDS)) return null;
  return data.payload as T;
}

async function cacheSet(key: string, payload: unknown) {
  await supabaseAdmin.from("api_cache").upsert({
    key,
    payload: payload as never,
    fetched_at: nowISO(),
    ttl_seconds: CACHE_TTL_SECONDS,
  });
}

export class EexDataSourceProvider implements FuturesDataProvider {
  providerType = "eex-datasource" as const;

  async getForwardCurve(market: FuturesMarketCode, tradingDate?: string): Promise<ForwardCurve> {
    const marketConfig = FUTURES_MARKETS[market];
    if (!marketConfig.available) {
      return {
        ...configRequiredCurve(market, marketConfig.status ?? "No EEX futures contract available."),
        status: "unsupported-product",
      };
    }

    const config = dataSourceConfig();
    if (!config.apiUrl || !config.token) return configRequiredCurve(market);

    const key = `eex_futures_curve:v1:${market}:${tradingDate ?? "latest"}`;
    const cached = await cacheGet<ForwardCurve>(key);
    if (cached) return { ...cached, status: cached.status === "live" ? "cached" : cached.status };

    return configRequiredCurve(
      market,
      "EEX DataSource endpoint mapping is not configured yet. Set an approved endpoint template before enabling live requests.",
    );
  }

  async getContractHistory(): Promise<FuturesHistoryPoint[]> {
    return [];
  }

  async getAvailableContracts(market: FuturesMarketCode): Promise<FuturesContract[]> {
    const curve = await this.getForwardCurve(market);
    return curve.contracts.map((price) => price.contract);
  }
}

async function upsertFuturesSnapshot(curve: ForwardCurve) {
  for (const price of curve.contracts) {
    const { data: contractRow, error: contractError } = await supabaseAdmin
      .from("futures_contracts")
      .upsert(
        {
          market_code: price.contract.market,
          exchange: price.contract.exchange,
          product_name: price.contract.productName,
          external_product_id: price.contract.externalProductId ?? null,
          external_contract_id: price.contract.externalContractId,
          contract_name: price.contract.contractName,
          load_type: price.contract.loadType,
          maturity_type: price.contract.maturityType,
          delivery_start: price.contract.deliveryStart,
          delivery_end: price.contract.deliveryEnd,
          currency: price.contract.currency,
          unit: price.contract.unit,
        } as never,
        { onConflict: "exchange,external_contract_id" },
      )
      .select("id")
      .single();
    if (contractError || !contractRow) continue;
    await supabaseAdmin.from("futures_eod_prices").upsert(
      {
        contract_id: contractRow.id,
        trading_date: price.tradingDate,
        settlement_price: price.settlementPrice,
        close_price: price.closePrice,
        last_price: price.lastPrice,
        bid_price: price.bidPrice,
        ask_price: price.askPrice,
        volume: price.volume,
        open_interest: price.openInterest,
        source: price.sourceType,
        source_timestamp: price.sourceTimestamp ?? null,
      } as never,
      { onConflict: "contract_id,trading_date" },
    );
  }
}

export const getFuturesDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const dataSource = new EexDataSourceProvider();
  const publicSnapshot = new EexPublicSnapshotProvider();
  const curves = await Promise.all(
    Object.values(FUTURES_MARKETS).map(async (market) => {
      const licensed = await dataSource.getForwardCurve(market.code);
      if (licensed.status !== "configuration-required") return licensed;
      return publicSnapshot.getCurrentForwardCurve(market.code);
    }),
  );
  const allDates = curves.flatMap((curve) => curve.contracts.map((row) => row.tradingDate));
  const latestTradingDate = allDates.sort().at(-1) ?? null;
  const firstHistoricalDate = allDates.sort()[0] ?? null;
  const latestCollectionAt =
    curves
      .flatMap((curve) => curve.contracts.map((row) => row.fetchedAt))
      .sort()
      .at(-1) ?? null;
  return {
    markets: Object.values(FUTURES_MARKETS),
    curves,
    history: await getStoredFuturesHistory(),
    fetchedAt: nowISO(),
    latestTradingDate,
    firstHistoricalDate,
    latestCollectionAt,
    provider: curves.some((curve) => curve.providerType === "eex-datasource")
      ? "eex-datasource"
      : "eex-public-snapshot",
    sourceNote:
      "Source reference: EEX Market Data Hub. Data displayed as periodic analytical snapshots.",
  };
});

async function getStoredFuturesHistory() {
  const { data } = await (
    supabaseAdmin.from("futures_snapshots") as unknown as SelectQuery<StoredFuturesSnapshotRow>
  )
    .select("*")
    .order("trading_date", { ascending: true });
  return (data ?? []).map((row) => ({
    provider: row.provider,
    market: row.market_code,
    contract: row.contract_name,
    externalContractId: row.external_contract_id,
    loadType: row.load_type,
    maturityType: row.maturity_type,
    deliveryStart: row.delivery_start,
    deliveryEnd: row.delivery_end,
    tradingDate: row.trading_date,
    settlementPrice: row.settlement_price,
    closePrice: row.close_price,
    lastPrice: row.last_price,
    bidPrice: row.bid_price,
    askPrice: row.ask_price,
    volume: row.volume,
    openInterest: row.open_interest,
    collectedAt: row.collected_at,
  }));
}

export const collectFuturesSnapshots = createServerFn({ method: "POST" }).handler(async () => {
  const provider = new EexDataSourceProvider();
  const rows = [];
  for (const market of Object.values(FUTURES_MARKETS).filter((m) => m.available)) {
    try {
      const curve = await provider.getForwardCurve(market.code);
      if (curve.status === "live" || curve.status === "current-eod")
        await upsertFuturesSnapshot(curve);
      rows.push({
        market: market.code,
        status: curve.status,
        contracts: curve.contracts.length,
        reason: curve.reason,
      });
    } catch (error) {
      rows.push({
        market: market.code,
        status: "unavailable",
        contracts: 0,
        reason: error instanceof Error ? error.message : "collection error",
      });
    }
  }
  return { fetchedAt: nowISO(), rows };
});

export const refreshPublicFuturesSnapshots = createServerFn({ method: "POST" }).handler(async () =>
  collectPublicEexSnapshots(true),
);

export const importManualFuturesData = createServerFn({ method: "POST" })
  .inputValidator((data: { text?: string }) => data ?? {})
  .handler(async ({ data }) => {
    const preview = parseManualFuturesCsv(data?.text ?? "");
    const snapshots = confirmedSnapshots(preview);
    if (snapshots.length) await upsertFuturesSnapshots(snapshots);
    return {
      imported: snapshots.length,
      rows: preview.map((row) => ({
        ok: Boolean(row.snapshot) && row.errors.length === 0,
        errors: row.errors,
        market: row.snapshot?.marketCode ?? row.raw.market ?? null,
        contract: row.snapshot?.contractName ?? row.raw.contract ?? null,
        tradingDate: row.snapshot?.tradingDate ?? row.raw.trading_date ?? null,
        price: row.snapshot?.settlementPrice ?? row.snapshot?.lastPrice ?? null,
      })),
    };
  });

export { cacheSet as cacheFuturesResult };
export { parseEexForwardCurvePayload };
