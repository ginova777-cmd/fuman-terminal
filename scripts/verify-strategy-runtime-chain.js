const fs = require("fs");
const path = require("path");
const { captureHandler } = require("./strategy-api-capture");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt");

const STRATEGIES = [
  { key: "strategy1", endpoint: "/api/open-buy-latest", handler: "../api/open-buy-latest", allowZero: false },
  { key: "strategy2", endpoint: "/api/strategy2-latest", handler: "../api/strategy2-latest", allowZero: false },
  { key: "strategy3", endpoint: "/api/strategy3-latest", handler: "../api/strategy3-latest", allowZero: false },
  { key: "strategy4", endpoint: "/api/strategy4-latest", handler: "../api/strategy4-latest", allowZero: false },
  { key: "strategy5", endpoint: "/api/strategy5-latest", handler: "../api/strategy5-latest", allowZero: false },
];

function readSecret(name) {
  try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", name), "utf8").trim(); } catch { return ""; }
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function rowsOf(payload = {}) {
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.events)) return payload.events;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function countOf(payload = {}) {
  const count = cleanNumber(payload.count ?? payload.matchCount ?? payload.entryCount);
  return count || rowsOf(payload).length;
}

async function fetchRows(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 160)}`.trim());
  return JSON.parse(text);
}

async function verifyStatusRows(issues) {
  const keys = STRATEGIES.map((item) => item.key).join(",");
  const rows = await fetchRows("strategy_cache_status", `strategy_key=in.(${keys})&select=strategy_key,scan_status,match_count,updated_at,source`);
  const byKey = new Map((Array.isArray(rows) ? rows : []).map((row) => [row.strategy_key, row]));
  for (const strategy of STRATEGIES) {
    const row = byKey.get(strategy.key);
    if (!row) {
      issues.push(`strategy_cache_status missing ${strategy.key}`);
      continue;
    }
    if (row.scan_status !== "complete") issues.push(`strategy_cache_status ${strategy.key} not complete: ${row.scan_status}`);
    if (!strategy.allowZero && cleanNumber(row.match_count) <= 0) issues.push(`strategy_cache_status ${strategy.key} zero match_count`);
    console.log(`[strategy-chain] status ${strategy.key}: ${row.scan_status} count=${row.match_count} source=${row.source || ""}`);
  }
}

async function verifyApiHandlers(issues) {
  for (const strategy of STRATEGIES) {
    const result = await captureHandler(require(strategy.handler));
    const cache = result.headers["cache-control"] || "";
    const payload = result.body || {};
    const count = countOf(payload);
    if (!/no-store/i.test(cache)) issues.push(`${strategy.endpoint} missing no-store Cache-Control`);
    if (payload.cacheSource === "static-fallback" || payload?.transport?.source === "static-json") issues.push(`${strategy.endpoint} returned JSON fallback`);
    if (!strategy.allowZero && count <= 0) issues.push(`${strategy.endpoint} returned zero rows`);
    if (payload?.transport?.source !== "supabase") issues.push(`${strategy.endpoint} did not report Supabase transport`);
    console.log(`[strategy-chain] api ${strategy.key}: status=${result.statusCode} count=${count} gate=${payload?.transport?.gate || ""} source=${payload?.transport?.source || payload.cacheSource || ""}`);
  }
}

function verifyStaticContracts(issues) {
  const runtimeConfig = read("terminal-runtime-config.js");
  const liveCheck = read("terminal-live-check.js");
  const openBuyScanner = read("scripts/scan-open-buy-cache.js");
  for (const marker of [
    "openBuyCache: \"/api/open-buy-latest\"",
    "strategy2IntradayLatestApi: \"/api/strategy2-latest\"",
    "strategy3Cache: \"/api/strategy3-latest\"",
    "strategy4Cache: \"/api/strategy4-latest\"",
    "strategy5Cache: \"/api/strategy5-latest\"",
  ]) {
    if (!runtimeConfig.includes(marker)) issues.push(`terminal-runtime-config.js missing ${marker}`);
  }
  for (const marker of ["pollCompleteRunUpdates", "COMPLETE_RUN_POLL_MS", "openBuy", "strategy2", "strategy3", "strategy4", "strategy5"]) {
    if (!liveCheck.includes(marker)) issues.push(`terminal-live-check.js missing polling marker ${marker}`);
  }
  if (!/publishRunningStatus/.test(openBuyScanner) || !/publishCompleteOutput/.test(openBuyScanner)) {
    issues.push("strategy1 scanner missing atomic publish helpers");
  }
  if (/writeFileSync\(OUT_FILE[\s\S]{0,260}partial|partial[\s\S]{0,260}writeFileSync\(OUT_FILE/.test(openBuyScanner)) {
    issues.push("strategy1 scanner may still write partial output to latest JSON");
  }
}

(async () => {
  const issues = [];
  if (!SUPABASE_URL || !SUPABASE_KEY) issues.push("missing Supabase credentials");
  verifyStaticContracts(issues);
  if (!issues.length) {
    await verifyStatusRows(issues);
    await verifyApiHandlers(issues);
  }
  if (issues.length) {
    console.error("[strategy-chain] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log("[strategy-chain] ok complete-run -> status -> no-store API -> polling -> freshness gate");
})().catch((error) => {
  console.error(`[strategy-chain] failed: ${error.message}`);
  process.exit(1);
});


