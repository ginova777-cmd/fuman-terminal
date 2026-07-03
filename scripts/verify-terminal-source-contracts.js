const fs = require("fs");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-source-contracts");
const STRICT_WARNINGS = process.argv.includes("--strict") || process.env.TERMINAL_SOURCE_CONTRACT_STRICT_WARNINGS === "1";
const ROUTE_ALIASES = new Map([
  ["open-buy", "strategy1"],
  ["open-buy-latest", "strategy1"],
  ["strategy2-latest", "strategy2"],
  ["strategy3-latest", "strategy3"],
  ["strategy4-latest", "strategy4"],
  ["strategy5-latest", "strategy5"],
  ["institution-latest", "institution"],
  ["chip", "institution"],
  ["cb-detect", "cb"],
  ["cb-detect-latest", "cb"],
  ["warrant-flow", "warrant"],
  ["warrant-flow-latest", "warrant"],
  ["realtime-radar-latest", "realtime-radar"],
  ["market-overview", "market"],
]);

function normalizeRouteFilter(value) {
  const key = String(value || "").trim().replace(/^\/+api\//, "").replace(/^\/+/, "").replace(/\?.*$/, "");
  return ROUTE_ALIASES.get(key) || key;
}

const ROUTE_FILTER = new Set((process.argv.find((arg) => arg.startsWith("--routes="))?.slice("--routes=".length) || "")
  .split(",")
  .map(normalizeRouteFilter)
  .filter(Boolean));

const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const COMMON_RESULT_FIELDS = [
  "run_id",
  "scan_date",
  "code",
  "name",
  "complete",
  "quality_status",
  "payload",
  "updated_at",
];

let expectedQuoteDatePromise = null;

const CONTRACTS = [
  {
    key: "strategy1",
    label: "strategy1 open-buy",
    checks: [
      runTableSelect(
        "strategy1_open_buy_runs",
        "strategy1",
        "run_id,scan_date,run_trade_date,finished_at,status,complete,expected_total,scanned_count,result_count,quality_status,payload"
      ),
      resultTable("strategy1_open_buy_results", [...COMMON_RESULT_FIELDS, "strategy", "rank", "score", "reason", "decision"]),
    ],
  },
  {
    key: "strategy2",
    label: "strategy2 live",
    checks: [
      runView("v_strategy2_latest_complete_run", "strategy2"),
      resultTable("strategy2_scan_results", [...COMMON_RESULT_FIELDS, "row_kind", "state_id", "signal_id", "latest_seen_at", "source_coverage", "data_contract_source"]),
      sourceTable("fugle_quotes_live", [
        "symbol", "name", "market", "updated_at", "last_trade_time", "price", "open_price", "high_price", "low_price",
        "previous_close", "change_percent", "total_volume", "trade_value", "cumulative_bid_volume", "cumulative_ask_volume",
        "cumulative_bid_ask_volume", "session", "stock_type", "is_halted", "is_trial",
      ], { order: "updated_at.desc", requireToday: true }),
      sourceTable("v_fugle_quotes_live_health", [
        "active_symbols", "quote_count", "fresh_quote_count_120s", "fresh_quote_count_180s", "quote_age_seconds", "coverage_120s", "coverage_180s",
      ], { level: "warning" }),
      sourceTable("v_strategy2_intraday_ready", [
        "symbol", "name", "price", "today_candle_count", "latest_candle_time", "ready_ge_35",
      ], { level: "warning" }),
      sourceTable("v_strategy2_readiness_status", [
        "checked_at", "status", "reason", "strategy2_ready_100",
        "futopt_expected_count", "futopt_ready_count",
        "preopen_hot_candidate_count", "preopen_hot_ready_count",
        "detection_expected_count", "intraday_1m_ready_count",
        "latest_run_id", "latest_execution_expected", "latest_execution_scanned",
        "missing_summary",
      ], { level: "warning", healthStatusField: "status", acceptedHealthStatuses: ["ready"] }),
      sourceTable("v_strategy2_readiness_missing", [
        "checked_at", "gate", "symbol", "name", "future_symbol", "missing_reason", "details",
      ], { level: "warning" }),
    ],
  },
  {
    key: "strategy3",
    label: "strategy3 overnight",
    checks: [
      runView("v_strategy3_latest_complete_run", "strategy3"),
      resultTable("strategy3_scan_results", [...COMMON_RESULT_FIELDS, "strategy", "rank", "score", "signals", "reason"]),
      sourceTable("fugle_quotes_latest", [
        "symbol", "code", "name", "market", "updated_at", "quote_time", "last_trade_time", "close", "last_price", "open", "high", "low",
        "prev_close", "previous_close", "change_percent", "trade_volume", "trade_volume_lots", "trade_volume_shares", "total_volume",
        "trade_value", "quote_source", "quote_age_seconds", "session", "stock_type", "is_halted", "is_trial",
      ], { order: "updated_at.desc", requireToday: true, purpose: "formal Strategy3 quote source" }),
      sourceTable("v_strategy3_intraday_1m_status", [
        "symbol", "latest_candle_time", "today_candle_count",
      ], { order: "latest_candle_time.desc", requireToday: true, minRows: 1, purpose: "formal Strategy3 intraday session readiness source" }),
      retiredSourceTable(
        "v_strategy3_quote_ready",
        "fugle_quotes_latest+v_strategy3_intraday_1m_status+stock_daily_volume",
        "Strategy3 formal gating no longer reads quote-ready view"
      ),
      sourceTable("stock_capital_latest", ["code", "issued_shares", "market", "updated_at"], { order: "updated_at.desc", maxAgeDays: 30 }),
      sourceTable("stock_daily_volume", ["symbol", "code", "trade_date", "volume", "volume_lots", "volume_shares", "close", "updated_at"], { order: "updated_at.desc", maxAgeDays: 3 }),
    ],
  },
  {
    key: "strategy4",
    label: "strategy4 daily breakout",
    checks: [
      runTable("strategy4_scan_runs", "strategy4"),
      resultTable("strategy4_scan_results", [...COMMON_RESULT_FIELDS, "strategy", "rank", "score", "zone", "zone_label", "price_source", "volume_unit", "data_contract_source"]),
      sourceTable("stock_daily_volume", ["symbol", "code", "trade_date", "volume", "volume_lots", "volume_shares", "close", "updated_at"], { order: "updated_at.desc", maxAgeDays: 3 }),
      sourceTable("fugle_daily_volume", ["symbol", "trade_date", "volume", "market", "updated_at"], { order: "updated_at.desc", maxAgeDays: 3 }),
      sourceTable("strategy4_daily_ohlcv_view", ["symbol", "trade_date", "close", "volume_lots", "updated_at"], { order: "updated_at.desc", maxAgeDays: 3, level: "warning" }),
    ],
  },
  {
    key: "strategy5",
    label: "strategy5 chip k",
    checks: [
      runView("v_strategy5_latest_complete_run", "strategy5"),
      resultTable("strategy5_scan_results", [...COMMON_RESULT_FIELDS, "strategy", "rank", "score", "signals", "data_contract_source"]),
      sourceTable("v_chip_flows_latest", ["symbol", "trade_date", "foreign_net", "investment_trust_net", "dealer_net", "institution_total_net", "source"], { order: "trade_date.desc", maxAgeDays: 3, level: "warning" }),
      sourceTable("stock_capital_latest", ["code", "issued_shares", "market", "updated_at"], { order: "updated_at.desc", maxAgeDays: 30, level: "warning" }),
      sourceTable("stock_daily_volume", ["symbol", "code", "trade_date", "volume", "volume_lots", "volume_shares", "close", "updated_at"], { order: "updated_at.desc", maxAgeDays: 3, level: "warning" }),
    ],
  },
  {
    key: "institution",
    label: "institution chip",
    checks: [
      runView("v_institution_latest_complete_run", "institution"),
      resultTable("institution_scan_results", [...COMMON_RESULT_FIELDS, "strategy", "rank", "foreign_net", "trust_net", "dealer_net", "total_net", "data_contract_source"]),
      sourceTable("v_institution_source_health", [
        "checked_trade_date",
        "latest_trade_date",
        "institutional_latest_trade_date",
        "margin_latest_trade_date",
        "unified_latest_trade_date",
        "institutional_rows",
        "margin_rows",
        "unified_rows",
        "valid_after_exclusion_rows",
        "min_required_rows",
        "stale_days",
        "coverage_status",
        "reason",
        "suggested_scanner_behavior",
      ], { order: "checked_trade_date.desc", level: "warning", healthStatusField: "coverage_status" }),
    ],
  },
  {
    key: "cb",
    label: "cb detect",
    checks: [
      runTableSelect(
        "cb_detect_scan_runs",
        "cb_detect",
        "run_id,strategy,scan_date,finished_at,status,complete,result_count,quality_status,data_contract_source,payload"
      ),
      resultTable("cb_detect_scan_results", ["run_id", "scan_date", "symbol", "name", "payload", "updated_at"]),
      snapshotKey("cb_detect_latest"),
    ],
  },
  {
    key: "warrant",
    label: "warrant flow",
    checks: [
      runView("v_warrant_flow_latest_complete_run", "warrant_flow"),
      resultTable("warrant_flow_scan_results", [...COMMON_RESULT_FIELDS, "strategy", "result_type", "underlying_code", "underlying_name", "score", "data_contract_source"]),
    ],
  },
  {
    key: "realtime-radar",
    label: "realtime radar",
    checks: [
      realtimeRadarCache(),
      sourceTable("fugle_realtime_quote_latest", [
        "symbol", "name", "market", "price", "open_price", "high_price", "low_price", "previous_close",
        "change_percent", "volume_lots", "trade_value_twd", "last_trade_time", "quote_updated_at",
      ], { order: "quote_updated_at.desc.nullslast", requireToday: true, minRows: 1, purpose: "formal quote-view fallback for stale/missing radar cache" }),
    ],
  },
];

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

function runView(table, strategy) {
  return {
    kind: "latest-run-view",
    table,
    strategy,
    select: "run_id,scan_date,finished_at,status,complete,result_count,quality_status,payload",
    query: `strategy=eq.${encodeURIComponent(strategy)}&status=eq.complete&complete=eq.true&limit=1`,
  };
}

function runTable(table, strategy) {
  return runTableSelect(
    table,
    strategy,
    "run_id,scan_date,finished_at,status,complete,result_count,quality_status,data_contract_source,payload"
  );
}

function runTableSelect(table, strategy, select) {
  return {
    kind: "latest-run-table",
    table,
    strategy,
    select,
    query: `strategy=eq.${encodeURIComponent(strategy)}&status=eq.complete&complete=eq.true&order=finished_at.desc&limit=1`,
  };
}

function resultTable(table, fields) {
  return {
    kind: "result-table",
    table,
    select: fields.join(","),
    query: "order=updated_at.desc&limit=1",
    minRows: 1,
  };
}

function sourceTable(table, fields, options = {}) {
  return {
    kind: "source-table",
    table,
    select: fields.join(","),
    query: [options.order ? `order=${options.order}` : "", "limit=5"].filter(Boolean).join("&"),
    level: options.level || "error",
    minRows: Number(options.minRows || 0),
    requireToday: options.requireToday === true,
    maxAgeDays: Number(options.maxAgeDays || 0),
    purpose: options.purpose || "",
    healthStatusField: options.healthStatusField || "",
    acceptedHealthStatuses: options.acceptedHealthStatuses || ["ready", "ok", "healthy", "complete"],
  };
}

function retiredSourceTable(table, replacement, reason = "") {
  return {
    kind: "retired-source-table",
    table,
    select: "",
    query: "",
    level: "info",
    minRows: 0,
    purpose: "retired source; not a formal gate",
    replacement,
    reason,
  };
}

function realtimeRadarCache() {
  return {
    kind: "realtime-radar-cache",
    table: "fuman_realtime_radar_cache",
    select: "id,payload,updated_at",
    query: "id=eq.latest&limit=1",
    minRows: 1,
    minPayloadRows: 1200,
    requireToday: true,
  };
}

function snapshotKey(key) {
  return {
    kind: "snapshot-key",
    table: "market_snapshots",
    select: "symbol,payload,updated_at",
    query: `symbol=eq.${encodeURIComponent(`__fuman_${key}`)}&limit=1`,
    minRows: 1,
  };
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function taipeiTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function taipeiMinutes(date = new Date()) {
  const parts = taipeiTimeParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function allowStrategy2ReadinessStatus(row = {}) {
  const minutes = taipeiMinutes();
  const beforeLiveWindow = minutes < (8 * 60 + 45);
  const afterLiveWindow = minutes >= (12 * 60);
  if (!beforeLiveWindow && !afterLiveWindow) return false;
  return Boolean(String(row.latest_run_id || "").trim()) && Number(row.intraday_1m_ready_count || 0) > 0;
}

function keyToTaipeiNoon(dateKey) {
  const text = String(dateKey || "");
  return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T12:00:00+08:00`);
}

function addDaysKey(dateKey, delta) {
  const date = keyToTaipeiNoon(dateKey);
  date.setUTCDate(date.getUTCDate() + delta);
  return taipeiDateKey(date);
}

async function previousTradingDateKey(startDateKey) {
  let key = addDaysKey(startDateKey, -1);
  for (let i = 0; i < 14; i++) {
    const result = await isTwseTradingDay(keyToTaipeiNoon(key), { stateDir: path.join(RUNTIME_DIR, "state") });
    if (result.isTradingDay) return key;
    key = addDaysKey(key, -1);
  }
  return addDaysKey(startDateKey, -1);
}

async function expectedQuoteDateKey() {
  if (process.env.TERMINAL_SOURCE_CONTRACT_EXPECT_QUOTE_DATE) {
    return String(process.env.TERMINAL_SOURCE_CONTRACT_EXPECT_QUOTE_DATE).replace(/\D/g, "").slice(0, 8);
  }
  if (!expectedQuoteDatePromise) {
    expectedQuoteDatePromise = (async () => {
      const now = new Date();
      const parts = taipeiTimeParts(now);
      const today = `${parts.year}${parts.month}${parts.day}`;
      const minuteOfDay = Number(parts.hour || 0) * 60 + Number(parts.minute || 0);
      const trading = await isTwseTradingDay(now, { stateDir: path.join(RUNTIME_DIR, "state") });
      if (trading.isTradingDay && minuteOfDay >= 9 * 60 + 5) return today;
      return previousTradingDateKey(today);
    })();
  }
  return expectedQuoteDatePromise;
}

function compactDate(value) {
  const text = String(value || "");
  const direct = text.replace(/\D/g, "");
  if (direct.length >= 8) return direct.slice(0, 8);
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return taipeiDateKey(new Date(parsed));
  return "";
}

function rowDate(row = {}) {
  return compactDate(
    row.updated_at
    || row.quote_updated_at
    || row.quote_time
    || row.last_trade_time
    || row.scan_date
    || row.finished_at
    || row.trade_date
    || row.latest_trade_date
    || row.checked_trade_date
    || row.latest_candle_time
  );
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,％%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(String(value).replace(/[,％%]/g, ""));
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function statusLooksReady(value) {
  return /^(captured_at_publish|complete|ok|ready|pass|passed|healthy)$/i.test(String(value || "").trim());
}

function isRealtimeRadarAfterClosePayloadReady(payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const rowCount = Number(payload.count ?? payload.totalCount ?? payload.total ?? rows.length) || rows.length;
  const runQuality = payload.run_quality_at_publish || payload.runQualityAtPublish || {};
  const sourceStatus = payload.source_status_at_run || payload.sourceStatusAtRun || {};
  return Boolean(
    taipeiMinutes() > 13 * 60 + 30
    && realtimeRadarPayloadDate(payload) === taipeiDateKey()
    && rowCount >= 1200
    && cleanNumber(payload.failedBatchCount) === 0
    && cleanNumber(payload.staleQuoteCount) === 0
    && (
      statusLooksReady(payload.evidenceStatus)
      || statusLooksReady(payload.unattendedStatus)
      || statusLooksReady(payload.qualityStatus)
      || statusLooksReady(runQuality.status)
      || statusLooksReady(sourceStatus.status)
      || cleanNumber(runQuality.rowsChecked) >= 1200
    )
  );
}

function realtimeRadarSourceQualityIssues(payload = {}, table = "fuman_realtime_radar_cache") {
  const coverage = payload.quote_coverage_at_run || payload.quoteCoverageAtRun || payload.sourceCoverage || {};
  const residualStaleQuoteCount = cleanNumber(payload.staleQuoteCount);
  const freshCoverage = firstFiniteNumber(
    payload.fresh_quote_coverage_120s,
    payload.freshQuoteCoverage120s,
    coverage.fresh_quote_coverage_120s,
    coverage.freshQuoteCoverage120s,
    coverage.coverage_120s,
    coverage.coverage120s,
    coverage.coverage
  );
  const quoteAgeSeconds = firstFiniteNumber(
    payload.quote_age_seconds,
    payload.quoteAgeSeconds,
    coverage.quote_age_seconds,
    coverage.quoteAgeSeconds,
    coverage.sourceAgeSeconds,
    coverage.stale_seconds,
    coverage.staleSeconds
  );
  const minFreshCoverage = firstFiniteNumber(coverage.minFreshQuoteCoverage120s, payload.minFreshQuoteCoverage120s) ?? 0.95;
  const maxQuoteAgeSeconds = firstFiniteNumber(coverage.maxAllowedQuoteAgeSeconds, payload.maxAllowedQuoteAgeSeconds) ?? 120;
  const issues = [];
  if (freshCoverage === null) issues.push(`${table} fresh_quote_coverage_120s missing`);
  else if (freshCoverage < minFreshCoverage) issues.push(`${table} fresh_quote_coverage_120s=${freshCoverage}<${minFreshCoverage}`);
  if (!isRealtimeRadarAfterClosePayloadReady(payload)) {
    if (quoteAgeSeconds === null) issues.push(`${table} quote_age_seconds missing`);
    else if (quoteAgeSeconds > maxQuoteAgeSeconds) issues.push(`${table} quote_age_seconds=${quoteAgeSeconds}>${maxQuoteAgeSeconds}`);
  }
  if (cleanNumber(payload.failedBatchCount) > 0) {
    issues.push(`${table} failedBatchCount=${cleanNumber(payload.failedBatchCount)}/${cleanNumber(payload.totalBatchCount) || "--"}`);
  }
  // residualStaleQuoteCount/staleQuoteCount is evidence, not a hard blocker when coverage and quote age pass.
  void residualStaleQuoteCount;
  return issues;
}

function normalizedCodes(value) {
  return Array.isArray(value)
    ? value.map((code) => String(code || "").replace(/\D/g, "").slice(0, 4)).filter(Boolean).sort()
    : [];
}

function sameCodeSet(left, right) {
  const a = normalizedCodes(left);
  const b = normalizedCodes(right);
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

function realtimeRadarPayloadDate(payload = {}) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return [
    payload.resolvedTradeDate,
    payload.tradeDate,
    payload.usedDate,
    payload.dataDate,
    payload.date,
    payload.marketDataDate,
    ...rows.slice(0, 20).flatMap((row) => [row?.radarDate, row?.tradeDate, row?.quoteDate, row?.date, row?.timestamp, row?.radarUpdatedAt]),
  ].map(compactDate).filter(Boolean).sort().at(-1) || "";
}

function realtimeRadarPayloadUpdatedAtMs(payload = {}, row = {}) {
  return cleanNumber(payload.updatedAtMs)
    || Date.parse(payload.updatedAt || payload.timestamp || row.updated_at || "")
    || 0;
}

function realtimeRadarMaxAgeMs(payload = {}) {
  const staleAfterMs = cleanNumber(payload.staleAfterMs);
  return Math.max(90000, staleAfterMs > 0 ? staleAfterMs * 3 : 90000);
}

function isRealtimeRadarLiveWindow(date = new Date()) {
  const minutes = taipeiMinutes(date);
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

function dateAgeDays(dateKey) {
  if (!/^\d{8}$/.test(String(dateKey || ""))) return null;
  const today = taipeiDateKey();
  const toUtc = (value) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  return Math.floor((toUtc(today) - toUtc(dateKey)) / 86400000);
}

async function fetchRows(table, select, query = "", timeoutMs = 25000) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing Supabase credentials");
  const attempts = Math.max(1, Number(process.env.TERMINAL_SOURCE_CONTRACT_FETCH_ATTEMPTS || 3));
  let last = { ok: false, status: 0, rows: [], error: "not attempted" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}${query ? `&${query}` : ""}`;
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        last = { ok: false, status: response.status, rows: [], error: text.slice(0, 220) };
      } else {
        const rows = JSON.parse(text || "[]");
        return { ok: true, status: response.status, rows: Array.isArray(rows) ? rows : [], error: "", attempts: attempt };
      }
    } catch (error) {
      last = { ok: false, status: 0, rows: [], error: error?.message || String(error) };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts && (last.status === 0 || last.status === 408 || last.status === 429 || last.status >= 500)) {
      await sleep(300 * attempt);
      continue;
    }
    break;
  }
  return { ...last, attempts };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkOne(strategy, check) {
  if (check.kind === "retired-source-table") {
    return {
      ...check,
      ok: true,
      level: "info",
      rowCount: 0,
      newestDate: "",
      retired: true,
      issues: [],
    };
  }
  const result = await fetchRows(check.table, check.select, check.query);
  const issues = [];
  if (!result.ok) {
    issues.push(`${check.table} ${check.kind} unreadable: HTTP ${result.status} ${result.error}`);
  }
  if (result.ok && check.minRows && result.rows.length < check.minRows) {
    issues.push(`${check.table} ${check.kind} rows ${result.rows.length}<${check.minRows}`);
  }
  if (result.ok && check.kind.startsWith("latest-run") && !result.rows[0]?.run_id) {
    issues.push(`${check.table} latest complete run missing run_id`);
  }
  if (result.ok && check.kind.startsWith("latest-run") && Number(result.rows[0]?.result_count || 0) <= 0 && strategy.key !== "strategy2") {
    issues.push(`${check.table} latest complete run result_count<=0`);
  }
  if (result.ok && check.requireToday) {
    const expected = await expectedQuoteDateKey();
    const newest = result.rows.map(rowDate).filter(Boolean).sort().at(-1) || "";
    const today = taipeiDateKey();
    if (!newest) issues.push(`${check.table} newest date missing; expected at least quote date ${expected}`);
    else if (newest < expected) issues.push(`${check.table} newest date ${newest} < expected quote date ${expected}`);
    else if (newest > today) issues.push(`${check.table} newest date ${newest} > Taipei today ${today}`);
  }
  if (result.ok && check.maxAgeDays) {
    const newest = result.rows.map(rowDate).filter(Boolean).sort().at(-1) || "";
    const ageDays = dateAgeDays(newest);
    if (ageDays == null) issues.push(`${check.table} newest date missing; maxAgeDays=${check.maxAgeDays}`);
    if (ageDays != null && ageDays > check.maxAgeDays) issues.push(`${check.table} newest date ${newest} age ${ageDays}d > ${check.maxAgeDays}d`);
  }
  if (result.ok && check.healthStatusField) {
    const row = result.rows[0] || {};
    const status = String(row[check.healthStatusField] || "").trim().toLowerCase();
    const accepted = new Set((check.acceptedHealthStatuses || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean));
    if (!status) {
      issues.push(`${check.table} ${check.healthStatusField} missing`);
    } else if (!accepted.has(status) && !(strategy.key === "strategy2" && check.table === "v_strategy2_readiness_status" && allowStrategy2ReadinessStatus(row))) {
      const reason = String(row.reason || row.suggested_scanner_behavior || "").replace(/\s+/g, " ").slice(0, 180);
      issues.push(`${check.table} ${check.healthStatusField}=${status}${reason ? ` (${reason})` : ""}`);
    }
  }
  if (result.ok && check.kind === "realtime-radar-cache") {
    const row = result.rows[0] || {};
    const payload = row.payload && typeof row.payload === "object" ? row.payload : null;
    const payloadRows = Array.isArray(payload?.rows) ? payload.rows : [];
    const expected = await expectedQuoteDateKey();
    const payloadDate = realtimeRadarPayloadDate(payload || {});
    const updatedAtMs = realtimeRadarPayloadUpdatedAtMs(payload || {}, row);
    const expectedExcludedCodes = ["1475", "1538", "2254", "2321", "2901", "5906", "7732", "8101", "8488"];
    if (!payload) issues.push(`${check.table} latest payload missing`);
    if (payload && payloadRows.length < check.minPayloadRows) issues.push(`${check.table} payload rows ${payloadRows.length}<${check.minPayloadRows}`);
    if (payload && payloadDate < expected) issues.push(`${check.table} payload date ${payloadDate || "--"} < expected quote date ${expected}`);
    if (payload && !updatedAtMs) issues.push(`${check.table} payload updatedAt missing`);
    if (payload && isRealtimeRadarLiveWindow() && payloadDate === taipeiDateKey() && updatedAtMs && Date.now() - updatedAtMs > realtimeRadarMaxAgeMs(payload)) {
      issues.push(`${check.table} payload age ${Math.round((Date.now() - updatedAtMs) / 1000)}s exceeds live max`);
    }
    if (payload) issues.push(...realtimeRadarSourceQualityIssues(payload, check.table));
    if (payload && !sameCodeSet(payload.sourceExcludedCodes, expectedExcludedCodes)) {
      issues.push(`${check.table} sourceExcludedCodes=${normalizedCodes(payload.sourceExcludedCodes).join(",") || "--"} expected=${expectedExcludedCodes.join(",")}`);
    }
  }
  return {
    ...check,
    ok: issues.length === 0,
    level: check.level || "error",
    rowCount: result.rows.length,
    newestDate: check.kind === "realtime-radar-cache"
      ? realtimeRadarPayloadDate(result.rows[0]?.payload || {}) || rowDate(result.rows[0] || {})
      : result.rows.map(rowDate).filter(Boolean).sort().at(-1) || "",
    issues,
  };
}

function markdown(results) {
  const lines = [
    "# Terminal Source Contracts",
    "",
    `- Checked: ${new Date().toISOString()} / Taipei ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei" })}`,
    `- Strict warnings: ${STRICT_WARNINGS}`,
    `- Expected quote date: ${results.expectedQuoteDate || "--"}`,
    "",
    "| 策略 | 檢查 | 類型 | rows | newestDate | 判定 |",
    "|---|---|---|---:|---:|---|",
  ];
  for (const strategy of results) {
    for (const check of strategy.checks) {
      const verdict = check.retired
        ? `RETIRED: replaced by ${check.replacement}${check.reason ? ` (${check.reason})` : ""}`
        : check.ok ? "OK" : `${check.level.toUpperCase()}: ${check.issues.join("; ")}`;
      lines.push(`| ${strategy.label} | ${check.table} | ${check.kind} | ${check.rowCount} | ${check.newestDate || "--"} | ${verdict} |`);
    }
  }
  return lines.join("\n");
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const quoteDate = await expectedQuoteDateKey();
  const results = [];
  const failures = [];
  const warnings = [];
  for (const strategy of CONTRACTS.filter((item) => !ROUTE_FILTER.size || ROUTE_FILTER.has(item.key))) {
    console.log(`[source-contract] ${strategy.key}`);
    const checks = [];
    for (const check of strategy.checks) {
      const checked = await checkOne(strategy, check);
      checks.push(checked);
      if (!checked.ok && checked.level === "warning") warnings.push(`${strategy.key}: ${checked.issues.join("; ")}`);
      if (!checked.ok && checked.level !== "warning") failures.push(`${strategy.key}: ${checked.issues.join("; ")}`);
    }
    results.push({ key: strategy.key, label: strategy.label, checks });
  }
  const payload = {
    checkedAt: new Date().toISOString(),
    strictWarnings: STRICT_WARNINGS,
    expectedQuoteDate: quoteDate,
    results,
    warnings,
    failures,
    ok: failures.length === 0 && (!STRICT_WARNINGS || warnings.length === 0),
  };
  const jsonFile = path.join(OUT_DIR, "terminal-source-contracts.json");
  const mdFile = path.join(OUT_DIR, "terminal-source-contracts.md");
  await fs.promises.writeFile(jsonFile, JSON.stringify(payload, null, 2));
  results.expectedQuoteDate = quoteDate;
  await fs.promises.writeFile(mdFile, markdown(results));
  console.log(`[source-contract] wrote ${mdFile}`);
  if (!payload.ok) {
    console.error("[source-contract] issues found");
    for (const issue of failures) console.error(`- ${issue}`);
    if (STRICT_WARNINGS) for (const issue of warnings) console.error(`- warning: ${issue}`);
    process.exitCode = 1;
  } else if (warnings.length) {
    console.warn("[source-contract] warnings");
    for (const warning of warnings) console.warn(`- ${warning}`);
  } else {
    console.log("[source-contract] ok");
  }
}

main().catch((error) => {
  console.error(`[source-contract] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
