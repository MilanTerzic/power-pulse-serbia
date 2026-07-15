import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FUTURES_MARKETS,
  type FuturesLoadType,
  type FuturesMarketCode,
  type FuturesMaturityType,
} from "./futures-markets";
import {
  type ForwardCurve,
  type FuturesContract,
  type FuturesDataProvider,
  type FuturesHistoryPoint,
} from "./futures";
import { parseEexForwardCurvePayload } from "./futures-parser";

const CACHE_TTL_SECONDS = 6 * 3600;

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
  const provider = new EexDataSourceProvider();
  const curves = await Promise.all(
    Object.values(FUTURES_MARKETS).map(async (market) => provider.getForwardCurve(market.code)),
  );
  return {
    markets: Object.values(FUTURES_MARKETS),
    curves,
    fetchedAt: nowISO(),
    sourceNote:
      "Source: EEX. Licensed EEX Group DataSource connection required for live settlement curves.",
  };
});

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

export { cacheSet as cacheFuturesResult };
export { parseEexForwardCurvePayload };
