"use strict";

const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { isTwseTradingDay } = require("./twse-trading-day");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const OUT_FILE = process.env.STRATEGY2_READINESS_GATE_FILE || path.join(STATE_DIR, "strategy2-readiness-gate.json");
const LOG_FILE = path.join(LOG_DIR, `strategy2-readiness-gate-${dateStamp()}.log`);

const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
const STATUS_VIEW = process.env.STRATEGY2_READINESS_STATUS_VIEW || "v_strategy2_readiness_status";
const MISSING_VIEW = process.env.STRATEGY2_READINESS_MISSING_VIEW || "v_strategy2_readiness_missing";
const MISSING_LIMIT = Math.max(1, Math.min(5000, Number(process.env.STRATEGY2_READINESS_MISSING_LIMIT || 500)));

function dateStamp(date = new Date()) {
  return date.toISOString().replace(/\D/g, "").slice(0, 12);
}

function tradingDayProbeDate() {
  const text = String(process.env.STRATEGY2_TRADING_DAY_DATE || "").trim();
  if (!text) return new Date();
  if (/^\d{8}$/.test(text)) return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T12:00:00+08:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T12:00:00+08:00`);
  return new Date(text);
}

function taipeiTimestamp(date = new Date()) {
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Taipei", hour12: false });
}

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
}

function log(line) {
  const text = `[${taipeiTimestamp()}] ${line}`;
  console.log(text);
  fs.appendFileSync(LOG_FILE, `${text}\n`, "utf8");
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

async function fetchRows(table, query) {
  const base = String(SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
      cache: "no-store",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${table} HTTP ${response.status}: ${text.slice(0, 240)}`);
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

function stage({ key, label, ready, expected, reason, suggestedScannerBehavior }) {
  const status = expected > 0 && ready === expected ? "ready" : "not_ready";
  return {
    key,
    label,
    ready,
    expected,
    coverage: expected > 0 ? ready / expected : 0,
    status,
    reason: status === "ready" ? "" : reason,
    suggestedScannerBehavior: status === "ready" ? "publish_allowed" : suggestedScannerBehavior,
  };
}

function groupMissing(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.gate || "unknown"}|${row.missing_reason || "unknown"}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  return [...grouped.entries()].map(([key, rows]) => {
    const [gate, missingReason] = key.split("|");
    return { gate, missingReason, rows };
  }).sort((a, b) => a.gate.localeCompare(b.gate) || b.rows - a.rows);
}

async function checkOnce() {
  const checkedAt = new Date();
  const tradingDay = await isTwseTradingDay(tradingDayProbeDate(), { stateDir: STATE_DIR });
  if (!tradingDay.isTradingDay) {
    const payload = {
      ok: true,
      source: "strategy2-readiness-gate",
      gate: "strategy2-0845-futopt+0855-preopen-hot+0900-1200-detection",
      checkedAt: checkedAt.toISOString(),
      checkedAtTaipei: taipeiTimestamp(checkedAt),
      status: "market_closed",
      reason: `market_closed: ${tradingDay.date} is not a TWSE trading day (${tradingDay.reason})`,
      publishAllowed: false,
      scannerBehavior: "preserve latest complete run; skip Strategy2 readiness collectors on non-trading day; no new complete run",
      tradingDay,
      stages: [],
      missingSummary: [],
      missingRows: [],
      contracts: {
        tradingDayChecker: "scripts/twse-trading-day.js",
        sourceTaskGuard: "scripts/check-strategy2-trading-day.js",
        statusView: STATUS_VIEW,
        missingView: MISSING_VIEW,
        rpc: "refresh_strategy2_readiness_cache",
        cacheTables: ["strategy2_readiness_status_cache", "strategy2_readiness_missing_cache"],
      },
      logFile: LOG_FILE,
    };
    fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    log(`readiness market_closed date=${tradingDay.date} reason=${tradingDay.reason}`);
    return payload;
  }
  const statusRows = await fetchRows(
    STATUS_VIEW,
    [
      "select=*",
      "limit=1",
    ].join("&")
  );
  const status = statusRows[0] || null;
  if (!status) throw new Error(`${STATUS_VIEW} returned no rows`);

  const missingRows = await fetchRows(
    MISSING_VIEW,
    [
      "select=checked_at,gate,symbol,name,future_symbol,missing_reason,details",
      "order=gate.asc,missing_reason.asc,symbol.asc",
      `limit=${MISSING_LIMIT}`,
    ].join("&")
  );

  const stages = [
    stage({
      key: "08:45_futopt",
      label: "08:45 stock futures",
      ready: cleanNumber(status.futopt_ready_count),
      expected: cleanNumber(status.futopt_expected_count),
      reason: "個股期貨 quote 未達 100% fresh/readiness",
      suggestedScannerBehavior: "preserve_latest_complete_run; refresh futopt_quotes_live before 08:45",
    }),
    stage({
      key: "08:55_preopen_hot",
      label: "08:55 trial-match hot",
      ready: cleanNumber(status.preopen_hot_ready_count),
      expected: cleanNumber(status.preopen_hot_candidate_count),
      reason: "試撮夯候選缺少最後 1 分鐘至少 3 筆 snapshot",
      suggestedScannerBehavior: "preserve_latest_complete_run; collect fugle_preopen_snapshot_history through 08:55",
    }),
    stage({
      key: "09:00_12:00_intraday_1m",
      label: "09:00-12:00 intraday 1m",
      ready: cleanNumber(status.intraday_1m_ready_count),
      expected: cleanNumber(status.detection_expected_count),
      reason: "偵測母池未全數達成 ready_ge_35",
      suggestedScannerBehavior: "preserve_latest_complete_run; keep 1m collector covering full universe until ready_ge_35=100%",
    }),
    stage({
      key: "09:00_12:00_execution",
      label: "latest complete run execution",
      ready: cleanNumber(status.latest_execution_scanned),
      expected: cleanNumber(status.latest_execution_expected),
      reason: "latest complete run execution coverage 未達 100%",
      suggestedScannerBehavior: "preserve_latest_complete_run; do not publish a new complete run",
    }),
  ];

  const ready = status.strategy2_ready_100 === true;
  const payload = {
    ok: ready,
    source: "strategy2-readiness-gate",
    gate: "strategy2-0845-futopt+0855-preopen-hot+0900-1200-detection",
    checkedAt: checkedAt.toISOString(),
    checkedAtTaipei: taipeiTimestamp(checkedAt),
    status: status.status || (ready ? "ready" : "not_ready"),
    reason: status.reason || "",
    publishAllowed: ready,
    scannerBehavior: ready
      ? "publish new complete run allowed"
      : "preserve latest complete run; surface explicit readiness reason; no silent fallback",
    latestRunId: status.latest_run_id || "",
    latestScanDate: status.latest_scan_date || "",
    latestFinishedAt: status.latest_finished_at || "",
    latestStatus: status.latest_status || "",
    latestComplete: status.latest_complete === true,
    stages,
    missingSummary: Array.isArray(status.missing_summary) ? status.missing_summary : groupMissing(missingRows),
    missingRows,
    contracts: {
      statusView: STATUS_VIEW,
      missingView: MISSING_VIEW,
      rpc: "refresh_strategy2_readiness_cache",
      cacheTables: ["strategy2_readiness_status_cache", "strategy2_readiness_missing_cache"],
    },
    logFile: LOG_FILE,
  };

  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  log(`readiness ok=${payload.ok} status=${payload.status} futopt=${stages[0].ready}/${stages[0].expected} preopen_hot=${stages[1].ready}/${stages[1].expected} 1m=${stages[2].ready}/${stages[2].expected} execution=${stages[3].ready}/${stages[3].expected}`);
  return payload;
}

async function main() {
  ensureDirs();
  const args = new Set(process.argv.slice(2));
  const payload = await checkOnce();
  if (!payload.ok && args.has("--fail-on-critical")) process.exitCode = 1;
}

main().catch((error) => {
  ensureDirs();
  const payload = {
    ok: false,
    source: "strategy2-readiness-gate",
    checkedAt: new Date().toISOString(),
    checkedAtTaipei: taipeiTimestamp(),
    status: "failed",
    reason: error?.message || String(error),
    publishAllowed: false,
    scannerBehavior: "preserve latest complete run; readiness gate failed explicitly",
    issues: [{ severity: "critical", id: "strategy2-readiness-gate-failed", message: error?.message || String(error) }],
    logFile: LOG_FILE,
  };
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  log(`readiness failed: ${error?.message || String(error)}`);
  process.exit(1);
});
