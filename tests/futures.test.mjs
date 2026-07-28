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
const futuresOutdir = path.join(libOutdir, "futures");

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

await mkdir(futuresOutdir, { recursive: true });
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
process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role";
process.env.FUTURES_EEX_PUBLIC_RETRY_DELAY_MS =
  process.env.FUTURES_EEX_PUBLIC_RETRY_DELAY_MS ?? "1";
globalThis.__futuresTestSupabase = createFakeSupabase();
await transpileModule(
  path.join(root, "src/lib/futures/eex-public-snapshot.server.ts"),
  path.join(futuresOutdir, "eex-public-snapshot.server.mjs"),
  [
    [
      'import { supabaseAdmin } from "@/integrations/supabase/client.server";',
      "const supabaseAdmin = globalThis.__futuresTestSupabase;",
    ],
    ['from "../futures-markets"', 'from "../futures-markets.mjs"'],
    ['from "../futures"', 'from "../futures.mjs"'],
  ],
);

const futures = await import(pathToFileURL(path.join(libOutdir, "futures.mjs")).href);
const markets = await import(pathToFileURL(path.join(libOutdir, "futures-markets.mjs")).href);
const parser = await import(pathToFileURL(path.join(libOutdir, "futures-parser.mjs")).href);
const publicParser = await import(
  pathToFileURL(path.join(libOutdir, "futures-public-parser.mjs")).href
);
const eexPublic = await import(
  pathToFileURL(path.join(futuresOutdir, "eex-public-snapshot.server.mjs")).href
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

test("public EEX selector filters expired contracts and sorts by delivery period", () => {
  const selected = eexPublic.__testing.selectCurveRows([
    filterRow({ shortCode: "RS-SEP", maturity: "Z", displayMonth: 9 }),
    filterRow({ shortCode: "RS-AUG", maturity: "A", displayMonth: 8 }),
    filterRow({ shortCode: "RS-OLD", maturity: "OLD", displayMonth: 6 }),
  ]);

  assert.deepEqual(
    selected.map((row) => row.shortCode),
    ["RS-AUG", "RS-SEP"],
  );
});

test("public EEX collection deduplicates concurrent forced refreshes", async () => {
  resetFakeSupabase();
  const calls = installFakeEexFetch();

  const [first, second] = await Promise.all([
    eexPublic.collectPublicEexSnapshots(true),
    eexPublic.collectPublicEexSnapshots(true),
  ]);

  assert.equal(first.status, "current-eod");
  assert.equal(second.status, "current-eod");
  assert.equal(first.fetchedRows, 1);
  assert.equal(calls.filter((url) => url.includes("filter-data-with-scope")).length, 1);
  assert.equal(
    calls.some((url) => url.includes("table-data")),
    false,
  );
});

test("public EEX collection reports persistence errors and serves fresh memory rows", async () => {
  resetFakeSupabase({ upsertError: "database unavailable" });
  installFakeEexFetch();

  const result = await eexPublic.collectPublicEexSnapshots(true);
  assert.equal(result.status, "partial");
  assert.equal(result.fetchedRows, 1);
  assert.equal(result.persistedRows, 0);
  assert.equal(result.failedRows, 1);
  assert.match(result.reason, /failed to persist/i);

  const provider = new eexPublic.EexPublicSnapshotProvider();
  const curve = await provider.getCurrentForwardCurve("RS");
  assert.equal(curve.contracts.length, 1);
  assert.equal(curve.status, "current-eod");
  assert.match(curve.reason, /before database persistence/i);
});

test("public EEX collection reports missing Supabase persistence configuration", async () => {
  resetFakeSupabase();
  installFakeEexFetch();
  const previousUrl = process.env.SUPABASE_URL;
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const result = await eexPublic.collectPublicEexSnapshots(true);
    assert.equal(result.status, "partial");
    assert.equal(result.fetchedRows, 1);
    assert.equal(result.persistedRows, 0);
    assert.equal(result.failedRows, 1);
    assert.match(result.reason, /SUPABASE_SERVICE_ROLE_KEY/);
  } finally {
    restoreEnv("SUPABASE_URL", previousUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previousServiceKey);
  }
});

test("public EEX collection retries rate limited widget requests", async () => {
  resetFakeSupabase();
  const calls = installRateLimitedThenSuccessfulFetch();

  const result = await eexPublic.collectPublicEexSnapshots(true);
  assert.equal(result.status, "current-eod");
  assert.equal(result.fetchedRows, 1);
  assert.equal(calls.filter((url) => url.includes("filter-data-with-scope")).length, 2);
});

test("public EEX collection falls back to stored rows when EEX is rate limited", async () => {
  resetFakeSupabase({ snapshots: [snapshotRow()] });
  installAlwaysRateLimitedFetch();

  const result = await eexPublic.collectPublicEexSnapshots(true);
  assert.equal(result.status, "cached");
  assert.equal(result.fetchedRows, 0);
  assert.equal(result.rows, 1);
  assert.match(result.reason, /HTTP 429/);
  assert.match(result.reason, /cached public EEX snapshot/);
});

test("stored public futures rows are ordered chronologically by delivery period", async () => {
  resetFakeSupabase({
    snapshots: [
      snapshotRow({
        contract_name: "RS Base Sep-26",
        external_contract_id: "RS:SEP",
        delivery_start: "2026-09-01",
      }),
      snapshotRow({
        contract_name: "RS Base Aug-26",
        external_contract_id: "RS:AUG",
        delivery_start: "2026-08-01",
      }),
    ],
  });

  const curve = await eexPublic.getLatestStoredForwardCurve("RS");
  assert.deepEqual(
    curve.contracts.map((row) => row.contract.contractName),
    ["RS Base Aug-26", "RS Base Sep-26"],
  );
});

function filterRow(overrides = {}) {
  return {
    shortCode: "RS-AUG",
    maturity: "2026-08",
    maturityType: "Month",
    area: "RS",
    product: "Base",
    displayYear: 2026,
    displayMonth: 8,
    displayQuarter: null,
    ...overrides,
  };
}

function snapshotRow(overrides = {}) {
  return {
    provider: "eex-public-snapshot",
    market_code: "RS",
    exchange: "EEX/PXE",
    product_name: "EEX-PXE Serbian Power Future",
    external_contract_id: "RS:AUG",
    contract_name: "RS Base Aug-26",
    load_type: "base",
    maturity_type: "month",
    delivery_start: "2026-08-01",
    delivery_end: "2026-08-31",
    trading_date: "2026-07-28",
    settlement_price: 95.2,
    close_price: 94.1,
    last_price: null,
    bid_price: null,
    ask_price: null,
    volume: null,
    open_interest: null,
    currency: "EUR",
    unit: "MWh",
    source_url: "https://www.eex.com/en/market-data/market-data-hub",
    source_timestamp: "2026-07-28T12:00:00Z",
    collected_at: "2026-07-28T12:05:00Z",
    ...overrides,
  };
}

function createFakeSupabase(initial = {}) {
  const state = {
    snapshots: initial.snapshots ?? [],
    runs: initial.runs ?? [],
    upsertError: initial.upsertError ?? null,
  };
  return {
    __state: state,
    from(table) {
      return createFakeQuery(state, table);
    },
  };
}

function resetFakeSupabase(initial = {}) {
  globalThis.__futuresTestSupabase.__state.snapshots = initial.snapshots ?? [];
  globalThis.__futuresTestSupabase.__state.runs = initial.runs ?? [];
  globalThis.__futuresTestSupabase.__state.upsertError = initial.upsertError ?? null;
}

function createFakeQuery(state, table) {
  const query = {
    filters: [],
    orders: [],
    maxRows: null,
    select() {
      return query;
    },
    eq(column, value) {
      query.filters.push({ column, value });
      return query;
    },
    order(column, options = {}) {
      query.orders.push({ column, ascending: options.ascending ?? true });
      return query;
    },
    limit(count) {
      query.maxRows = count;
      return query;
    },
    maybeSingle: async () => {
      const rows = applyQuery(state, table, query);
      return { data: rows[0] ?? null, error: null };
    },
    insert: async (value) => {
      if (table === "futures_collection_runs") state.runs.push(value);
      return { data: value, error: null };
    },
    upsert: async (value) => {
      if (state.upsertError) return { data: null, error: { message: state.upsertError } };
      if (table === "futures_snapshots") state.snapshots.push(value);
      return { data: value, error: null };
    },
    then(resolve, reject) {
      return Promise.resolve({ data: applyQuery(state, table, query), error: null }).then(
        resolve,
        reject,
      );
    },
  };
  return query;
}

function applyQuery(state, table, query) {
  let rows = table === "futures_snapshots" ? [...state.snapshots] : [...state.runs];
  for (const filter of query.filters) {
    rows = rows.filter((row) => row[filter.column] === filter.value);
  }
  for (const order of query.orders) {
    rows.sort((a, b) => {
      const result = String(a[order.column] ?? "").localeCompare(String(b[order.column] ?? ""));
      return order.ascending ? result : -result;
    });
  }
  if (query.maxRows != null) rows = rows.slice(0, query.maxRows);
  return rows;
}

function installFakeEexFetch() {
  const calls = [];
  globalThis.fetch = async (url) => {
    const text = String(url);
    calls.push(text);
    if (text.includes("filter-data-with-scope")) {
      return jsonResponse({
        header: [
          "shortCode",
          "maturity",
          "maturityType",
          "area",
          "product",
          "displayYear",
          "displayMonth",
          "displayQuarter",
        ],
        data: [["RS-AUG", "2026-08", "Month", "RS", "Base", 2026, 8, null]],
      });
    }
    if (text.includes("price-ticker")) {
      return jsonResponse({
        header: ["settlPx", "diffSettlPx", "lastUpdatedAt", "longName"],
        data: [[95.2, 1.1, "2026-07-28T12:00:00Z", "Serbian Power Base Aug 2026"]],
      });
    }
    throw new Error(`Unexpected EEX URL ${text}`);
  };
  return calls;
}

function installRateLimitedThenSuccessfulFetch() {
  const calls = [];
  let filterAttempts = 0;
  globalThis.fetch = async (url) => {
    const text = String(url);
    calls.push(text);
    if (text.includes("filter-data-with-scope")) {
      filterAttempts += 1;
      if (filterAttempts === 1) return errorResponse(429);
      return jsonResponse({
        header: [
          "shortCode",
          "maturity",
          "maturityType",
          "area",
          "product",
          "displayYear",
          "displayMonth",
          "displayQuarter",
        ],
        data: [["RS-AUG", "2026-08", "Month", "RS", "Base", 2026, 8, null]],
      });
    }
    if (text.includes("price-ticker")) {
      return jsonResponse({
        header: ["settlPx", "diffSettlPx", "lastUpdatedAt", "longName"],
        data: [[95.2, 1.1, "2026-07-28T12:00:00Z", "Serbian Power Base Aug 2026"]],
      });
    }
    throw new Error(`Unexpected EEX URL ${text}`);
  };
  return calls;
}

function installAlwaysRateLimitedFetch() {
  globalThis.fetch = async () => errorResponse(429);
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  };
}

function errorResponse(status, retryAfter = null) {
  return {
    ok: false,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === "retry-after" ? retryAfter : null),
    },
    json: async () => ({}),
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
