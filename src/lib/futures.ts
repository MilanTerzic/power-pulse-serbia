import type {
  FuturesLoadType,
  FuturesMarketCode,
  FuturesMaturityType,
  FuturesSourceStatus,
} from "./futures-markets";

export interface FuturesContract {
  market: FuturesMarketCode;
  exchange: string;
  productName: string;
  externalProductId?: string;
  externalContractId: string;
  contractName: string;
  loadType: FuturesLoadType;
  maturityType: FuturesMaturityType;
  deliveryStart: string;
  deliveryEnd: string;
  currency: "EUR";
  unit: "MWh";
}

export interface FuturesPrice {
  contract: FuturesContract;
  tradingDate: string;
  settlementPrice: number | null;
  previousSettlementPrice: number | null;
  closePrice: number | null;
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  volume: number | null;
  openInterest: number | null;
  source: string;
  sourceType: string;
  sourceTimestamp?: string;
  fetchedAt: string;
  status: FuturesSourceStatus;
}

export interface ForwardCurve {
  market: FuturesMarketCode;
  tradingDate: string | null;
  contracts: FuturesPrice[];
  source: string;
  sourceType: string;
  fetchedAt: string;
  status: FuturesSourceStatus;
  reason?: string;
}

export interface FuturesHistoryPoint {
  tradingDate: string;
  settlementPrice: number | null;
  closePrice?: number | null;
  lastPrice?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  sourceContractId: string;
  sourceContractName: string;
  rollEvent?: boolean;
}

export interface RollingSeriesPoint {
  tradingDate: string;
  price: number;
  sourceContractId: string;
  sourceContractName: string;
  rollEvent: boolean;
}

export interface FuturesDataProvider {
  getForwardCurve(market: FuturesMarketCode, tradingDate?: string): Promise<ForwardCurve>;
  getContractHistory(
    market: FuturesMarketCode,
    contractId: string,
    from: string,
    to: string,
  ): Promise<FuturesHistoryPoint[]>;
  getAvailableContracts(market: FuturesMarketCode): Promise<FuturesContract[]>;
}

export function contractComparisonKey(contract: FuturesContract) {
  return [
    contract.loadType,
    contract.maturityType,
    contract.deliveryStart,
    contract.deliveryEnd,
  ].join(":");
}

export function sameComparableContract(a: FuturesContract, b: FuturesContract) {
  return contractComparisonKey(a) === contractComparisonKey(b);
}

export function dailyChange(price: FuturesPrice) {
  if (price.settlementPrice == null || price.previousSettlementPrice == null) return null;
  return price.settlementPrice - price.previousSettlementPrice;
}

export function dailyPctChange(price: FuturesPrice) {
  const change = dailyChange(price);
  if (
    change == null ||
    price.previousSettlementPrice == null ||
    price.previousSettlementPrice === 0
  )
    return null;
  return (change / price.previousSettlementPrice) * 100;
}

export function classifyCurveShape(prices: FuturesPrice[]) {
  const base = prices
    .filter((price) => price.contract.loadType === "base" && price.settlementPrice != null)
    .sort((a, b) => a.contract.deliveryStart.localeCompare(b.contract.deliveryStart));
  if (base.length < 2) return "Insufficient data";
  const diffs = base
    .slice(1)
    .map((price, index) => price.settlementPrice! - base[index].settlementPrice!);
  const up = diffs.some((diff) => diff > 0);
  const down = diffs.some((diff) => diff < 0);
  if (up && !down) return "Contango";
  if (down && !up) return "Backwardation";
  return "Mixed";
}

export function buildRollingSeries(points: FuturesHistoryPoint[]): RollingSeriesPoint[] {
  let previousContract: string | null = null;
  return points
    .filter((point) => point.settlementPrice != null)
    .map((point) => {
      const rollEvent = previousContract != null && previousContract !== point.sourceContractId;
      previousContract = point.sourceContractId;
      return {
        tradingDate: point.tradingDate,
        price: point.settlementPrice!,
        sourceContractId: point.sourceContractId,
        sourceContractName: point.sourceContractName,
        rollEvent,
      };
    });
}

export function parseNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
