// EEX Serbia futures scraper (week/month/quarter/year baseload).
// Uses Firecrawl when FIRECRAWL_API_KEY is configured. Caches 6h in api_cache.
// Returns { source: "live" | "cache" | "unavailable", products: [...] } and never throws.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type EexProduct = "week" | "month" | "quarter" | "year";
export interface EexPrice {
  product: EexProduct;
  period_label: string; // e.g. "Week 50 / 2026", "January 2026"
  price_eur_mwh: number;
  fetched_at: string;
}
export interface EexResult {
  source: "live" | "cache" | "unavailable";
  reason?: string;
  prices: EexPrice[];
  fetched_at: string;
}

const CACHE_TTL = 6 * 3600;
const CACHE_KEY = "eex_rs_futures_v1";

// EEX Serbian power futures (baseload). Page contains a table per product type.
// We attempt scraping. If the markup changes or Firecrawl is unavailable, fall back to "unavailable".
const EEX_URL = "https://www.eex.com/en/market-data/power/futures";

async function cacheGet(): Promise<EexResult | null> {
  const { data } = await supabaseAdmin.from("api_cache")
    .select("payload, fetched_at, ttl_seconds").eq("key", CACHE_KEY).maybeSingle();
  if (!data) return null;
  const age = (Date.now() - new Date(data.fetched_at as string).getTime()) / 1000;
  if (age > (data.ttl_seconds ?? CACHE_TTL)) return null;
  return data.payload as EexResult;
}

async function cacheSet(r: EexResult) {
  await supabaseAdmin.from("api_cache").upsert({
    key: CACHE_KEY, payload: r as never, fetched_at: new Date().toISOString(), ttl_seconds: CACHE_TTL,
  });
}

function parsePricesFromText(md: string): EexPrice[] {
  // Look for sections labelled Serbia / SEEPEX / Serbian power.
  const lower = md.toLowerCase();
  if (!lower.includes("serb")) return [];
  const out: EexPrice[] = [];
  const now = new Date().toISOString();
  // Crude regex passes — EEX page layouts change, so we accept any of these patterns.
  // Pattern: "Week 50 2026 | 95.42" or "Cal-27 | 92.10".
  const weekRe = /(week\s*[-\s]*\d{1,2}\s*[-/\s]*20\d{2})[^\d]{0,40}(\d{2,3}[.,]\d{1,3})/gi;
  const monthRe = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+20\d{2}[^\d]{0,40}(\d{2,3}[.,]\d{1,3})/gi;
  const qRe = /(q[1-4]\s*[-/\s]*20\d{2})[^\d]{0,40}(\d{2,3}[.,]\d{1,3})/gi;
  const yearRe = /(cal[-\s]*\d{2,4}|year\s*20\d{2})[^\d]{0,40}(\d{2,3}[.,]\d{1,3})/gi;
  const push = (product: EexProduct, label: string, raw: string) => {
    const price = parseFloat(raw.replace(",", "."));
    if (Number.isFinite(price) && price > 5 && price < 1000) {
      out.push({ product, period_label: label.trim(), price_eur_mwh: price, fetched_at: now });
    }
  };
  let m: RegExpExecArray | null;
  while ((m = weekRe.exec(md))) push("week", m[1], m[2]);
  while ((m = monthRe.exec(md))) push("month", m[0].split(/\d{2,3}[.,]/)[0], m[2]);
  while ((m = qRe.exec(md))) push("quarter", m[1], m[2]);
  while ((m = yearRe.exec(md))) push("year", m[1], m[2]);
  // Dedup by product+label, keep first
  const seen = new Set<string>();
  return out.filter(p => {
    const k = `${p.product}|${p.period_label.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).filter(p => p.product === "week" || p.product === "month");
}

export async function fetchEexFutures(force = false): Promise<EexResult> {
  const now = new Date().toISOString();
  if (!force) {
    const cached = await cacheGet();
    if (cached) return { ...cached, source: "cache" };
  }
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { source: "unavailable", reason: "FIRECRAWL_API_KEY not set — connect Firecrawl to enable EEX scraping", prices: [], fetched_at: now };
  }
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: EEX_URL, formats: ["markdown"], onlyMainContent: true, waitFor: 1500 }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      return { source: "unavailable", reason: `Firecrawl HTTP ${res.status}`, prices: [], fetched_at: now };
    }
    const body = await res.json() as { data?: { markdown?: string }; markdown?: string };
    const md = body.data?.markdown ?? body.markdown ?? "";
    if (!md) return { source: "unavailable", reason: "Empty scrape result", prices: [], fetched_at: now };
    const prices = parsePricesFromText(md);
    if (!prices.length) {
      const out: EexResult = { source: "unavailable", reason: "No Serbia futures rows recognised on EEX page", prices: [], fetched_at: now };
      return out;
    }
    const out: EexResult = { source: "live", prices, fetched_at: now };
    await cacheSet(out);
    return out;
  } catch (e) {
    return { source: "unavailable", reason: e instanceof Error ? e.message : "scrape error", prices: [], fetched_at: now };
  }
}
