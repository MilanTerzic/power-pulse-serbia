import {
  FUTURES_MARKETS,
  type FuturesLoadType,
  type FuturesMarketCode,
  type FuturesMaturityType,
} from "./futures-markets";
import {
  contractComparisonKey,
  parseNullableNumber,
  type ForwardCurve,
  type FuturesContract,
  type FuturesPrice,
} from "./futures";

export function parseEexForwardCurvePayload(
  payload: unknown,
  market: FuturesMarketCode,
  fetchedAt = new Date().toISOString(),
): ForwardCurve {
  const raw = payload as {
    tradingDate?: string;
    sourceTimestamp?: string;
    rows?: Array<Record<string, unknown>>;
    data?: Array<Record<string, unknown>>;
  };
  const marketConfig = FUTURES_MARKETS[market];
  const rows = raw.rows ?? raw.data ?? [];
  const contracts: FuturesPrice[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const externalContractId = stringField(row.externalContractId ?? row.contractId ?? row.id);
    const contractName = stringField(row.contractName ?? row.name ?? row.contract);
    const deliveryStart = stringField(row.deliveryStart ?? row.delivery_start);
    const deliveryEnd = stringField(row.deliveryEnd ?? row.delivery_end);
    const loadType = parseLoadType(row.loadType ?? row.load_type);
    const maturityType = parseMaturityType(row.maturityType ?? row.maturity_type);
    if (
      !externalContractId ||
      !contractName ||
      !deliveryStart ||
      !deliveryEnd ||
      !loadType ||
      !maturityType
    ) {
      continue;
    }
    const contract: FuturesContract = {
      market,
      exchange: marketConfig.exchange,
      productName: marketConfig.eexProductName,
      externalProductId:
        stringField(row.externalProductId ?? row.productId) ?? marketConfig.eexProductId,
      externalContractId,
      contractName,
      loadType,
      maturityType,
      deliveryStart,
      deliveryEnd,
      currency: "EUR",
      unit: "MWh",
    };
    const identity = `${market}:${externalContractId}:${contractComparisonKey(contract)}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    contracts.push({
      contract,
      tradingDate: stringField(row.tradingDate ?? raw.tradingDate) ?? "",
      settlementPrice: parseNullableNumber(row.settlementPrice ?? row.settlement),
      previousSettlementPrice: parseNullableNumber(
        row.previousSettlementPrice ?? row.previousSettlement,
      ),
      closePrice: parseNullableNumber(row.closePrice ?? row.close),
      lastPrice: parseNullableNumber(row.lastPrice ?? row.last),
      bidPrice: parseNullableNumber(row.bidPrice ?? row.bid),
      askPrice: parseNullableNumber(row.askPrice ?? row.ask),
      volume: parseNullableNumber(row.volume),
      openInterest: parseNullableNumber(row.openInterest ?? row.open_interest),
      source: "EEX",
      sourceType: "EEX Group DataSource REST API",
      sourceTimestamp: stringField(row.sourceTimestamp ?? raw.sourceTimestamp) ?? undefined,
      fetchedAt,
      status: "live",
    });
  }

  return {
    market,
    tradingDate: stringField(raw.tradingDate) ?? contracts[0]?.tradingDate ?? null,
    contracts: contracts.sort((a, b) =>
      a.contract.deliveryStart.localeCompare(b.contract.deliveryStart),
    ),
    source: "EEX",
    sourceType: "EEX Group DataSource REST API",
    fetchedAt,
    status: contracts.length ? "live" : "unavailable",
    reason: contracts.length ? undefined : "No valid EEX futures contracts in response.",
  };
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseLoadType(value: unknown): FuturesLoadType | null {
  const normalized = String(value ?? "").toLowerCase();
  if (["base", "baseload", "bl"].includes(normalized)) return "base";
  if (["peak", "peakload", "pl"].includes(normalized)) return "peak";
  return null;
}

function parseMaturityType(value: unknown): FuturesMaturityType | null {
  const normalized = String(value ?? "").toLowerCase();
  if (["day", "weekend", "week", "month", "quarter", "year"].includes(normalized)) {
    return normalized as FuturesMaturityType;
  }
  return null;
}
