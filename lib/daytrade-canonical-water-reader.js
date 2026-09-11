"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  SIDE_VOLUME_THRESHOLD_LOTS,
  canonicalRunId: sideVolumeCanonicalRunId,
} = require("./daytrade-side-volume-contract");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const SOURCE_NAME = "fugle_daytrade_source";
const MARKET_CALENDAR_TABLE = "market_calendar";
const MARKET_CALENDAR_CONTRACT = "market-calendar-contract-v1";
const SOURCE_STATUS_TABLE = "source_status";
const CANONICAL_GATE_VIEW = "v_fugle_daytrade_canonical_gate";
const UNATTENDED_GATE_VIEW = "v_fugle_daytrade_unattended_gate_status";
const MOTHER_POOL_CONTRACT_VERSION = "4.1.0";
const MOTHER_POOL_VIEW = "v_fugle_daytrade_mother_pool_v4_1";
const MOTHER_POOL_RECEIPT_VIEW = "v_fugle_daytrade_mother_pool_receipt_v4_1";
const QUOTE_TABLE = "fugle_daytrade_quotes_live";
const INTRADAY_1M_STATUS_VIEW = "v_fugle_daytrade_intraday_1m_status";
const INTRADAY_1M_RPC = "get_fugle_daytrade_intraday_1m_latest_n";
const FIVE_MINUTE_VIEW = "v_fugle_intraday_5m_readback";
const TELEGRAM_POOL_FRESH_COVERAGE_MIN = 0.90;

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function anonKey() {
  return process.env.SUPABASE_ANON_KEY
    || process.env.FUMAN_SUPABASE_ANON_KEY
    || readSecretText(path.join(RUNTIME_ROOT, "secrets", "supabase-anon-key.txt"))
    || readSecretText(path.join(ROOT, "secrets", "supabase-anon-key.txt"));
}

function taipeiDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function canonicalRunId(tradeDate) {
  return `${SOURCE_NAME}:${compactDate(tradeDate)}:canonical`;
}

function normalizeSymbol(value) {
  const symbol = String(value || "").replace(/\D/g, "").slice(0, 4);
  return /^\d{4}$/.test(symbol) ? symbol : "";
}

function numberValue(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function objectValue(row, names, fallback = undefined) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  for (const name of names) {
    if (row && Object.prototype.hasOwnProperty.call(row, name) && row[name] !== null && row[name] !== undefined && row[name] !== "") return row[name];
    if (Object.prototype.hasOwnProperty.call(payload, name) && payload[name] !== null && payload[name] !== undefined && payload[name] !== "") return payload[name];
  }
  return fallback;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  return String(value || "").split(/[,|+\s]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function ageSeconds(value, nowMs = Date.now()) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? Math.max(0, Math.round((nowMs - timestamp) / 1000)) : null;
}

function quoteTimestamp(row = {}) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  for (const timestamp of [
    row?.quote_seen_at,
    row?.last_trade_time,
    row?.updated_at,
    payload?.quote_seen_at,
    payload?.aggregate_last_updated,
    payload?.received_at,
  ]) {
    const parsed = new Date(String(timestamp || ""));
    if (Number.isFinite(parsed.getTime())) return String(timestamp);
  }
  return "";
}

function quoteTradeDate(row = {}) {
  const explicitTradeDate = String(row?.trade_date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(explicitTradeDate) ? explicitTradeDate : "";
}

function normalizeQuoteRow(row = {}) {
  return {
    ...row,
    trade_date: quoteTradeDate(row),
    canonical_quote_time: quoteTimestamp(row),
  };
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

function consumerCommit(explicit = "") {
  const configured = String(explicit || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || "").trim();
  if (configured) return configured;
  try {
    return String(execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true, timeout: 3000 }) || "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function hasOwn(row, field) {
  return Boolean(row && Object.prototype.hasOwnProperty.call(row, field));
}

const MOTHER_POOL_V4_1_IDENTITY_FIELDS = [
  "contract_version", "trade_date", "canonical_run_id", "writer_run_id", "generation_id",
  "symbol", "name", "market", "source_name", "source_trade_date", "source_updated_at",
  "source_freshness", "updated_at",
];

const MOTHER_POOL_V4_1_SYMBOL_FIELDS = [
  "mother_pool_rank", "priority_rank", "mother_pool_score", "priority_score", "entry_score",
  "upgrade_score", "priority_reason", "priority_reasons", "mother_reason", "mother_source",
  "pool_source", "pool_layer", "source_flags", "source_run_ids", "mother_readiness_status",
  "is_formal_entry_eligible", "price", "open_price", "previous_close", "high_price", "low_price",
  "change_percent", "total_volume", "trade_value", "avg_volume5", "quote_trade_date",
  "quote_seen_at", "quote_age_seconds", "last_trade_time", "last_trade_age_seconds",
  "latest_candle_time", "intraday_1m_stale_seconds", "mother_updated_at", "pool_updated_trade_date",
  "sector_name", "sector_strength_score", "sector_member_active_count",
  "industry_signal_fast_injected", "industry_signal_fast_inject_industries",
  "ma5", "ma10", "ma20", "ma5_ma10_ma20_bullish",
];

function normalizeMotherPoolRow(row = {}) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const metrics = row?.mother_pool_metrics && typeof row.mother_pool_metrics === "object"
    ? row.mother_pool_metrics
    : (payload?.motherPoolMetrics && typeof payload.motherPoolMetrics === "object" ? payload.motherPoolMetrics : {});
  const sourceFlags = arrayValue(
    row?.source_flags
    ?? metrics?.sourceFlags
    ?? metrics?.source_flags
    ?? payload?.sourceFlags
    ?? payload?.source_flags
  ).map(String);
  const fastInjectIndustries = arrayValue(
    row?.industry_signal_fast_inject_industries
    ?? metrics?.industrySignalFastInjectIndustries
    ?? metrics?.industry_signal_fast_inject_industries
    ?? payload?.industrySignalFastInjectIndustries
    ?? payload?.industry_signal_fast_inject_industries
  ).map(String);
  return {
    trade_date: String(row?.trade_date || ""),
    canonical_run_id: String(row?.canonical_run_id || payload?.canonicalRunId || payload?.canonical_run_id || ""),
    writer_run_id: String(row?.writer_run_id || payload?.writerRunId || payload?.writer_run_id || ""),
    generation_id: String(row?.generation_id || payload?.generationId || payload?.generation_id || ""),
    symbol: normalizeSymbol(row?.symbol),
    name: String(row?.name || ""),
    market: String(row?.market || ""),
    source_name: String(row?.source_name || SOURCE_NAME),
    source_trade_date: String(row?.source_trade_date || ""),
    quote_trade_date: String(row?.quote_trade_date || ""),
    pool_updated_trade_date: String(row?.pool_updated_trade_date || ""),
    updated_at: String(row?.updated_at || ""),
    contract_version: String(row?.contract_version || ""),
    source_updated_at: String(row?.source_updated_at || ""),
    source_freshness: String(row?.source_freshness || ""),
    quote_seen_at: String(row?.quote_seen_at || ""),
    quote_age_seconds: numberValue(row?.quote_age_seconds, null),
    last_trade_time: String(row?.last_trade_time || ""),
    last_trade_age_seconds: numberValue(row?.last_trade_age_seconds, null),
    mother_updated_at: String(row?.mother_updated_at || ""),
    price: numberValue(row?.price, 0),
    open_price: numberValue(row?.open_price, 0),
    previous_close: numberValue(row?.previous_close, 0),
    high_price: numberValue(row?.high_price, 0),
    low_price: numberValue(row?.low_price, 0),
    change_percent: numberValue(row?.change_percent ?? row?.live_change_percent, 0),
    total_volume: numberValue(row?.total_volume ?? row?.live_total_volume, 0),
    trade_value: numberValue(row?.trade_value ?? row?.live_trade_value, 0),
    avg_volume5: numberValue(row?.avg_volume5 ?? row?.avg5_volume ?? row?.live_avg_volume5, 0),
    mother_pool_rank: numberValue(row?.mother_pool_rank ?? row?.priority_rank, 0),
    priority_reason: String(row?.priority_reason || ""),
    pool_source: String(row?.pool_source || ""),
    pool_layer: String(row?.pool_layer || ""),
    entry_score: numberValue(row?.entry_score, 0),
    upgrade_score: numberValue(row?.upgrade_score, 0),
    priority_rank: numberValue(row?.priority_rank, 0),
    mother_pool_score: numberValue(row?.mother_pool_score, 0),
    priority_score: numberValue(row?.priority_score, 0),
    mother_reason: String(row?.mother_reason || ""),
    mother_source: String(row?.mother_source || ""),
    mother_readiness_status: String(row?.mother_readiness_status || ""),
    is_formal_entry_eligible: row?.is_formal_entry_eligible === true,
    latest_candle_time: String(row?.latest_candle_time || row?.latest_1m_time || ""),
    latest_1m_time: String(row?.latest_candle_time || row?.latest_1m_time || ""),
    intraday_1m_stale_seconds: numberValue(row?.intraday_1m_stale_seconds, null),
    sector_name: String(row?.sector_name || metrics?.sectorName || metrics?.sector_name || ""),
    sector_strength_score: numberValue(row?.sector_strength_score ?? metrics?.sectorStrengthScore ?? metrics?.sector_strength_score, 0),
    sector_member_active_count: numberValue(row?.sector_member_active_count ?? metrics?.sectorMemberActiveCount ?? metrics?.sector_member_active_count, 0),
    inside_volume: numberValue(row?.inside_volume ?? metrics?.insideVolume ?? metrics?.inside_volume, null),
    outside_volume: numberValue(row?.outside_volume ?? metrics?.outsideVolume ?? metrics?.outside_volume, null),
    side_volume_total: numberValue(row?.side_volume_total ?? metrics?.sideVolumeTotal ?? metrics?.side_volume_total, null),
    side_volume_unit: String(row?.side_volume_unit ?? metrics?.sideVolumeUnit ?? metrics?.side_volume_unit ?? "").toLowerCase(),
    side_volume_threshold_lots: numberValue(row?.side_volume_threshold_lots ?? metrics?.sideVolumeThresholdLots ?? metrics?.side_volume_threshold_lots, SIDE_VOLUME_THRESHOLD_LOTS),
    side_volume_threshold_met: row?.side_volume_threshold_met === true || metrics?.sideVolumeThresholdMet === true || metrics?.side_volume_threshold_met === true,
    side_volume_ge_2000_lots: row?.side_volume_ge_2000_lots === true || metrics?.sideVolumeGe2000Lots === true || metrics?.side_volume_ge_2000_lots === true,
    side_volume_source: String(row?.side_volume_source ?? metrics?.sideVolumeSource ?? metrics?.side_volume_source ?? ""),
    side_volume_source_event_at: String(row?.side_volume_source_event_at ?? metrics?.sideVolumeSourceEventAt ?? metrics?.side_volume_source_event_at ?? ""),
    side_volume_trade_date: String(row?.side_volume_trade_date ?? metrics?.sideVolumeTradeDate ?? metrics?.side_volume_trade_date ?? ""),
    side_volume_canonical_run_id: String(row?.side_volume_canonical_run_id ?? metrics?.sideVolumeCanonicalRunId ?? metrics?.side_volume_canonical_run_id ?? ""),
    side_volume_definition: String(row?.side_volume_definition ?? metrics?.sideVolumeDefinition ?? metrics?.side_volume_definition ?? ""),
    side_volume_includes_odd_lot: row?.side_volume_includes_odd_lot === true || metrics?.sideVolumeIncludesOddLot === true || metrics?.side_volume_includes_odd_lot === true,
    side_volume_includes_opening_auction_first_trade: row?.side_volume_includes_opening_auction_first_trade === true || metrics?.sideVolumeIncludesOpeningAuctionFirstTrade === true || metrics?.side_volume_includes_opening_auction_first_trade === true,
    side_volume_includes_unclassified_trades: row?.side_volume_includes_unclassified_trades === true || metrics?.sideVolumeIncludesUnclassifiedTrades === true || metrics?.side_volume_includes_unclassified_trades === true,
    side_volume_difference_from_total: numberValue(row?.side_volume_difference_from_total ?? metrics?.sideVolumeDifferenceFromTotal ?? metrics?.side_volume_difference_from_total, null),
    outside_inside_ratio: numberValue(row?.outside_inside_ratio ?? metrics?.outsideInsideRatio ?? metrics?.outside_inside_ratio, null),
    side_volume_available: row?.side_volume_available === true || metrics?.sideVolumeAvailable === true || metrics?.side_volume_available === true,
    outside_volume_ge_inside_times_2: row?.outside_volume_ge_inside_times_2 === true || metrics?.outsideVolumeGeInsideTimes2 === true || metrics?.outside_volume_ge_inside_times_2 === true,
    outside_volume_gt_inside_times_2: row?.outside_volume_gt_inside_times_2 === true || metrics?.outsideVolumeGtInsideTimes2 === true || metrics?.outside_volume_gt_inside_times_2 === true,
    source_flags: sourceFlags,
    source_run_ids: arrayValue(row?.source_run_ids).map(String),
    priority_reasons: arrayValue(row?.priority_reasons).map(String),
    ma5: numberValue(row?.ma5, null),
    ma10: numberValue(row?.ma10, null),
    ma20: numberValue(row?.ma20, null),
    ma5_ma10_ma20_bullish: row?.ma5_ma10_ma20_bullish === true,
    industry_signal_fast_injected: row?.industry_signal_fast_injected === true || sourceFlags.includes("industry_signal_fast_inject"),
    industry_signal_fast_inject_industries: fastInjectIndustries,
  };
}

function chunks(items, size = 200) {
  const out = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function buildUrl(target, params = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${target}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function requestHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", ...extra };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function transientError(error) {
  const status = Number(error?.status || 0);
  return !status || status === 408 || status === 429 || status >= 500;
}

async function withBoundedRetry(operation, options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts || 2)));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (attempt >= attempts || !transientError(error)) throw error;
      await wait(250 * attempt);
    }
  }
  throw lastError;
}

async function readRows(key, target, params = {}, options = {}) {
  return withBoundedRetry(async () => {
    const response = await fetch(buildUrl(target, params), {
      headers: requestHeaders(key),
      signal: AbortSignal.timeout(Number(options.timeout || 15000)),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`${target}_http_${response.status}:${body.slice(0, 180)}`);
      error.status = response.status;
      throw error;
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  }, options);
}

async function readAllRows(key, target, params = {}, options = {}) {
  const pageSize = Math.max(1, Math.min(1000, Number(options.pageSize || 500)));
  const maxRows = Math.max(pageSize, Number(options.maxRows || 5000));
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await readRows(key, target, { ...params, limit: pageSize, offset }, options);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function readRpc(key, name, body, options = {}) {
  return withBoundedRetry(async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: requestHeaders(key, { "Content-Type": "application/json" }),
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(Number(options.timeout || 20000)),
    });
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      const error = new Error(`${name}_http_${response.status}:${responseBody.slice(0, 180)}`);
      error.status = response.status;
      throw error;
    }
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  }, options);
}

function summarizeGate(row) {
  const channels = stringList(objectValue(row, ["websocket_streaming_channels", "websocket_streaming_channel"], []));
  const failedChecks = objectValue(row, ["failed_checks"], []);
  return {
    grade: String(objectValue(row, ["canonical_gate_grade", "daytrade_gate_grade", "gate_grade", "gate"], "")).toUpperCase(),
    status: String(objectValue(row, ["canonical_gate_status", "gate_status", "status"], "")).toLowerCase(),
    reason: String(objectValue(row, ["canonical_gate_reason", "reason", "message"], "")),
    formal_entry_allowed: objectValue(row, ["formal_entry_allowed"], false) === true,
    formal_entry_speed_verdict: String(objectValue(row, ["formal_entry_speed_verdict"], "")).toUpperCase(),
    scanner_can_run_opening: objectValue(row, ["scanner_can_run_opening", "scanner_can_run_intraday"], false) === true,
    formal_source_alignment_ok: objectValue(row, ["formal_source_alignment_ok"], false) === true,
    priority_fresh_quote_coverage_120s: numberValue(objectValue(row, ["priority_fresh_quote_coverage_120s"], 0), 0),
    quote_age_seconds: numberValue(objectValue(row, ["quote_age_seconds", "formal_max_quote_age_seconds"], 999999), 999999),
    websocket_formal_ready: objectValue(row, ["websocket_formal_ready"], false) === true,
    websocket_connected: objectValue(row, ["websocket_connected"], false) === true,
    websocket_authenticated: objectValue(row, ["websocket_authenticated"], false) === true,
    websocket_rest_disabled: objectValue(row, ["websocket_rest_disabled"], false) === true,
    websocket_streaming_channels: channels,
    failed_checks: Array.isArray(failedChecks) ? failedChecks : stringList(failedChecks),
    trade_date: String(objectValue(row, ["trade_date", "tradeDate"], "")),
    canonical_run_id: String(objectValue(row, ["canonical_run_id", "canonicalRunId"], "")),
    updated_at: String(objectValue(row, ["checked_at", "updated_at"], "")),
  };
}

function validateGate(summary, prefix, failures) {
  if (summary.grade !== "A") failures.push(`${prefix}_grade_not_A`);
  if (!['ready', 'ok'].includes(summary.status)) failures.push(`${prefix}_status_not_ready`);
  if (summary.formal_entry_allowed !== true) failures.push(`${prefix}_formal_entry_not_allowed`);
  if (summary.formal_entry_speed_verdict !== "YES") failures.push(`${prefix}_speed_verdict_not_YES`);
  if (summary.scanner_can_run_opening !== true) failures.push(`${prefix}_scanner_not_allowed`);
  if (summary.formal_source_alignment_ok !== true) failures.push(`${prefix}_source_alignment_failed`);
  if (summary.priority_fresh_quote_coverage_120s < 0.95) failures.push(`${prefix}_priority_quote_coverage_below_095`);
  if (summary.quote_age_seconds > 90) failures.push(`${prefix}_quote_age_above_90`);
  if (summary.websocket_formal_ready !== true) failures.push(`${prefix}_websocket_not_formal_ready`);
  if (summary.websocket_connected !== true) failures.push(`${prefix}_websocket_not_connected`);
  if (summary.websocket_authenticated !== true) failures.push(`${prefix}_websocket_not_authenticated`);
  if (summary.websocket_rest_disabled !== true) failures.push(`${prefix}_websocket_rest_not_disabled`);
  for (const channel of ["trades", "aggregates", "candles"]) {
    if (!summary.websocket_streaming_channels.includes(channel)) failures.push(`${prefix}_websocket_${channel}_missing`);
  }
  if (summary.failed_checks.length) failures.push(`${prefix}_failed_checks_not_empty`);
}

function validateTelegramObservationSource(summary, prefix, failures) {
  if (summary.formal_source_alignment_ok !== true) failures.push(`${prefix}_source_alignment_failed`);
  if (summary.websocket_connected !== true) failures.push(`${prefix}_websocket_not_connected`);
  if (summary.websocket_authenticated !== true) failures.push(`${prefix}_websocket_not_authenticated`);
  if (summary.websocket_rest_disabled !== true) failures.push(`${prefix}_websocket_rest_not_disabled`);
  for (const channel of ["trades", "aggregates", "candles"]) {
    if (!summary.websocket_streaming_channels.includes(channel)) failures.push(`${prefix}_websocket_${channel}_missing`);
  }
}

function failureFromError(error) {
  if ([401, 403].includes(Number(error?.status))) return "canonical_water_permission_denied";
  return "canonical_water_data_gap";
}

async function readCanonicalDaytradeWater(options = {}) {
  const checkedAt = new Date().toISOString();
  const nowMs = Date.now();
  const tradeDate = options.tradeDate || taipeiDate();
  const expectedRunId = canonicalRunId(tradeDate);
  const telegramObservation = options.telegramObservation === true;
  const strategy3Consumer = options.strategy3Consumer === true || options.consumerName === "strategy3_v2";
  const historicalRecoveryReplay = options.historicalRecoveryReplay === true;
  const postCloseSnapshotRead = options.postCloseSnapshotRead === true;
  const bypassLiveSessionGate = historicalRecoveryReplay || postCloseSnapshotRead;
  const requireMarketCalendar = options.requireMarketCalendar === true;
  const requireMotherPoolReceipt = options.requireMotherPoolReceipt === true;
  const hydrateMotherPoolCandles = options.hydrateMotherPoolCandles === true;
  const minimumCandlesPerSymbol = Math.max(1, Number(options.minimumCandlesPerSymbol || 20));
  const requestedEventSymbols = [...new Set((options.symbols || []).map(normalizeSymbol).filter(Boolean))];
  const failures = [];
  const key = anonKey();
  const baseReceipt = {
    contract: "daytrade_canonical_water_reader_v1",
    contract_version: MOTHER_POOL_CONTRACT_VERSION,
    checked_at: checkedAt,
    trade_date: tradeDate,
    canonical_run_id: expectedRunId,
    source_name: SOURCE_NAME,
    reader_policy: "supabase_read_only_no_writer_no_fugle_fallback",
    credential_role: "anon_or_authenticated_reader",
    writes_supabase: false,
    consumer_name: String(options.consumerName || "canonical_daytrade_water"),
    consumer_commit: consumerCommit(options.consumerCommit),
    reader_mode: historicalRecoveryReplay ? "historical_recovery_replay_v4_1" : postCloseSnapshotRead ? "post_close_snapshot_v4_1" : (strategy3Consumer ? "strategy3_v2_mother_pool_v4_1" : (telegramObservation ? "telegram_observation_per_symbol_fail_closed" : "formal_gate_fail_closed")),
    historical_recovery_replay: historicalRecoveryReplay,
    post_close_snapshot_read: postCloseSnapshotRead,
    telegram_pool_fresh_coverage_min: telegramObservation ? TELEGRAM_POOL_FRESH_COVERAGE_MIN : null,
    quote_trade_date_policy: "require_explicit_fugle_daytrade_quotes_live_trade_date_v1",
    mother_pool_capacity_target: 300,
    mother_pool_minimum_required: 1,
    mother_pool_capacity_is_hard_gate: false,
    requested_symbols: requestedEventSymbols,
    sources: {
      market_calendar: MARKET_CALENDAR_TABLE,
      source_status: SOURCE_STATUS_TABLE,
      canonical_gate: CANONICAL_GATE_VIEW,
      unattended_gate: UNATTENDED_GATE_VIEW,
      mother_pool: MOTHER_POOL_VIEW,
      mother_pool_receipt: MOTHER_POOL_RECEIPT_VIEW,
      quote: QUOTE_TABLE,
      intraday_1m_status: INTRADAY_1M_STATUS_VIEW,
      intraday_1m_rpc: INTRADAY_1M_RPC,
      intraday_5m: FIVE_MINUTE_VIEW,
    },
  };
  const emptyMaps = { poolBySymbol: new Map(), quoteBySymbol: new Map(), candleRowsBySymbol: new Map(), evidenceBySymbol: new Map(), symbolDataGaps: new Map() };
  if (!key) {
    const failedChecks = ["canonical_water_anon_key_missing"];
    return { ok: false, firstBlocker: failedChecks[0], failedChecks, receipt: { ...baseReceipt, status: "failed", complete: false, failed_checks: failedChecks, first_blocker: failedChecks[0] }, ...emptyMaps };
  }

  try {
    // Strategy consumers may require the public calendar before every other
    // formal source. Existing observation consumers keep their established
    // call order unless they opt in explicitly.
    let marketCalendar = null;
    if (requireMarketCalendar) {
      const calendarRows = await readRows(key, MARKET_CALENDAR_TABLE, {
        select: "*",
        market: "eq.TW",
        trade_date: `eq.${tradeDate}`,
        order: "updated_at.desc",
        limit: 1,
      });
      marketCalendar = calendarRows[0] || null;
      if (!marketCalendar) failures.push("canonical_water_market_calendar_missing");
      if (String(marketCalendar?.market || "") !== "TW") failures.push("canonical_water_market_calendar_market_mismatch");
      if (String(marketCalendar?.trade_date || "") !== tradeDate) failures.push("canonical_water_market_calendar_trade_date_mismatch");
      if (String(objectValue(marketCalendar, ["calendar_contract"], "")) !== MARKET_CALENDAR_CONTRACT) failures.push("canonical_water_market_calendar_contract_mismatch");
      if (failures.length) {
        return {
          ok: false,
          firstBlocker: failures[0],
          failedChecks: failures,
          receipt: { ...baseReceipt, status: "failed", complete: false, market_calendar: marketCalendar, global_formal_gate_blocked: true, receipt_incomplete: false, failed_checks: failures, first_blocker: failures[0] },
          ...emptyMaps,
        };
      }
      if (marketCalendar?.is_open !== true) {
        return {
          ok: true,
          skipped: true,
          marketClosed: true,
          firstBlocker: null,
          failedChecks: [],
          receipt: { ...baseReceipt, status: "skipped", complete: true, market_calendar: marketCalendar, market_closed: true, global_formal_gate_blocked: false, receipt_incomplete: false, failed_checks: [], first_blocker: null },
          ...emptyMaps,
        };
      }
    }

    // The remaining order is contractual: source status -> gates -> Mother
    // Pool -> producer receipt -> symbol-scoped market data.
    const sourceRows = await readRows(key, SOURCE_STATUS_TABLE, {
      select: "source_name,status,message,updated_at,payload",
      source_name: `eq.${SOURCE_NAME}`,
      order: "updated_at.desc",
      limit: 1,
    });
    const sourceRow = sourceRows[0] || null;
    const source = summarizeGate(sourceRow);
    if (!sourceRow) failures.push("canonical_water_source_status_missing");
    if (String(sourceRow?.source_name || "") !== SOURCE_NAME) failures.push("canonical_water_source_name_mismatch");
    if (!telegramObservation && !bypassLiveSessionGate && String(sourceRow?.status || "").toLowerCase() !== "ok") failures.push("canonical_water_source_status_not_ok");
    if (source.trade_date !== tradeDate) failures.push("canonical_water_source_trade_date_mismatch");
    if (source.canonical_run_id !== expectedRunId) failures.push("canonical_water_source_canonical_run_id_mismatch");
    if (!bypassLiveSessionGate) {
      if (telegramObservation) validateTelegramObservationSource(source, "canonical_water_source", failures);
      else validateGate(source, "canonical_water_source", failures);
    }

    const canonicalRows = await readRows(key, CANONICAL_GATE_VIEW, { select: "*", limit: 1 });
    const canonical = summarizeGate(canonicalRows[0] || null);
    if (!canonicalRows.length) failures.push("canonical_water_canonical_gate_missing");
    if (!bypassLiveSessionGate) {
      if (telegramObservation) validateTelegramObservationSource(canonical, "canonical_water_canonical_gate", failures);
      else validateGate(canonical, "canonical_water_canonical_gate", failures);
    }
    if (canonical.trade_date && canonical.trade_date !== tradeDate) failures.push("canonical_water_canonical_gate_trade_date_mismatch");
    if (canonical.canonical_run_id && canonical.canonical_run_id !== expectedRunId) failures.push("canonical_water_canonical_gate_run_id_mismatch");

    const unattendedRows = await readRows(key, UNATTENDED_GATE_VIEW, { select: "*", limit: 1 });
    const unattended = summarizeGate(unattendedRows[0] || null);
    if (!unattendedRows.length) failures.push("canonical_water_unattended_gate_missing");
    if (!bypassLiveSessionGate) {
      if (telegramObservation) validateTelegramObservationSource(unattended, "canonical_water_unattended_gate", failures);
      else validateGate(unattended, "canonical_water_unattended_gate", failures);
    }
    if (unattended.trade_date && unattended.trade_date !== tradeDate) failures.push("canonical_water_unattended_gate_trade_date_mismatch");
    if (unattended.canonical_run_id && unattended.canonical_run_id !== expectedRunId) failures.push("canonical_water_unattended_gate_run_id_mismatch");

    if (failures.length) {
      return {
        ok: false,
        firstBlocker: failures[0],
        failedChecks: failures,
        receipt: { ...baseReceipt, status: "failed", complete: false, market_calendar: marketCalendar, source_status_at_run: source, canonical_gate_at_run: canonical, unattended_gate_at_run: unattended, global_formal_gate_blocked: true, receipt_incomplete: false, failed_checks: failures, first_blocker: failures[0] },
        ...emptyMaps,
      };
    }

    const poolRows = await readAllRows(key, MOTHER_POOL_VIEW, {
      select: "*",
      trade_date: `eq.${tradeDate}`,
      canonical_run_id: `eq.${expectedRunId}`,
      contract_version: `eq.${MOTHER_POOL_CONTRACT_VERSION}`,
      // Rank can change while the Writer refreshes the pool. Symbol ordering
      // is stable across pages and prevents duplicate/omitted rows mid-read.
      order: "symbol.asc",
    }, { pageSize: 200, maxRows: 5000, timeout: 30000 });
    const normalizedPoolRows = poolRows.map(normalizeMotherPoolRow);
    const poolBySymbol = new Map();
    const symbolDataGaps = new Map();
    const duplicateSymbols = new Set();
    const addSymbolGap = (symbol, code) => {
      if (!symbol) return;
      const list = symbolDataGaps.get(symbol) || [];
      if (!list.includes(code)) list.push(code);
      symbolDataGaps.set(symbol, list);
    };
    for (let index = 0; index < poolRows.length; index += 1) {
      const row = poolRows[index];
      const normalized = normalizedPoolRows[index];
      const symbol = normalized.symbol;
      if (!symbol) failures.push("canonical_water_mother_pool_symbol_invalid");
      else if (poolBySymbol.has(symbol)) duplicateSymbols.add(symbol);
      else poolBySymbol.set(symbol, normalized);
      if (String(row?.trade_date || "") !== tradeDate) failures.push("canonical_water_mother_pool_trade_date_mismatch");
      if (String(row?.contract_version || "") !== MOTHER_POOL_CONTRACT_VERSION) failures.push("canonical_water_mother_pool_contract_version_mismatch");
      if (String(row?.canonical_run_id || "") !== expectedRunId) failures.push("canonical_water_mother_pool_canonical_run_id_mismatch");
      if (String(row?.source_freshness || "") !== "same_trade_date_current") failures.push("canonical_water_mother_pool_source_freshness_invalid");
      if (!String(row?.source_updated_at || "")) failures.push("canonical_water_mother_pool_source_updated_at_missing");
      if (["ma30", "ma35", "ma58", "ma5_ma10_ma35_bullish"].some((field) => Object.prototype.hasOwnProperty.call(row, field))) failures.push("canonical_water_mother_pool_retired_ma_field_present");
      if (strategy3Consumer && symbol) {
        const missingIdentity = MOTHER_POOL_V4_1_IDENTITY_FIELDS.filter((field) => !hasOwn(row, field));
        if (missingIdentity.length) failures.push(`canonical_water_mother_pool_identity_fields_missing:${symbol}:${missingIdentity.join(",")}`);
        const missingSymbolFields = MOTHER_POOL_V4_1_SYMBOL_FIELDS.filter((field) => !hasOwn(row, field));
        for (const field of missingSymbolFields) addSymbolGap(symbol, `mother_pool_field_missing:${field}`);
      }
    }
    if (duplicateSymbols.size) failures.push(`canonical_water_mother_pool_duplicate_symbols:${[...duplicateSymbols].join(",")}`);
    const poolSymbols = [...poolBySymbol.keys()];
    if (!poolSymbols.length) failures.push("canonical_water_mother_pool_empty");

    let producerReceipt = null;
    let receiptIncomplete = false;
    if (requireMotherPoolReceipt) {
      const producerReceiptRows = await readRows(key, MOTHER_POOL_RECEIPT_VIEW, {
        select: "*",
        trade_date: `eq.${tradeDate}`,
        canonical_run_id: `eq.${expectedRunId}`,
        contract_version: `eq.${MOTHER_POOL_CONTRACT_VERSION}`,
        order: "verified_at.desc",
        limit: 1,
      });
      producerReceipt = producerReceiptRows[0] || null;
      const producerFailedChecks = arrayValue(producerReceipt?.failed_checks).filter(Boolean);
      receiptIncomplete = !producerReceipt
        || producerReceipt?.complete !== true
        || producerFailedChecks.length > 0
        || Boolean(String(producerReceipt?.first_blocker || ""))
        || Number(producerReceipt?.mother_pool_rows ?? -1) !== poolBySymbol.size;
      if (receiptIncomplete) failures.push("canonical_water_mother_pool_receipt_incomplete");
    }

    const quoteRows = [];
    const intradayStatusRows = [];
    // The v4.1 pool already carries same-trade-date quote/1m freshness for the
    // full universe. Telegram hydrates the heavier source views only for
    // actual outbox events; querying all 720 rows here creates avoidable view
    // timeouts and does not improve the event-based synchronization gate.
    const hydrationSymbols = postCloseSnapshotRead ? [] : (strategy3Consumer || hydrateMotherPoolCandles)
      ? poolSymbols
      : (telegramObservation ? requestedEventSymbols : poolSymbols);
    for (const group of chunks(hydrationSymbols, 200)) {
      const filter = `in.(${group.join(",")})`;
      quoteRows.push(...await readRows(key, QUOTE_TABLE, {
        select: "symbol,trade_date,name,market,price,open_price,previous_close,high_price,low_price,change_percent,total_volume,trade_value,limit_up_price,quote_seen_at,last_trade_time,updated_at,cumulative_bid_volume,cumulative_ask_volume,cumulative_bid_ask_volume,source,source_name,is_realtime,is_fallback,is_formal_entry_eligible,payload",
        trade_date: `eq.${tradeDate}`,
        symbol: filter,
        limit: group.length,
      }, { timeout: 15000 }));
      if (!strategy3Consumer) {
        intradayStatusRows.push(...await readRows(key, INTRADAY_1M_STATUS_VIEW, {
          select: "*",
          symbol: filter,
          trade_date: `eq.${tradeDate}`,
          limit: group.length,
        }, { timeout: 15000 }));
      }
    }
    const normalizedQuoteRows = quoteRows.map(normalizeQuoteRow);
    const quoteBySymbol = new Map(normalizedQuoteRows.map((row) => [normalizeSymbol(row?.symbol), row]).filter(([symbol]) => symbol));
    const intradayStatusBySymbol = new Map(intradayStatusRows.map((row) => [normalizeSymbol(row?.symbol), row]).filter(([symbol]) => symbol));
    const freshQuoteSymbols = telegramObservation ? normalizedPoolRows.filter((row) => row.quote_age_seconds !== null && row.quote_age_seconds <= 120).map((row) => row.symbol) : poolSymbols.filter((symbol) => {
      const quote = quoteBySymbol.get(symbol);
      const seenAt = quote?.canonical_quote_time;
      return String(quote?.trade_date || "") === tradeDate && ageSeconds(seenAt, nowMs) !== null && ageSeconds(seenAt, nowMs) <= 120;
    });
    const quoteCoverage = poolSymbols.length ? freshQuoteSymbols.length / poolSymbols.length : 0;
    const freshPool1mRows = normalizedPoolRows.filter((row) => row.intraday_1m_stale_seconds !== null && row.intraday_1m_stale_seconds <= 120).length;
    const pool1mFreshCoverage = poolSymbols.length ? freshPool1mRows / poolSymbols.length : 0;
    const marketEventRows = normalizedPoolRows.filter((row) => row.last_trade_age_seconds !== null && row.last_trade_age_seconds <= 120);
    const synchronizedMarketEventRows = marketEventRows.filter((row) => row.quote_age_seconds !== null && row.quote_age_seconds <= 120 && row.intraday_1m_stale_seconds !== null && row.intraday_1m_stale_seconds <= 120);
    const marketEventSyncCoverage = marketEventRows.length ? synchronizedMarketEventRows.length / marketEventRows.length : 1;
    if (telegramObservation && marketEventSyncCoverage < TELEGRAM_POOL_FRESH_COVERAGE_MIN) failures.push("canonical_water_telegram_market_event_sync_coverage_below_090");
    if (!strategy3Consumer && !telegramObservation && !postCloseSnapshotRead && quoteCoverage < 0.95) failures.push("canonical_water_mother_pool_quote_coverage_below_095");
    if (!strategy3Consumer && !postCloseSnapshotRead && (!telegramObservation || requestedEventSymbols.length > 0) && !intradayStatusRows.length) failures.push("canonical_water_intraday_1m_status_empty");

    const candleRequestSymbols = hydrateMotherPoolCandles ? poolSymbols : requestedEventSymbols;
    const candleRows = [];
    const requestedBarsPerSymbol = Math.max(strategy3Consumer ? minimumCandlesPerSymbol : 61, Number(options.barsPerSymbol || 61));
    // PostgREST/RPC responses are capped by rows, not symbols. Keep every
    // request under that cap so a large Mother Pool does not silently return
    // candles for only the first few symbols in each chunk.
    const candleChunkSize = Math.max(1, Math.min(200, Math.floor(900 / requestedBarsPerSymbol)));
    for (const group of chunks(candleRequestSymbols, candleChunkSize)) {
      candleRows.push(...await readRpc(key, INTRADAY_1M_RPC, {
        symbols: group,
        bars_per_symbol: requestedBarsPerSymbol,
      }, { timeout: Number(options.candleTimeout || (historicalRecoveryReplay ? 60000 : 30000)) }));
    }
    const rawCandleRowsBySymbol = new Map();
    const candleRowsBySymbol = new Map();
    for (const row of candleRows) {
      const symbol = normalizeSymbol(row?.symbol);
      if (!symbol) continue;
      const rawList = rawCandleRowsBySymbol.get(symbol) || [];
      rawList.push(row);
      rawCandleRowsBySymbol.set(symbol, rawList);
      const strategyUsable = String(row?.trade_date || "") === tradeDate
        && row?.synthetic === false
        && row?.volume_strategy_usable === true;
      if (!strategy3Consumer || strategyUsable) {
        const list = candleRowsBySymbol.get(symbol) || [];
        list.push(row);
        candleRowsBySymbol.set(symbol, list);
      }
    }
    for (const list of candleRowsBySymbol.values()) list.sort((a, b) => Date.parse(String(a?.candle_time || "")) - Date.parse(String(b?.candle_time || "")));

    let quoteValidRows = 0;
    let intraday1mValidRows = 0;
    if (strategy3Consumer) {
      for (const symbol of poolSymbols) {
        const quote = quoteBySymbol.get(symbol) || null;
        const quoteValid = Boolean(quote)
          && String(quote?.trade_date || "") === tradeDate
          && Boolean(String(quote?.quote_seen_at || quote?.last_trade_time || ""));
        if (quoteValid) quoteValidRows += 1;
        else addSymbolGap(symbol, "quote_data_gap");

        const rawCandles = rawCandleRowsBySymbol.get(symbol) || [];
        const sameDayRows = rawCandles.filter((row) => String(row?.trade_date || "") === tradeDate);
        const usableCandles = candleRowsBySymbol.get(symbol) || [];
        const hasForbiddenCandle = sameDayRows.some((row) => row?.synthetic !== false || row?.volume_strategy_usable !== true);
        if (hasForbiddenCandle) addSymbolGap(symbol, "intraday_1m_not_volume_strategy_usable");
        if (usableCandles.length < minimumCandlesPerSymbol) addSymbolGap(symbol, "intraday_1m_usable_rows_below_minimum");
        else intraday1mValidRows += 1;
      }
    }

    const evidenceBySymbol = new Map();
    for (const symbol of requestedEventSymbols) {
      const poolRow = poolBySymbol.get(symbol) || null;
      const quote = quoteBySymbol.get(symbol) || null;
      const statusRow = intradayStatusBySymbol.get(symbol) || null;
      const candles = (candleRowsBySymbol.get(symbol) || []).filter((row) => String(row?.trade_date || "") === tradeDate && row?.synthetic !== true);
      const latestCandle = candles[candles.length - 1] || null;
      const quoteAge = ageSeconds(quote?.canonical_quote_time, nowMs);
      const candleAge = ageSeconds(latestCandle?.candle_time || latestCandle?.updated_at, nowMs);
      const evidence = {
        symbol,
        mother_pool_member: Boolean(poolRow),
        quote_present: Boolean(quote),
        quote_trade_date: String(quote?.trade_date || ""),
        quote_trade_date_ok: Boolean(quote) && String(quote?.trade_date || "") === tradeDate,
        quote_age_seconds: quoteAge,
        quote_fresh: quoteAge !== null && quoteAge <= 120,
        intraday_1m_status_present: Boolean(statusRow),
        intraday_1m_sample_count: candles.length,
        intraday_1m_trade_date_ok: candles.length >= 61,
        intraday_1m_latest_time: String(latestCandle?.candle_time || ""),
        intraday_1m_age_seconds: candleAge,
        intraday_1m_ready: candles.length >= 61 && candleAge !== null && candleAge <= 120,
        side_volume_available: poolRow?.side_volume_available === true,
        side_volume_unit: poolRow?.side_volume_unit || "",
        side_volume_total: poolRow?.side_volume_total ?? null,
        side_volume_ge_2000_lots: poolRow?.side_volume_ge_2000_lots === true,
        side_volume_source_event_at: poolRow?.side_volume_source_event_at || "",
        side_volume_trade_date: poolRow?.side_volume_trade_date || "",
        side_volume_canonical_run_id: poolRow?.side_volume_canonical_run_id || "",
      };
      evidenceBySymbol.set(symbol, evidence);
      if (!evidence.mother_pool_member) failures.push(`canonical_water_event_not_in_mother_pool:${symbol}`);
      if (!evidence.quote_present || !evidence.quote_trade_date_ok || !evidence.quote_fresh) failures.push(`canonical_water_event_quote_not_ready:${symbol}`);
      if (!evidence.intraday_1m_status_present || !evidence.intraday_1m_ready) failures.push(`canonical_water_event_1m_not_ready:${symbol}`);
    }

    const uniqueFailures = [...new Set(failures)];
    const latestQuoteTime = normalizedQuoteRows.map((row) => String(row?.canonical_quote_time || "")).sort().pop() || "";
    const latest1mTime = (strategy3Consumer ? candleRows : intradayStatusRows)
      .map((row) => String(row?.candle_time || row?.latest_candle_time || row?.updated_at || ""))
      .sort().pop() || "";
    const receipt = {
      ...baseReceipt,
      status: uniqueFailures.length ? "failed" : "complete",
      complete: uniqueFailures.length === 0,
      market_calendar: marketCalendar,
      source_status_at_run: source,
      canonical_gate_at_run: canonical,
      unattended_gate_at_run: unattended,
      mother_pool_producer_receipt: producerReceipt,
      mother_pool_http_status: 200,
      mother_pool_rows: poolRows.length,
      mother_pool_pages: Math.ceil(poolRows.length / 200),
      unique_symbols: poolBySymbol.size,
      mother_pool_read_rows: poolBySymbol.size,
      mother_pool_symbols: poolSymbols,
      mother_pool_trade_date_matches: poolRows.every((row) => String(row?.trade_date || "") === tradeDate),
      mother_pool_contract_version: MOTHER_POOL_CONTRACT_VERSION,
      mother_pool_canonical_run_id_matches: poolRows.every((row) => String(row?.canonical_run_id || "") === expectedRunId),
      mother_pool_source_freshness_matches: poolRows.every((row) => String(row?.source_freshness || "") === "same_trade_date_current"),
      mother_pool_page_size: 200,
      mother_pool_page_count: Math.ceil(poolRows.length / 200),
      mother_pool_field_coverage: {
        price_rows: normalizedPoolRows.filter((row) => row.price > 0).length,
        latest_1m_time_rows: normalizedPoolRows.filter((row) => Boolean(row.latest_1m_time)).length,
        side_volume_ready_rows: normalizedPoolRows.filter((row) => row.side_volume_available === true).length,
        side_volume_data_gap_rows: normalizedPoolRows.filter((row) => row.side_volume_available !== true).length,
        side_volume_lots_rows: normalizedPoolRows.filter((row) => row.side_volume_unit === "lots").length,
        side_volume_ge_2000_lots_rows: normalizedPoolRows.filter((row) => row.side_volume_ge_2000_lots === true).length,
        side_volume_same_day_rows: normalizedPoolRows.filter((row) => row.side_volume_trade_date === tradeDate).length,
        side_volume_same_canonical_run_rows: normalizedPoolRows.filter((row) => row.side_volume_canonical_run_id === sideVolumeCanonicalRunId(tradeDate)).length,
        sector_rows: normalizedPoolRows.filter((row) => Boolean(row.sector_name)).length,
        industry_fast_injected_rows: normalizedPoolRows.filter((row) => row.industry_signal_fast_injected === true).length,
      },
      quote_read_rows: quoteBySymbol.size,
      quote_valid_rows: strategy3Consumer ? quoteValidRows : freshQuoteSymbols.length,
      quote_fresh_rows_120s: freshQuoteSymbols.length,
      quote_fresh_coverage_120s: Number(quoteCoverage.toFixed(4)),
      intraday_1m_fresh_rows_120s: freshPool1mRows,
      intraday_1m_fresh_coverage_120s: Number(pool1mFreshCoverage.toFixed(4)),
      market_event_rows_120s: marketEventRows.length,
      synchronized_market_event_rows_120s: synchronizedMarketEventRows.length,
      market_event_sync_coverage_120s: Number(marketEventSyncCoverage.toFixed(4)),
      no_new_market_event_rows: Math.max(0, poolBySymbol.size - marketEventRows.length),
      market_event_data_gap_rows: Math.max(0, marketEventRows.length - synchronizedMarketEventRows.length),
      intraday_1m_status_read_rows: intradayStatusBySymbol.size,
      intraday_1m_rpc_rows: candleRows.length,
      intraday_1m_valid_rows: strategy3Consumer ? intraday1mValidRows : candleRowsBySymbol.size,
      symbol_data_gap_rows: symbolDataGaps.size,
      symbol_data_gaps: [...symbolDataGaps.entries()].map(([symbol, reasons]) => ({ symbol, reasons })),
      global_formal_gate_blocked: false,
      receipt_incomplete: receiptIncomplete,
      runner_status: null,
      verifier_ok: null,
      receipt_written: false,
      evaluated_symbols: requestedEventSymbols.length,
      latest_quote_time: latestQuoteTime,
      latest_1m_time: latest1mTime,
      data_gap_count: uniqueFailures.filter((item) => item.includes("data_gap") || item.includes("not_ready") || item.includes("missing") || item.includes("empty")).length,
      event_evidence: [...evidenceBySymbol.values()],
      failed_checks: uniqueFailures,
      first_blocker: uniqueFailures[0] || null,
    };
    return { ok: uniqueFailures.length === 0, firstBlocker: receipt.first_blocker, failedChecks: uniqueFailures, receipt, poolBySymbol, quoteBySymbol, candleRowsBySymbol, evidenceBySymbol, symbolDataGaps };
  } catch (error) {
    const firstBlocker = failureFromError(error);
    return {
      ok: false,
      firstBlocker,
      failedChecks: [firstBlocker],
      receipt: { ...baseReceipt, status: "failed", complete: false, global_formal_gate_blocked: false, receipt_incomplete: firstBlocker !== "canonical_water_permission_denied", failed_checks: [firstBlocker], first_blocker: firstBlocker, error: String(error?.message || error) },
      ...emptyMaps,
    };
  }
}

module.exports = {
  readCanonicalDaytradeWater,
  canonicalRunId,
  taipeiDate,
  MOTHER_POOL_CONTRACT_VERSION,
  MOTHER_POOL_VIEW,
  MOTHER_POOL_RECEIPT_VIEW,
  QUOTE_TABLE,
  INTRADAY_1M_RPC,
};
