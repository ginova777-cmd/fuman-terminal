"use strict";

const fs = require("fs");
const path = require("path");
const { serviceRoleKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";
const RECEIPT_FILE = process.env.FUMAN_RETIRED_SUPABASE_CLEANUP_RECEIPT
  || path.join(RUNTIME_DIR, "data", "scan-receipts", "retired-supabase-cleanup.json");

const RETIRED_SCORECARD_STRATEGIES = [
  "即時雷達成績單",
  "熱力圖成績單",
  "市場熱力圖成績單",
  "策略1成績單",
  "策略1開盤入成績單",
  "strategy1",
  "open-buy",
  "open_buy",
  "realtime-radar",
  "heatmap",
];

const RETIRED_RUN_PAIRS = [
  {
    key: "strategy1",
    runsTable: "strategy1_open_buy_runs",
    resultsTable: "strategy1_open_buy_results",
    strategy: "strategy1",
  },
];

const RETIRED_CACHE_ROWS = [
  {
    key: "realtime-radar-cache-latest",
    table: "fuman_realtime_radar_cache",
    query: "id=eq.latest",
  },
];

function parseArgs(argv) {
  return {
    apply: argv.includes("--apply"),
    purgeHistory: argv.includes("--purge-history"),
    json: argv.includes("--json"),
    expectClean: argv.includes("--expect-clean"),
  };
}

function credentials() {
  const url = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR });
  const key = process.env.FUMAN_RETIRED_CLEANUP_SUPABASE_SERVICE_ROLE_KEY
    || process.env.FUMAN_TERMINAL_SUPABASE_SERVICE_ROLE_KEY
    || serviceRoleKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
  if (!url || !key) throw new Error("missing Supabase URL or service role key");
  return { url: url.replace(/\/+$/, ""), key };
}

async function supabaseFetch(pathname, options = {}) {
  const { url, key } = credentials();
  const response = await fetch(`${url}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: options.prefer || "count=exact",
      ...(options.headers || {}),
    },
    body: options.body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}: ${text.slice(0, 500)}`);
  let rows = [];
  try { rows = text ? JSON.parse(text) : []; } catch {}
  const range = response.headers.get("content-range") || "";
  const countText = range.includes("/") ? range.split("/").pop() : "";
  return {
    status: response.status,
    rows: Array.isArray(rows) ? rows : [],
    count: countText && countText !== "*" ? Number(countText) : (Array.isArray(rows) ? rows.length : 0),
  };
}

async function countRows(table, query) {
  const result = await supabaseFetch(`${table}?select=*&${query}&limit=1`);
  return Number.isFinite(result.count) ? result.count : 0;
}

async function deleteRows(table, query, apply) {
  const count = await countRows(table, query).catch((error) => ({ error: error.message }));
  if (typeof count === "object") return { count: 0, deleted: 0, dryRun: !apply, error: count.error };
  if (!apply || count === 0) return { count, deleted: 0, dryRun: true };
  const result = await supabaseFetch(`${table}?${query}`, { method: "DELETE", prefer: "return=representation,count=exact" });
  return { count, deleted: result.count || result.rows.length || 0, dryRun: false };
}

function encodeValue(value) {
  return encodeURIComponent(String(value));
}

async function cleanupScorecardStrategies(args) {
  const rows = [];
  for (const strategy of RETIRED_SCORECARD_STRATEGIES) {
    rows.push({
      strategy,
      tradeRecords: await deleteRows("trade_records", `strategy=eq.${encodeValue(strategy)}`, args.apply),
      dailyRows: await deleteRows("strategy_daily_summary", `strategy=eq.${encodeValue(strategy)}`, args.apply),
    });
  }
  return rows;
}

async function listRunIds(config) {
  const query = [
    "select=run_id",
    config.strategy ? `strategy=eq.${encodeValue(config.strategy)}` : "",
    "order=finished_at.desc.nullslast",
    "limit=5000",
  ].filter(Boolean).join("&");
  const result = await supabaseFetch(`${config.runsTable}?${query}`);
  return result.rows.map((row) => row.run_id).filter(Boolean);
}

function encodeIn(values) {
  return `in.(${values.map((value) => `\"${String(value).replace(/\"/g, "\\\\\"")}\"`).join(",")})`;
}

async function cleanupRunPair(config, args) {
  const runIds = await listRunIds(config).catch((error) => {
    return { error: error.message };
  });
  if (runIds.error) return { key: config.key, error: runIds.error, runCount: 0, deletedRuns: 0, deletedResults: 0, dryRun: !args.apply };
  if (!args.purgeHistory) {
    return { key: config.key, runCount: runIds.length, deletedRuns: 0, deletedResults: 0, dryRun: true, skippedReason: "requires --purge-history" };
  }
  let deletedResults = 0;
  let deletedRuns = 0;
  for (let i = 0; i < runIds.length; i += 80) {
    const batch = runIds.slice(i, i + 80);
    const query = `run_id=${encodeIn(batch)}`;
    const results = await deleteRows(config.resultsTable, query, args.apply);
    const runs = await deleteRows(config.runsTable, query, args.apply);
    if (results.error || runs.error) throw new Error(`${config.key} purge failed: ${results.error || runs.error}`);
    deletedResults += results.deleted || 0;
    deletedRuns += runs.deleted || 0;
  }
  return { key: config.key, runCount: runIds.length, deletedRuns, deletedResults, dryRun: !args.apply };
}

async function cleanupCacheRows(args) {
  const rows = [];
  for (const item of RETIRED_CACHE_ROWS) {
    rows.push({ key: item.key, table: item.table, query: item.query, result: await deleteRows(item.table, item.query, args.apply) });
  }
  return rows;
}


function retiredFormalRemainingCount(payload) {
  const scorecard = payload.cleanup.scorecardStrategies || [];
  const scorecardCount = scorecard.reduce((sum, item) => {
    return sum + Number(item.tradeRecords?.count || 0) + Number(item.dailyRows?.count || 0);
  }, 0);
  const cacheCount = (payload.cleanup.cacheRows || []).reduce((sum, item) => sum + Number(item.result?.count || 0), 0);
  return { scorecardCount, cacheCount, total: scorecardCount + cacheCount };
}
function writeReceipt(payload) {
  fs.mkdirSync(path.dirname(RECEIPT_FILE), { recursive: true });
  fs.writeFileSync(RECEIPT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = {
    ok: true,
    source: "retired-supabase-cleanup",
    checkedAt: new Date().toISOString(),
    apply: args.apply,
    purgeHistory: args.purgeHistory,
    retiredScope: {
      formalScorecardStrategies: RETIRED_SCORECARD_STRATEGIES,
      purgeableRunPairs: RETIRED_RUN_PAIRS.map((item) => item.key),
      retiredCacheRows: RETIRED_CACHE_ROWS.map((item) => item.key),
    },
    cleanup: {
      scorecardStrategies: await cleanupScorecardStrategies(args),
      cacheRows: await cleanupCacheRows(args),
      runPairs: [],
    },
  };
  for (const pair of RETIRED_RUN_PAIRS) payload.cleanup.runPairs.push(await cleanupRunPair(pair, args));
  payload.remainingFormalRows = retiredFormalRemainingCount(payload);
  payload.ok = JSON.stringify(payload).indexOf("\"error\"") === -1;
  if (args.expectClean && payload.remainingFormalRows.total > 0) {
    payload.ok = false;
    payload.issue = "retired_formal_rows_still_present";
  }
  writeReceipt(payload);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`[retired-cleanup] ok=${payload.ok} apply=${args.apply} purgeHistory=${args.purgeHistory} remainingFormalRows=${payload.remainingFormalRows?.total ?? "--"}`);
    console.log(`[retired-cleanup] receipt=${RECEIPT_FILE}`);
  }
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[retired-cleanup] failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
