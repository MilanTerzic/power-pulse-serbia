// EEX/PXE Central-European power futures scraper.
//
// EEX's own market-data-hub is JS-gated (data loads from a private widget API
// after the user picks a "snippet"), so static scrapers see no rows. PXE
// (Power Exchange Central Europe, an EEX-group exchange) publishes the same
// baseload futures on its public ticker — Month, Quarter and Cal-year for
// Hungary (HU), Czechia (CZ), Poland (PL) and Slovakia (SK).
//
// Hungary (HUPX-area) is the standard proxy anchor for Serbia (SEEPEX) since
// SRPX itself has no liquid futures curve. We persist the Hungarian curve as
// our market anchor and also keep the other 3 zones for reference / future use.
//
// Cached 6h in api_cache. Never throws.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EexProduct = "week" | "month" | "quarter" | "year";
export type EexZone = "HU" | "CZ" | "PL" | "SK";

export interface EexPrice {
  zone: EexZone;
  product: EexProduct;
  period_label: string; // e.g. "M07-26", "Q03-26", "CAL-27"
  price_eur_mwh: number;
  fetched_at: string;
}
export interface EexResult {
  source: "live" | "cache" | "unavailable";
  reason?: string;
  // Anchor zone whose prices are used by the forecast (Hungary by default).
  anchor_zone: EexZone;
  prices: EexPrice[];
  fetched_at: string;
}

const CACHE_TTL = 6 * 3600; // 6h — futures settlements move slowly intraday
const CACHE_KEY = "eex_pxe_futures_v2"; // v2 because shape changed
const PXE_URL = "https://www.pxe.cz/Kurzovni-Listek/Burzovni-Trhy/";
const ANCHOR_ZONE: EexZone = "HU";

type SnapshotRow = {
  provider: string;
  market_code: string;
  contract_name: string;
  load_type: string;
  maturity_type: string;
  delivery_start: string | null;
  delivery_end: string | null;
  trading_date: string;
  settlement_price: number | null;
  close_price: number | null;
  last_price: number | null;
  collected_at: string;
};

type SnapshotQuery<T> = {
  select: (columns?: string) => SnapshotQuery<T>;
  eq: (column: string, value: unknown) => SnapshotQuery<T>;
  order: (column: string, options?: { ascending?: boolean }) => SnapshotQuery<T>;
  limit: (count: number) => SnapshotQuery<T>;
  then: Promise<{ data: T[] | null; error: unknown }>["then"];
};

async function cacheGet(): Promise<EexResult | null> {
  const { data } = await supabaseAdmin
    .from("api_cache")
    .select("payload, fetched_at, ttl_seconds")
    .eq("key", CACHE_KEY)
    .maybeSingle();
  if (!data) return null;
  const age = (Date.now() - new Date(data.fetched_at as string).getTime()) / 1000;
  if (age > (data.ttl_seconds ?? CACHE_TTL)) return null;
  return data.payload as unknown as EexResult;
}

async function cacheSet(r: EexResult) {
  await supabaseAdmin.from("api_cache").upsert({
    key: CACHE_KEY,
    payload: r as never,
    fetched_at: new Date().toISOString(),
    ttl_seconds: CACHE_TTL,
  });
}

async function storedSnapshotGet(): Promise<EexResult | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await (
    supabaseAdmin.from("futures_snapshots") as unknown as SnapshotQuery<SnapshotRow>
  )
    .select("*")
    .eq("market_code", ANCHOR_ZONE)
    .eq("load_type", "base")
    .order("trading_date", { ascending: false })
    .order("collected_at", { ascending: false })
    .limit(200);

  const rows = (data ?? [])
    .filter((row) => ["month", "quarter", "year"].includes(row.maturity_type))
    .filter((row) => !row.delivery_end || row.delivery_end >= today)
    .filter((row) => snapshotPrice(row) != null);
  if (!rows.length) return null;

  const latestTradingDate = rows.reduce(
    (latest, row) => (row.trading_date > latest ? row.trading_date : latest),
    rows[0].trading_date,
  );
  const latestRows = rows
    .filter((row) => row.trading_date === latestTradingDate)
    .sort((a, b) => {
      const byProduct = productRank(a.maturity_type) - productRank(b.maturity_type);
      if (byProduct !== 0) return byProduct;
      return (a.delivery_start ?? "").localeCompare(b.delivery_start ?? "");
    });
  if (!latestRows.length) return null;

  const latestCollectionAt = latestRows.reduce(
    (latest, row) => (row.collected_at > latest ? row.collected_at : latest),
    latestRows[0].collected_at,
  );

  return {
    source: "cache",
    reason: `Using stored Futures-page EEX snapshot from ${latestCollectionAt}.`,
    anchor_zone: ANCHOR_ZONE,
    prices: latestRows.map((row) => ({
      zone: ANCHOR_ZONE,
      product: row.maturity_type as EexProduct,
      period_label: snapshotPeriodLabel(row),
      price_eur_mwh: snapshotPrice(row)!,
      fetched_at: latestCollectionAt,
    })),
    fetched_at: latestCollectionAt,
  };
}

function snapshotPrice(row: SnapshotRow) {
  if (row.settlement_price != null) return row.settlement_price;
  if (row.last_price != null) return row.last_price;
  if (row.provider !== "eex-public-snapshot" && row.close_price != null) return row.close_price;
  return null;
}

function productRank(value: string) {
  if (value === "month") return 0;
  if (value === "quarter") return 1;
  if (value === "year") return 2;
  return 3;
}

function snapshotPeriodLabel(row: SnapshotRow) {
  if (!row.delivery_start) return row.contract_name;
  const date = new Date(`${row.delivery_start}T00:00:00Z`);
  const yy = String(date.getUTCFullYear()).slice(2);
  if (row.maturity_type === "month") {
    return `M${String(date.getUTCMonth() + 1).padStart(2, "0")}-${yy}`;
  }
  if (row.maturity_type === "quarter") {
    return `Q${String(Math.floor(date.getUTCMonth() / 3) + 1).padStart(2, "0")}-${yy}`;
  }
  if (row.maturity_type === "year") return `CAL-${yy}`;
  return row.contract_name;
}

// PXE ticker rows look like:
//   F PXE HU BL M07-26 / 120,35 €  0,08%
//   F PXE CZ BL Q03-26 / 103,10 €  1,73%
//   F PXE HU BL CAL-27 / 111,20 €  0,53%
// We accept "," or "." as decimal separator, and BL (baseload) only.
const ROW_RE =
  /F\s+PXE\s+(HU|CZ|PL|SK)\s+BL\s+(M\d{2}-\d{2}|Q\d{2}-\d{2}|CAL-\d{2,4})\s*\/\s*(\d{1,4}[.,]\d{1,3})\s*€/gi;

function periodToProduct(period: string): EexProduct {
  if (/^M\d{2}/i.test(period)) return "month";
  if (/^Q\d{2}/i.test(period)) return "quarter";
  return "year";
}

export function parsePxeRows(md: string): EexPrice[] {
  const out: EexPrice[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();
  let m: RegExpExecArray | null;
  while ((m = ROW_RE.exec(md))) {
    const zone = m[1].toUpperCase() as EexZone;
    const period = m[2].toUpperCase();
    const price = parseFloat(m[3].replace(",", "."));
    if (!Number.isFinite(price) || price < 5 || price > 1000) continue;
    const key = `${zone}|${period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      zone,
      product: periodToProduct(period),
      period_label: period,
      price_eur_mwh: price,
      fetched_at: now,
    });
  }
  return out;
}

export async function fetchEexFutures(force = false): Promise<EexResult> {
  const now = new Date().toISOString();
  const stored = await storedSnapshotGet();
  if (stored) return stored;

  if (!force) {
    const cached = await cacheGet();
    if (cached) return { ...cached, source: "cache" };
  }
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      source: "unavailable",
      reason: "FIRECRAWL_API_KEY not set — connect Firecrawl to enable PXE/EEX scraping",
      anchor_zone: ANCHOR_ZONE,
      prices: [],
      fetched_at: now,
    };
  }
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: PXE_URL,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 4000,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return {
        source: "unavailable",
        reason: `Firecrawl HTTP ${res.status}`,
        anchor_zone: ANCHOR_ZONE,
        prices: [],
        fetched_at: now,
      };
    }
    const body = (await res.json()) as { data?: { markdown?: string }; markdown?: string };
    const md = body.data?.markdown ?? body.markdown ?? "";
    if (!md) {
      return {
        source: "unavailable",
        reason: "Empty scrape result",
        anchor_zone: ANCHOR_ZONE,
        prices: [],
        fetched_at: now,
      };
    }
    const prices = parsePxeRows(md);
    if (!prices.length) {
      return {
        source: "unavailable",
        reason: "No PXE baseload futures rows recognised on ticker",
        anchor_zone: ANCHOR_ZONE,
        prices: [],
        fetched_at: now,
      };
    }
    const out: EexResult = {
      source: "live",
      anchor_zone: ANCHOR_ZONE,
      prices,
      fetched_at: now,
    };
    await cacheSet(out);
    return out;
  } catch (e) {
    return {
      source: "unavailable",
      reason: e instanceof Error ? e.message : "scrape error",
      anchor_zone: ANCHOR_ZONE,
      prices: [],
      fetched_at: now,
    };
  }
}
