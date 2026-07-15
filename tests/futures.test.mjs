import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(tmpdir(), "power-pulse-futures-tests");
const libOutdir = path.join(outdir, "lib");

async function transpileModule(sourcePath, outPath, replacements = []) {
  let source = await readFile(sourcePath, "utf8");
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
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
await transpileModule(
  path.join(root, "src/lib/futures-markets.ts"),
  path.join(libOutdir, "futures-markets.mjs"),
);
await transpileModule(path.join(root, "src/lib/futures.ts"), path.join(libOutdir, "futures.mjs"), [
  ['from "./futures-markets"', 'from "./futures-markets.mjs"'],
]);
await transpileModule(
  path.join(root, "src/lib/futures-parser.ts"),
  path.join(libOutdir, "futures-parser.mjs"),
  [
    ['from "./futures-markets"', 'from "./futures-markets.mjs"'],
    ['from "./futures"', 'from "./futures.mjs"'],
  ],
);
await transpileModule(
  path.join(root, "src/lib/futures-public-parser.ts"),
  path.join(libOutdir, "futures-public-parser.mjs"),
  [
    ['from "./futures-markets"', 'from "./futures-markets.mjs"'],
    ['from "./futures"', 'from "./futures.mjs"'],
  ],
);

const futures = await import(pathToFileURL(path.join(libOutdir, "futures.mjs")).href);
const markets = await import(pathToFileURL(path.join(libOutdir, "futures-markets.mjs")).href);
const parser = await import(pathToFileURL(path.join(libOutdir, "futures-parser.mjs")).href);
const publicParser = await import(
  pathToFileURL(path.join(libOutdir, "futures-public-parser.mjs")).href
);
const fixture = JSON.parse(
  await readFile(path.join(root, "tests/fixtures/eex-forward-curve.sample.json"), "utf8"),
);
const manualCsv = await readFile(
  path.join(root, "tests/fixtures/futures-manual-import.sample.csv"),
  "utf8",
);

test.after(async () => {
  await rm(outdir, { recursive: true, force: true });
});

test("EEX parser separates settlement from last price and preserves missing fields", () => {
  const curve = parser.parseEexForwardCurvePayload(fixture, "RS", "2026-07-15T10:00:00Z");
  assert.equal(curve.contracts.length, 2);
  assert.equal(curve.contracts[0].settlementPrice, 112.45);
  assert.equal(curve.contracts[0].lastPrice, 112.1);
  assert.equal(curve.contracts[1].settlementPrice, null);
  assert.equal(curve.contracts[1].lastPrice, 130.5);
});

test("duplicate contracts are ignored by external contract identity", () => {
  const curve = parser.parseEexForwardCurvePayload(fixture, "RS");
  assert.deepEqual(
    curve.contracts.map((row) => row.contract.externalContractId),
    ["RS-BL-M-2026-08", "RS-PK-Q-2026-04"],
  );
});

test("contract comparison requires exact load, maturity and delivery period", () => {
  const curve = parser.parseEexForwardCurvePayload(fixture, "RS");
  const month = curve.contracts[0].contract;
  const same = { ...month, market: "HU", externalContractId: "HU-BL-M-2026-08" };
  const mismatchedDelivery = { ...same, deliveryEnd: "2026-09-30" };
  const peak = { ...same, loadType: "peak" };
  assert.equal(futures.sameComparableContract(month, same), true);
  assert.equal(futures.sameComparableContract(month, mismatchedDelivery), false);
  assert.equal(futures.sameComparableContract(month, peak), false);
});

test("month, quarter and year futures market configuration is explicit", () => {
  assert.deepEqual(markets.FUTURES_MARKETS.RS.supportedMaturityTypes, ["month", "quarter", "year"]);
  assert.deepEqual(markets.FUTURES_MARKETS.RS.supportedLoadTypes, ["base", "peak"]);
  assert.equal(markets.FUTURES_MARKETS.ME.available, false);
  assert.equal(markets.FUTURES_MARKETS.MK.available, false);
  assert.equal(markets.FUTURES_MARKETS.AL.available, false);
});

test("daily change uses settlement values only", () => {
  const price = parser.parseEexForwardCurvePayload(fixture, "RS").contracts[0];
  assert.equal(Number(futures.dailyChange(price).toFixed(2)), 1.25);
  assert.equal(Number(futures.dailyPctChange(price).toFixed(3)), 1.124);
});

test("rolling series records contract roll events and missing prices are skipped", () => {
  const series = futures.buildRollingSeries([
    {
      tradingDate: "2026-07-01",
      settlementPrice: 100,
      sourceContractId: "M1",
      sourceContractName: "Aug 2026",
    },
    {
      tradingDate: "2026-07-02",
      settlementPrice: null,
      sourceContractId: "M1",
      sourceContractName: "Aug 2026",
    },
    {
      tradingDate: "2026-07-03",
      settlementPrice: 102,
      sourceContractId: "M2",
      sourceContractName: "Sep 2026",
    },
  ]);
  assert.equal(series.length, 2);
  assert.equal(series[0].rollEvent, false);
  assert.equal(series[1].rollEvent, true);
});

test("malformed external responses do not fabricate fallback values", () => {
  const curve = parser.parseEexForwardCurvePayload({ rows: [{ contractName: "Broken" }] }, "RS");
  assert.equal(curve.status, "unavailable");
  assert.equal(curve.contracts.length, 0);
});

test("manual futures CSV parses changed column order and decimal commas", () => {
  const rows = publicParser.parseManualFuturesCsv(manualCsv, {
    collectedAt: "2026-07-15T12:00:00Z",
  });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].snapshot.settlementPrice, 95.2);
  assert.equal(rows[1].snapshot.volume, 12);
  assert.deepEqual(rows[2].errors, ["No price field supplied."]);
});

test("manual/public snapshot import removes duplicate records without inventing values", () => {
  const rows = publicParser.parseManualFuturesCsv(manualCsv);
  const snapshots = publicParser.confirmedSnapshots(rows);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].provider, "manual-import");
  assert.equal(snapshots[0].askPrice, null);
});
