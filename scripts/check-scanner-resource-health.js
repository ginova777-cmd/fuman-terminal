const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = path.join(RUNTIME_DIR, "state");
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("supabase-url.txt")
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-service-role-key.txt")
  || readSecret("supabase-anon-key.txt");

const STRATEGY_ALIASES = new Map([
  ["strategy1", "Strategy1"],
  ["open-buy", "Strategy1"],
  ["open_buy", "Strategy1"],
  ["strategy2", "Strategy2"],
  ["strategy3", "Strategy3"],
  ["strategy4", "Strategy4"],
  ["strategy5", "Strategy5 / institution"],
  ["institution", "Strategy5 / institution"],
  ["chip", "Strategy5 / institution"],
  ["cb", "CB"],
  ["cb-detect", "CB"],
  ["warrant", "Warrant"],
  ["warrant-flow", "Warrant"],
]);
const READY_STATUS = "ready";
const STALE_STATUS = "stale";
const BLOCKING_STATUSES = new Set(["not_ready", "failed"]);
const STRATEGY2_MIN_FRESH_QUOTE_COVERAGE_120S = Number(process.env.STRATEGY2_MIN_FRESH_QUOTE_COVERAGE_120S || 0.9);
const STRATEGY2_INTRADAY_1M_HARD_STALE_SECONDS = Number(process.env.STRATEGY2_INTRADAY_1M_HARD_STALE_SECONDS || 120);

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function tradingDayProbeDate() {
  const text = String(process.env.STRATEGY2_TRADING_DAY_DATE || "").trim();
  if (!text) return new Date();
  if (/^\d{8}$/.test(text)) return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T12:00:00+08:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T12:00:00+08:00`);
  return new Date(text);
}

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(process.cwd(), "secrets", name),
  ]) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {}
  }
  return "";
}

async function fetchHealthRows(strategy = "") {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const select = "strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at";
    const filters = [`select=${encodeURIComponent(select)}`, "limit=10"];
    if (strategy) filters.push(`strategy=eq.${encodeURIComponent(strategy)}`);
    const url = `${SUPABASE_URL}/rest/v1/v_scanner_resource_health?${filters.join("&")}`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`v_scanner_resource_health HTTP ${response.status}: ${text.slice(0, 240)}`);
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows : [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStrategy2ReadinessStatus() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const select = [
      "status",
      "reason",
      "strategy2_ready_100",
      "futopt_expected_count",
      "futopt_ready_count",
      "preopen_hot_candidate_count",
      "preopen_hot_ready_count",
      "detection_expected_count",
      "intraday_1m_ready_count",
      "latest_execution_expected",
      "latest_execution_scanned",
      "latest_run_id",
      "checked_at",
      "missing_summary",
    ].join(",");
    const url = `${SUPABASE_URL}/rest/v1/v_strategy2_readiness_status?select=${encodeURIComponent(select)}&limit=1`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`v_strategy2_readiness_status HTTP ${response.status}: ${text.slice(0, 240)}`);
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows[0] || null : null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourceStatusPayload() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const select = "source_name,status,updated_at,stale_seconds,message,payload";
    const url = `${SUPABASE_URL}/rest/v1/source_status?source_name=eq.fugle_shared_source&select=${encodeURIComponent(select)}&limit=1`;
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`source_status HTTP ${response.status}: ${text.slice(0, 240)}`);
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows[0] || null : null;
  } finally {
    clearTimeout(timer);
  }
}

function boolValue(value) {
  if (value === true) return true;
  if (value === false) return false;
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function cleanNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/,/g, "").trim();
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function taipeiMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = Number(parts.find((item) => item.type === "hour")?.value || 0);
  const minute = Number(parts.find((item) => item.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function strategy2SourceGateIssues(sourceStatus) {
  if (!sourceStatus) return ["source_status fugle_shared_source missing"];
  const payload = sourceStatus.payload || {};
  const activeSymbols = cleanNumber(payload.mother_pool_symbols) || cleanNumber(payload.active_symbols);
  const freshQuotes120s = cleanNumber(payload.fresh_quotes_120s);
  const freshQuoteCoverage120s = cleanNumber(payload.fresh_quote_coverage_120s) || (activeSymbols > 0 ? freshQuotes120s / activeSymbols : 0);
  const today1mSymbols = cleanNumber(payload.today_1m_symbols || payload.intraday_1m_symbols_today);
  const staleSeconds = cleanNumber(payload.intraday_1m_stale_seconds);
  const hardSeconds = cleanNumber(payload.intraday_1m_fresh_hard_seconds) || STRATEGY2_INTRADAY_1M_HARD_STALE_SECONDS;
  const hasCandidateLimit = Object.prototype.hasOwnProperty.call(payload, "quote_derived_1m_candidate_limit");
  const fullUniverse = boolValue(payload.quote_derived_1m_full_universe)
    || (hasCandidateLimit && cleanNumber(payload.quote_derived_1m_candidate_limit) <= 0);
  const session = String(payload.session || "").toLowerCase();
  const minutes = taipeiMinutes();
  const regularNow = session === "regular" || (minutes >= 9 * 60 && minutes <= 13 * 60 + 35);
  const issues = [];

  if (String(payload.permission_status || "").toLowerCase() && String(payload.permission_status || "").toLowerCase() !== "ready") {
    issues.push(`permission_status=${payload.permission_status}`);
  }
  if (String(payload.quote_status || "").toLowerCase() && String(payload.quote_status || "").toLowerCase() !== "ready") {
    issues.push(`quote_status=${payload.quote_status}`);
  }
  if (activeSymbols >= 1000 && freshQuoteCoverage120s < STRATEGY2_MIN_FRESH_QUOTE_COVERAGE_120S) {
    issues.push(`quote fresh 120s coverage ${freshQuoteCoverage120s.toFixed(4)} < ${STRATEGY2_MIN_FRESH_QUOTE_COVERAGE_120S}`);
  }
  if (regularNow) {
    if (!fullUniverse) issues.push("quote_derived_1m_full_universe=false");
    if (activeSymbols >= 1000 && today1mSymbols < activeSymbols) {
      issues.push(`today_1m_symbols ${today1mSymbols}/${activeSymbols} not full universe`);
    }
    if (staleSeconds > hardSeconds) {
      issues.push(`intraday_1m_stale_seconds ${staleSeconds} > ${hardSeconds}`);
    }
    if (String(payload.intraday_1m_status || "").toLowerCase() && String(payload.intraday_1m_status || "").toLowerCase() !== "ready") {
      issues.push(`intraday_1m_status=${payload.intraday_1m_status}`);
    }
  }
  return issues;
}

function normalizeStrategy(value) {
  const key = String(value || "").trim().toLowerCase();
  return STRATEGY_ALIASES.get(key) || value;
}

async function main() {
  const requested = argValue("--strategy", process.env.SCANNER_RESOURCE_HEALTH_STRATEGY || "");
  const allowStale = process.argv.includes("--allow-stale") || process.env.SCANNER_RESOURCE_HEALTH_ALLOW_STALE === "1";
  const strategy = normalizeStrategy(requested);
  if (!strategy) throw new Error("missing --strategy");
  if (String(strategy || "").toLowerCase() === "strategy2") {
    const tradingDay = await isTwseTradingDay(tradingDayProbeDate(), { stateDir: STATE_DIR });
    if (!tradingDay.isTradingDay) {
      console.log(JSON.stringify({
        ok: false,
        blocked: true,
        requested,
        strategy,
        status: "market_closed",
        sourceStatus: "market_closed",
        requiredSource: "twse trading calendar",
        latestDate: tradingDay.date || "",
        rowCount: 0,
        minRequiredRows: 0,
        reason: `market_closed: ${tradingDay.date} is not a TWSE trading day (${tradingDay.reason})`,
        scanner_block_reason: `market_closed: ${tradingDay.date} is not a TWSE trading day (${tradingDay.reason})`,
        publishAllowed: false,
        suggestedScannerBehavior: "preserve latest complete run; skip Strategy2 source collectors; do not publish new complete run",
        updatedAt: new Date().toISOString(),
        tradingDay,
      }, null, 2));
      process.exitCode = 2;
      return;
    }
  }
  const rows = await fetchHealthRows(strategy);
  const row = rows.find((item) => String(item.strategy || "").toLowerCase() === String(strategy).toLowerCase());
  if (!row) throw new Error(`missing scanner resource health row for ${strategy}`);
  const status = String(row.status || "").toLowerCase();
  let effectiveStatus = status;
  let readiness = null;
  let readinessWarning = "";
  let sourceStatus = null;
  let sourceGateIssues = [];
  if (String(row.strategy || "").toLowerCase() === "strategy2") {
    try {
      readiness = await fetchStrategy2ReadinessStatus();
      if (readiness && readiness.strategy2_ready_100 !== true) {
        effectiveStatus = status === READY_STATUS ? "not_ready" : status;
      }
    } catch (error) {
      readinessWarning = `strategy2 readiness status unavailable: ${error?.message || String(error)}`;
      if (status === READY_STATUS) effectiveStatus = "failed";
    }
    try {
      sourceStatus = await fetchSourceStatusPayload();
      sourceGateIssues = strategy2SourceGateIssues(sourceStatus);
      if (sourceGateIssues.length > 0 && effectiveStatus === READY_STATUS) {
        effectiveStatus = "not_ready";
      }
    } catch (error) {
      sourceGateIssues = [`source_status unavailable: ${error?.message || String(error)}`];
      if (effectiveStatus === READY_STATUS) effectiveStatus = "failed";
    }
  }
  const ok = effectiveStatus === READY_STATUS || (allowStale && effectiveStatus === STALE_STATUS);
  const blocked = !ok;
  const readinessReason = readiness && readiness.strategy2_ready_100 !== true
    ? readiness.reason || [
      `futopt=${Number(readiness.futopt_ready_count || 0)}/${Number(readiness.futopt_expected_count || 0)}`,
      `preopen_hot=${Number(readiness.preopen_hot_ready_count || 0)}/${Number(readiness.preopen_hot_candidate_count || 0)}`,
      `intraday_1m=${Number(readiness.intraday_1m_ready_count || 0)}/${Number(readiness.detection_expected_count || 0)}`,
      `execution=${Number(readiness.latest_execution_scanned || 0)}/${Number(readiness.latest_execution_expected || 0)}`,
    ].join("; ")
    : "";
  const sourceGateReason = sourceGateIssues.length ? `source_status gate: ${sourceGateIssues.join("; ")}` : "";
  const reason = [row.reason || "", readinessReason, readinessWarning, sourceGateReason].filter(Boolean).join("; ");
  const readinessBlocked = Boolean(readiness && readiness.strategy2_ready_100 !== true);
  const suggestedScannerBehavior = sourceGateIssues.length || readinessBlocked
    ? "preserve latest complete run; Strategy2 readiness/source gate is not 100%"
    : row.suggested_scanner_behavior || "";
  const payload = {
    ok,
    blocked,
    requested,
    strategy: row.strategy,
    status: effectiveStatus,
    sourceStatus: status,
    requiredSource: row.required_source || "",
    latestDate: row.latest_date || "",
    rowCount: Number(row.row_count || 0),
    minRequiredRows: Number(row.min_required_rows || 0),
    reason,
    scanner_block_reason: reason || (blocked ? "scanner source gate blocked" : ""),
    publishAllowed: ok,
    suggestedScannerBehavior,
    updatedAt: row.updated_at || "",
    readiness,
    sourceStatus,
    sourceGate: {
      minFreshQuoteCoverage120s: STRATEGY2_MIN_FRESH_QUOTE_COVERAGE_120S,
      intraday1mHardStaleSeconds: STRATEGY2_INTRADAY_1M_HARD_STALE_SECONDS,
      issues: sourceGateIssues,
    },
  };
  console.log(JSON.stringify(payload, null, 2));
  if (effectiveStatus === READY_STATUS) return;
  if (effectiveStatus === STALE_STATUS) {
    process.exitCode = allowStale ? 0 : 2;
    return;
  }
  process.exitCode = BLOCKING_STATUSES.has(effectiveStatus) || effectiveStatus === "not_ready" ? 3 : 3;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, blocked: true, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
});
