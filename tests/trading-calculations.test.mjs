import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "power-pulse-tests");
const libOutdir = path.join(outdir, "lib");
const outfile = path.join(libOutdir, "trading-calculations.mjs");
const priceMarketsOutfile = path.join(libOutdir, "price-markets.mjs");
const priceAnalysisOutfile = path.join(libOutdir, "price-analysis.mjs");

async function transpileModule(sourcePath, outPath, replacements = []) {
  let source = await readFile(sourcePath, "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: true,
    },
  });
  await writeFile(outPath, result.outputText, "utf8");
}

await mkdir(libOutdir, { recursive: true });
await transpileModule(path.join(root, "src/lib/markets.ts"), path.join(libOutdir, "markets.mjs"));
await transpileModule(path.join(root, "src/lib/price-markets.ts"), priceMarketsOutfile);
await transpileModule(path.join(root, "src/lib/trading-calculations.ts"), outfile, [
  ['from "./markets"', 'from "./markets.mjs"'],
]);
await transpileModule(path.join(root, "src/lib/price-analysis.ts"), priceAnalysisOutfile, [
  ['from "./price-markets"', 'from "./price-markets.mjs"'],
  ['from "./trading-calculations"', 'from "./trading-calculations.mjs"'],
]);

const mod = await import(pathToFileURL(outfile).href);
const priceMarkets = await import(pathToFileURL(priceMarketsOutfile).href);
const priceAnalysis = await import(pathToFileURL(priceAnalysisOutfile).href);

const points = (prices) =>
  prices.map((price, index) => ({
    ts: `2026-03-28T${String(index).padStart(2, "0")}:00:00.000Z`,
    price,
    durationMinutes: 60,
  }));

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("gross and net spread calculations preserve valid zero capacity price", () => {
  assert.equal(mod.calculateGrossSpread(80, 100), 20);
  assert.equal(mod.calculateNetSpread(20, 0), 20);

  const opportunity = mod.buildRouteOpportunity({
    from: "HU",
    to: "RS",
    label: "HU -> RS",
    sourcePoints: points([80, 85]),
    destinationPoints: points([100, 105]),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 0, offered_mw: 100, allocated_mw: null },
    },
    multiDay: false,
  });

  assert.equal(opportunity.status, "validated");
  assert.equal(opportunity.capacityCost, 0);
  assert.equal(opportunity.netSpread, 20);
});

test("missing capacity price is not converted to zero", () => {
  const opportunity = mod.buildRouteOpportunity({
    from: "ME",
    to: "RS",
    label: "ME -> RS",
    sourcePoints: points([90]),
    destinationPoints: points([110]),
    capacity: {
      source: "empty",
      data: { price_eur_mwh: null, offered_mw: 100, allocated_mw: null },
    },
    multiDay: false,
  });

  assert.equal(opportunity.status, "indicative");
  assert.equal(opportunity.capacityCost, null);
  assert.equal(opportunity.netSpread, null);
});

test("import and export ranking uses only validated positive net routes", () => {
  const validated = mod.buildRouteOpportunity({
    from: "BG",
    to: "RS",
    label: "BG -> RS",
    sourcePoints: points([70]),
    destinationPoints: points([100]),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 5, offered_mw: 100, allocated_mw: null },
    },
    multiDay: false,
  });
  const negative = mod.buildRouteOpportunity({
    from: "RO",
    to: "RS",
    label: "RO -> RS",
    sourcePoints: points([99]),
    destinationPoints: points([100]),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 5, offered_mw: 100, allocated_mw: null },
    },
    multiDay: false,
  });
  const indicative = mod.buildRouteOpportunity({
    from: "ME",
    to: "RS",
    label: "ME -> RS",
    sourcePoints: points([70]),
    destinationPoints: points([100]),
    capacity: {
      source: "empty",
      data: { price_eur_mwh: null, offered_mw: null, allocated_mw: null },
    },
    multiDay: false,
  });

  assert.deepEqual(
    mod.rankOpportunities([negative, indicative, validated]).map((route) => route.label),
    ["BG -> RS"],
  );
});

test("multi-day selection falls back to indicative gross spread", () => {
  const opportunity = mod.buildRouteOpportunity({
    from: "HR",
    to: "RS",
    label: "HR -> RS",
    sourcePoints: points([80, 90]),
    destinationPoints: points([100, 110]),
    capacity: {
      source: "live",
      data: { price_eur_mwh: 1, offered_mw: 100, allocated_mw: null },
    },
    multiDay: true,
  });

  assert.equal(opportunity.status, "indicative");
  assert.equal(opportunity.grossSpread, 20);
  assert.equal(opportunity.netSpread, null);
});

test("Europe/Belgrade expected intervals handle CET/CEST transition days", () => {
  assert.equal(mod.expectedIntervalsForBelgradeDay("2026-03-29"), 23);
  assert.equal(mod.expectedIntervalsForBelgradeDay("2026-10-25"), 25);
  assert.equal(mod.expectedIntervalsForBelgradeDay("2026-01-15"), 24);
});

test("incomplete interval handling reports missing observations", () => {
  const completeness = mod.completenessForSeries(points([1, 2, 3]), ["2026-01-15"]);
  assert.equal(completeness.receivedIntervals, 3);
  assert.equal(completeness.expectedIntervals, 24);
  assert.equal(completeness.missingIntervals, 21);
});

test("Albania is not a direct Serbian import route", () => {
  assert.equal(
    mod.DIRECT_SERBIAN_IMPORT_ROUTES.some((route) => route.from === "AL" && route.to === "RS"),
    false,
  );
});

test("all configured price markets have unique ENTSO-E EIC values", () => {
  const eics = priceMarkets.PRICE_MARKET_LIST.map((market) => market.eic);
  assert.equal(new Set(eics).size, eics.length);
  assert.deepEqual(priceMarkets.PRICE_MARKET_CODES, [
    "RS",
    "HU",
    "RO",
    "BG",
    "HR",
    "ME",
    "MK",
    "SI",
    "GR",
    "IT_CSUD",
    "AT",
    "DE_LU",
    "AL",
  ]);
});

test("spread matching uses exact UTC timestamps and never array position fallback", () => {
  const serbia = [
    { ts: "2026-07-15T00:00:00.000Z", price: 100, durationMinutes: 60 },
    { ts: "2026-07-15T01:00:00.000Z", price: 110, durationMinutes: 60 },
  ];
  const market = [
    { ts: "2026-07-15T00:30:00.000Z", price: 80, durationMinutes: 60 },
    { ts: "2026-07-15T01:00:00.000Z", price: 90, durationMinutes: 60 },
  ];
  const matched = priceAnalysis.matchedSpreadPoints(market, serbia);
  assert.deepEqual(
    matched.map((point) => point.ts),
    ["2026-07-15T01:00:00.000Z"],
  );
  assert.equal(matched[0].spread, -20);
});

test("15-minute price data is counted with the correct expected interval denominator", () => {
  const qh = Array.from({ length: 96 }, (_, index) => ({
    ts: new Date(Date.parse("2026-01-15T00:00:00.000Z") + index * 15 * 60_000).toISOString(),
    price: 100 + index,
    durationMinutes: 15,
  }));
  const completeness = mod.completenessForSeries(qh, ["2026-01-15"]);
  assert.equal(completeness.expectedIntervals, 96);
  assert.equal(completeness.receivedIntervals, 96);
});

test("DST days support 23-hour and 25-hour expected interval counts", () => {
  assert.equal(priceAnalysis.expectedIntervalsForDays(["2026-03-29"]), 23);
  assert.equal(priceAnalysis.expectedIntervalsForDays(["2026-10-25"]), 25);
});

test("unavailable price markets retain neutral unavailable metadata", () => {
  const status = priceAnalysis.marketAvailabilityStatus([], ["2026-07-15"], "entsoe_no_data");
  assert.equal(status.status, "Unavailable");
  assert.equal(status.receivedIntervals, 0);
  assert.equal(status.reason, "entsoe_no_data");
});

test("market presets include benchmarks without adding them to direct neighbours", () => {
  assert.deepEqual(priceAnalysis.resolveMarketPreset("europeanBenchmarks"), [
    "RS",
    "AT",
    "DE_LU",
    "IT_CSUD",
  ]);
  assert.equal(priceAnalysis.resolveMarketPreset("directNeighbours").includes("AT"), false);
  assert.equal(priceAnalysis.resolveMarketPreset("directNeighbours").includes("IT_CSUD"), false);
});

test("select all action resolves to every configured price market", () => {
  assert.deepEqual(priceAnalysis.resolveMarketPreset("all"), priceMarkets.PRICE_MARKET_CODES);
});
