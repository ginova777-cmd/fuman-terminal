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
const STRATEGY3_MIN_INTRADAY_1M_CANDIDATES = Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDIDATES || 1000);
const STRATEGY3_MIN_INTRADAY_1M_CANDLES = Number(process.env.STRATEGY3_MIN_INTRADAY_1M_CANDLES || 35);
const STRATEGY3_SESSION_LATEST_MINUTE = Number(process.env.STRATEGY3_SESSION_LATEST_MINUTE || (12 * 60 + 50));
const STRATEGY3_INTRADAY_STATUS_VIEW = process.env.STRATEGY3_SUPABASE_1M_STATUS_VIEW || "v_strategy2_intraday_ready";
const STRATEGY4_MIN_DAILY_ROWS = Number(process.env.STRATEGY4_STANDARD_MIN_SOURCE_ROWS || 1500);

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

async function fetchSourceStatusPayload(sourceName = "fugle_shared_source") {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const select = "source_name,status,updated_at,stale_seconds,message,payload";
    const url = `${SUPABASE_URL}/rest/v1/source_status?source_name=eq.${encodeURIComponent(sourceName)}&select=${encodeURIComponent(select)}&order=updated_at.desc&limit=1`;
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

async function latestDateAndCount(table, dateField = "trade_date") {
  const rows = await supabaseRequest(
    "GET",
    `/rest/v1/${table}?${query({ select: dateField, order: `${dateField}.desc`, limit: 1 })}`,
    undefined,
    30000
  );
  const latestDate = Array.isArray(rows) && rows[0] ? String(rows[0][dateField] || "") : "";
  if (!latestDate) return { table, latestDate: "", rowCount: 0 };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(dateField)}&${dateField}=eq.${encodeURIComponent(latestDate)}`, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "count=exact",
    },
  });
  if (!response.ok) throw new Error(`${table} count HTTP ${response.status}`);
  const range = response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+)$/);
  return { table, latestDate, rowCount: match ? Number(match[1]) || 0 : 0 };
}

async function fetchStrategy4DailyFallbackStatus() {
  const finmind = await latestDateAndCount("finmind_daily_ohlcv", "trade_date");
  const ready = finmind.rowCount >= STRATEGY4_MIN_DAILY_ROWS && Boolean(finmind.latestDate);
  return {
    ready,
    status: ready ? READY_STATUS : "not_ready",
    requiredSource: "finmind_daily_ohlcv",
    latestDate: finmind.latestDate,
    rowCount: finmind.rowCount,
    minRequiredRows: STRATEGY4_MIN_DAILY_ROWS,
    reason: ready
      ? `finmind_daily_ohlcv latest_trade_date=${finmind.latestDate}; rows_on_latest_date=${finmind.rowCount}`
      : `finmind_daily_ohlcv rows_on_latest_date=${finmind.rowCount} < ${STRATEGY4_MIN_DAILY_ROWS}`,
  };
}

function query(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  });
  return search.toString();
}

function candleMinutes(value) {
  const text = String(value || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(parsed));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    return get("hour") * 60 + get("minute");
  }
  const match = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

async function supabaseRequest(method, route, body, timeoutMs = 60000) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}${route}`, {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${route} HTTP ${response.status}: ${text.slice(0, 240)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseRowsPaged(route, pageSize = 1000, timeoutMs = 60000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = route.includes("?") ? "&" : "?";
    const page = await supabaseRequest("GET", `${route}${separator}limit=${pageSize}&offset=${offset}`, undefined, timeoutMs);
    const list = Array.isArray(page) ? page : [];
    rows.push(...list);
    if (list.length < pageSize) return rows;
  }
}

function taipeiTradeDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function fetchStrategy3SessionReadinessStatus() {
  const tradeDate = String(process.env.STRATEGY3_TRADE_DATE || taipeiTradeDate());
  let strategy2Readiness = null;
  let statusRefresh = null;
  let statusRefreshWarning = "";
  try {
    statusRefresh = await supabaseRequest("POST", "/rest/v1/rpc/refresh_strategy2_readiness_cache", {}, 90000);
    strategy2Readiness = await fetchStrategy2ReadinessStatus();
  } catch (error) {
    statusRefreshWarning = error?.message || String(error);
  }
  const rows = await supabaseRowsPaged(`/rest/v1/${STRATEGY3_INTRADAY_STATUS_VIEW}?${query({
    select: "symbol,latest_candle_time,today_candle_count,continuous_candle_count,ready_ge_35,ready_ma35_continuous,intraday_1m_status_updated_at,quote_updated_at",
    order: "latest_candle_time.desc",
  })}`, 1000, 60000);
  const statusRows = Array.isArray(rows) ? rows : [];
  const latestCandleTime = statusRows
    .map((row) => row.latest_candle_time)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
  const sessionReadyRows = statusRows.filter((row) => {
    const count = cleanNumber(row.today_candle_count);
    const continuous = cleanNumber(row.continuous_candle_count);
    const minute = candleMinutes(row.latest_candle_time || row.updated_at);
    if (row.ready_ge_35 === true || row.ready_ma35_continuous === true || continuous >= STRATEGY3_MIN_INTRADAY_1M_CANDLES) return true;
    return count >= STRATEGY3_MIN_INTRADAY_1M_CANDLES
      || (count > 0 && minute != null && minute >= STRATEGY3_SESSION_LATEST_MINUTE);
  });
  const strategy2IntradayReady = cleanNumber(strategy2Readiness?.intraday_1m_ready_count);
  const strategy2Expected = cleanNumber(strategy2Readiness?.detection_expected_count);
  const effectiveReadyCount = Math.max(sessionReadyRows.length, strategy2IntradayReady);
  const ready = effectiveReadyCount >= STRATEGY3_MIN_INTRADAY_1M_CANDIDATES;
  return {
    ready,
    status: ready ? "ready" : "not_ready",
    source: STRATEGY3_INTRADAY_STATUS_VIEW,
    upstreamSource: "Strategy2 daytrade 1m",
    tradeDate,
    sessionReadyCount: effectiveReadyCount,
    viewReadyCount: sessionReadyRows.length,
    strategy2IntradayReadyCount: strategy2IntradayReady,
    strategy2DetectionExpectedCount: strategy2Expected,
    statusRowCount: statusRows.length,
    minIntraday1mCandidates: STRATEGY3_MIN_INTRADAY_1M_CANDIDATES,
    minIntraday1mCandles: STRATEGY3_MIN_INTRADAY_1M_CANDLES,
    sessionLatestMinute: STRATEGY3_SESSION_LATEST_MINUTE,
    latestCandleTime,
    reason: ready
      ? "Strategy2 daytrade intraday 1m source ready for Strategy3"
      : `Strategy2 daytrade intraday 1m ready ${effectiveReadyCount}/${STRATEGY3_MIN_INTRADAY_1M_CANDIDATES}`,
    strategy2Readiness,
    statusRefreshWarning,
    statusRefresh,
  };
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
  if (!sourceStatus) return ["source_status fugle_daytrade_source missing"];
  const payload = sourceStatus.payload || {};
  const activeSymbols = cleanNumber(payload.priority_pool_symbols) || cleanNumber(payload.mother_pool_symbols) || cleanNumber(payload.active_symbols);
  const freshQuotes120s = cleanNumber(payload.priority_fresh_quotes_120s) || cleanNumber(payload.fresh_quotes_120s);
  const freshQuoteCoverage120s = cleanNumber(payload.priority_fresh_quote_coverage_120s) || cleanNumber(payload.fresh_quote_coverage_120s) || (activeSymbols > 0 ? freshQuotes120s / activeSymbols : 0);
  const today1mSymbols = cleanNumber(payload.today_1m_symbols || payload.intraday_1m_symbols_today);
  const staleSeconds = cleanNumber(payload.intraday_1m_stale_seconds);
  const scannerCanRunOpening = boolValue(payload.scanner_can_run_opening);
  const formalEntryAllowed = boolValue(payload.formal_entry_allowed);
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
  if (activeSymbols > 0 && freshQuoteCoverage120s < STRATEGY2_MIN_FRESH_QUOTE_COVERAGE_120S) {
    issues.push(`quote fresh 120s coverage ${freshQuoteCoverage120s.toFixed(4)} < ${STRATEGY2_MIN_FRESH_QUOTE_COVERAGE_120S}`);
  }
  if (regularNow) {
    if (!scannerCanRunOpening) issues.push("scanner_can_run_opening=false");
    if (!formalEntryAllowed) issues.push("formal_entry_allowed=false");
    if (!fullUniverse && !scannerCanRunOpening) issues.push("quote_derived_1m_full_universe=false");
    if (!scannerCanRunOpening && activeSymbols >= 1000 && today1mSymbols < activeSymbols) {
      issues.push(`today_1m_symbols ${today1mSymbols}/${activeSymbols} not full universe`);
    }
    if (!scannerCanRunOpening && staleSeconds > hardSeconds) {
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
  let dailyFallback = null;
  let readiness = null;
  let readinessWarning = "";
  let sourceStatus = null;
  let sourceGateIssues = [];
  let strategy3Session = null;
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
      sourceStatus = await fetchSourceStatusPayload("fugle_daytrade_source");
      sourceGateIssues = strategy2SourceGateIssues(sourceStatus);
      const sourcePayload = sourceStatus?.payload || {};
      const dedicatedSourceReady = sourceGateIssues.length === 0
        && String(sourceStatus?.status || "").toLowerCase() === "ok"
        && boolValue(sourcePayload.scanner_can_run_opening)
        && boolValue(sourcePayload.formal_entry_allowed);
      if (dedicatedSourceReady) {
        effectiveStatus = READY_STATUS;
      } else if (sourceGateIssues.length > 0 && effectiveStatus === READY_STATUS) {
        effectiveStatus = "not_ready";
      }
    } catch (error) {
      sourceGateIssues = [`source_status unavailable: ${error?.message || String(error)}`];
      if (effectiveStatus === READY_STATUS) effectiveStatus = "failed";
    }
  }
  if (String(row.strategy || "").toLowerCase() === "strategy3") {
    try {
      strategy3Session = await fetchStrategy3SessionReadinessStatus();
      if (!strategy3Session.ready && effectiveStatus === READY_STATUS) {
        effectiveStatus = "not_ready";
      }
    } catch (error) {
      readinessWarning = `strategy3 session readiness unavailable: ${error?.message || String(error)}`;
      if (effectiveStatus === READY_STATUS) effectiveStatus = "failed";
    }
  }
  if (String(row.strategy || "").toLowerCase() === "strategy4" && effectiveStatus !== READY_STATUS) {
    try {
      dailyFallback = await fetchStrategy4DailyFallbackStatus();
      if (dailyFallback.ready) {
        effectiveStatus = READY_STATUS;
      }
    } catch (error) {
      dailyFallback = {
        ready: false,
        status: "failed",
        requiredSource: "finmind_daily_ohlcv",
        latestDate: "",
        rowCount: 0,
        minRequiredRows: STRATEGY4_MIN_DAILY_ROWS,
        reason: `finmind_daily_ohlcv unavailable: ${error?.message || String(error)}`,
      };
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
  const strategy3SessionReason = strategy3Session && !strategy3Session.ready ? strategy3Session.reason : "";
  const sourceGateReason = sourceGateIssues.length ? `source_status gate: ${sourceGateIssues.join("; ")}` : "";
  const strategy2DedicatedSourceReady = String(row.strategy || "").toLowerCase() === "strategy2"
    && sourceStatus
    && String(sourceStatus.status || "").toLowerCase() === "ok"
    && sourceGateIssues.length === 0
    && boolValue(sourceStatus.payload?.scanner_can_run_opening)
    && boolValue(sourceStatus.payload?.formal_entry_allowed);
  const readinessDiagnostic = strategy2DedicatedSourceReady && readinessReason
    ? `diagnostic_only:${readinessReason}`
    : readinessReason;
  const dailyFallbackReason = dailyFallback?.ready ? `daily_after_close_fallback_ready: ${dailyFallback.reason}` : "";
  const reason = [strategy2DedicatedSourceReady ? "" : (row.reason || ""), dailyFallbackReason, readinessDiagnostic, strategy3SessionReason, readinessWarning, sourceGateReason].filter(Boolean).join("; ");
  const readinessBlocked = Boolean(readiness && readiness.strategy2_ready_100 !== true && !strategy2DedicatedSourceReady);
  const strategy3SessionBlocked = Boolean(strategy3Session && !strategy3Session.ready);
  const suggestedScannerBehavior = strategy2DedicatedSourceReady
    ? "publish allowed; dedicated daytrade source is A and readiness cache is diagnostic-only"
    : sourceGateIssues.length || readinessBlocked
      ? "preserve latest complete run; Strategy2 readiness/source gate is not 100%"
      : strategy3SessionBlocked
        ? "preserve latest complete run; Strategy2 daytrade intraday 1m source is not ready for Strategy3"
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
    strategy3Session,
    dailyFallback,
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
