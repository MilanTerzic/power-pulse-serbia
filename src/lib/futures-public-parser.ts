import {
  FUTURES_MARKETS,
  type FuturesMarketCode,
  type FuturesMaturityType,
} from "./futures-markets";
import { parseNullableNumber, type FuturesSnapshot } from "./futures";

const MARKET_CODES = new Set(Object.keys(FUTURES_MARKETS));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ParseOptions = {
  provider: FuturesSnapshot["provider"];
  sourceUrl: string;
  collectedAt?: string;
  defaultTradingDate?: string;
};

export type FuturesImportPreviewRow = {
  snapshot: FuturesSnapshot | null;
  errors: string[];
  raw: Record<string, string>;
};

export function parseManualFuturesCsv(text: string, options?: Partial<ParseOptions>) {
  return parseDelimitedFuturesTable(text, {
    provider: "manual-import",
    sourceUrl: "manual-import",
    collectedAt: new Date().toISOString(),
    ...options,
  });
}

export function parsePublicEexVisibleTable(text: string, options: ParseOptions) {
  return parseDelimitedFuturesTable(text, options);
}

export function confirmedSnapshots(rows: FuturesImportPreviewRow[]) {
  const seen = new Set<string>();
  const snapshots: FuturesSnapshot[] = [];
  for (const row of rows) {
    if (!row.snapshot || row.errors.length) continue;
    const identity = [
      row.snapshot.provider,
      row.snapshot.marketCode,
      row.snapshot.externalContractId ?? row.snapshot.contractName,
      row.snapshot.tradingDate,
    ].join(":");
    if (seen.has(identity)) continue;
    seen.add(identity);
    snapshots.push(row.snapshot);
  }
  return snapshots;
}

function parseDelimitedFuturesTable(
  text: string,
  options: ParseOptions,
): FuturesImportPreviewRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter).map(normalizeHeader);
  return lines.slice(1).map((line) => parseRow(headers, splitLine(line, delimiter), options));
}

function parseRow(
  headers: string[],
  values: string[],
  options: ParseOptions,
): FuturesImportPreviewRow {
  const raw = Object.fromEntries(
    headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
  );
  const errors: string[] = [];
  const marketCode = value(raw, "market", "market_code", "code") as FuturesMarketCode;
  const market = FUTURES_MARKETS[marketCode];
  if (!MARKET_CODES.has(marketCode) || !market?.available)
    errors.push("Unsupported or unavailable market.");

  const contractName = value(raw, "contract", "contract_name", "name");
  if (!contractName) errors.push("Missing contract.");
  const loadType = parseLoadType(value(raw, "load_type", "load", "base_peak"));
  if (!loadType) errors.push("Missing or unsupported load type.");
  const maturityType = parseMaturityType(
    value(raw, "maturity", "maturity_type", "product") || contractName,
  );
  const deliveryStart = cleanDate(value(raw, "delivery_start", "delivery_start_date", "start"));
  const deliveryEnd = cleanDate(value(raw, "delivery_end", "delivery_end_date", "end"));
  const tradingDate = cleanDate(value(raw, "trading_date", "date")) ?? options.defaultTradingDate;
  if (!tradingDate) errors.push("Missing trading date.");

  const settlementPrice = parseNullableNumber(
    value(raw, "settlement_price", "settlement", "settle"),
  );
  const closePrice = parseNullableNumber(value(raw, "close_price", "close"));
  const lastPrice = parseNullableNumber(value(raw, "last_price", "last"));
  const bidPrice = parseNullableNumber(value(raw, "bid_price", "bid"));
  const askPrice = parseNullableNumber(value(raw, "ask_price", "ask"));
  if (
    settlementPrice == null &&
    closePrice == null &&
    lastPrice == null &&
    bidPrice == null &&
    askPrice == null
  ) {
    errors.push("No price field supplied.");
  }

  const snapshot =
    errors.length || !market || !contractName || !loadType || !maturityType || !tradingDate
      ? null
      : {
          provider: options.provider,
          marketCode,
          exchange: market.exchange,
          productName: market.eexProductName,
          externalContractId:
            value(raw, "external_contract_id", "contract_id", "id") ||
            buildManualContractId(marketCode, contractName, loadType, tradingDate),
          contractName,
          loadType,
          maturityType,
          deliveryStart,
          deliveryEnd,
          tradingDate,
          settlementPrice,
          closePrice,
          lastPrice,
          bidPrice,
          askPrice,
          volume: parseNullableNumber(value(raw, "volume")),
          openInterest: parseNullableNumber(value(raw, "open_interest", "openinterest", "oi")),
          currency: "EUR" as const,
          unit: "MWh" as const,
          sourceUrl: options.sourceUrl,
          sourceTimestamp: value(raw, "source_timestamp", "timestamp") || null,
          collectedAt: options.collectedAt ?? new Date().toISOString(),
        };
  return { snapshot, errors, raw };
}

function detectDelimiter(header: string) {
  if (header.includes("\t")) return "\t";
  if (header.includes(";")) return ";";
  return ",";
}

function splitLine(line: string, delimiter: string) {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function normalizeHeader(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function value(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const found = row[normalizeHeader(key)];
    if (found != null && found !== "") return found.trim();
  }
  return "";
}

function parseLoadType(valueIn: string) {
  const normalized = valueIn.toLowerCase();
  if (["base", "baseload", "bl"].includes(normalized)) return "base" as const;
  if (["peak", "peakload", "pl"].includes(normalized)) return "peak" as const;
  return null;
}

function parseMaturityType(valueIn: string): FuturesSnapshot["maturityType"] | null {
  const normalized = valueIn.toLowerCase();
  if (["week", "month", "quarter", "year"].includes(normalized)) {
    return normalized as FuturesSnapshot["maturityType"];
  }
  if (/^cal|year/.test(normalized)) return "year";
  if (/^q[1-4]|quarter/.test(normalized)) return "quarter";
  if (/month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/.test(normalized)) return "month";
  if (normalized) return "other";
  return null;
}

function cleanDate(valueIn: string) {
  return DATE_RE.test(valueIn) ? valueIn : null;
}

function buildManualContractId(
  market: FuturesMarketCode,
  contractName: string,
  loadType: string,
  tradingDate: string,
) {
  return [market, contractName, loadType, tradingDate]
    .join(":")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
