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
await transpileModule(path.join(root, "src/lib/trading-calculations.ts"), outfile, [
  ['from "./markets"', 'from "./markets.mjs"'],
]);

const mod = await import(pathToFileURL(outfile).href);

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
