const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-water-root");
const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR }).replace(/\/+$/, "");
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const TIMEOUT_MS = Math.max(1000, Number(process.env.FUMAN_WATER_ROOT_TIMEOUT_MS || "3000") || 3000);
const EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      json,
      text: text.slice(0, 240),
      error: response.ok ? "" : text.slice(0, 240),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      json: null,
      text: "",
      error: error.name === "AbortError" ? `timeout_after_${options.timeoutMs || TIMEOUT_MS}ms` : String(error.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function restUrl(pathname, params = {}) {
  const url = new URL(`/rest/v1/${pathname.replace(/^\/+/, "")}`, SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function query(name, pathname, params = {}, options = {}) {
  const result = await timedFetch(restUrl(pathname, params), { timeoutMs: options.timeoutMs || TIMEOUT_MS });
  const rows = Array.isArray(result.json) ? result.json : [];
  const row = rows[0] || null;
  return {
    name,
    url: restUrl(pathname, params).replace(SUPABASE_URL, ""),
    ok: result.ok,
    status: result.status,
    elapsedMs: result.elapsedMs,
    rowCount: rows.length,
    row,
    error: result.error,
    maxElapsedMs: options.timeoutMs || TIMEOUT_MS,
  };
}

async function marketCalendar() {
  const url = new URL("/api/market-calendar", BASE_URL);
  url.searchParams.set("t", String(Date.now()));
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { cache: "no-store" });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return {
      name: "market_calendar",
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      row: json,
      error: response.ok ? "" : text.slice(0, 240),
    };
  } catch (error) {
    return {
      name: "market_calendar",
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      row: null,
      error: String(error.message || error),
    };
  }
}

function sourceStatusSummary(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    status: String(row.status || row.source_status || payload.status || ""),
    updatedAt: row.updated_at || row.checked_at || payload.updated_at || "",
    daytradeGateGrade: String(payload.daytrade_gate_grade || payload.gate_grade || row.daytrade_gate_grade || row.gate_grade || ""),
    formalEntryAllowed: payload.formal_entry_allowed === true || row.formal_entry_allowed === true,
    scannerCanRunOpening: payload.scanner_can_run_opening === true || row.scanner_can_run_opening === true,
    priorityFreshQuoteCoverage120s: asNumber(payload.priority_fresh_quote_coverage_120s ?? row.priority_fresh_quote_coverage_120s),
    quoteAgeSeconds: asNumber(payload.quote_age_seconds ?? row.quote_age_seconds, 999999),
    intraday1mStaleSeconds: asNumber(payload.intraday_1m_stale_seconds ?? row.intraday_1m_stale_seconds, 999999),
    dailyVolumeStatus: String(payload.daily_volume_status || row.daily_volume_status || ""),
    phase: String(payload.phase || row.phase || ""),
    message: String(row.message || payload.message || ""),
  };
}

function gateSummary(row = {}) {
  return {
    canonicalGateGrade: String(row.canonical_gate_grade || row.gate_grade || row.gate || ""),
    canonicalGateStatus: String(row.canonical_gate_status || row.gate_status || row.status || ""),
    reason: String(row.reason || ""),
    phase: String(row.phase || ""),
    formalEntrySpeedVerdict: String(row.formal_entry_speed_verdict || ""),
    formalEntryAllowed: row.formal_entry_allowed === true,
    priorityFreshQuoteCoverage120s: asNumber(row.priority_fresh_quote_coverage_120s),
    quoteAgeSeconds: asNumber(row.quote_age_seconds, 999999),
    scannerCanRunOpening: row.scanner_can_run_opening === true,
  };
}

function isMarketClosedPreviousGood(payload) {
  const calendar = payload.marketCalendar?.row || {};
  const source = payload.sourceStatus?.summary || {};
  const gate = payload.canonicalGate?.summary || {};
  const sourceStatus = String(source.status || "").toLowerCase();
  const sourcePhase = String(source.phase || "").toLowerCase();
  const gatePhase = String(gate.phase || "").toLowerCase();
  const message = `${source.message || ""} ${gate.reason || ""}`.toLowerCase();
  return Boolean(
    calendar.marketOpen === false
    && (calendar.sourceFreshnessRequired === false || calendar.formalScanSkipped === true || calendar.displayMode === "market_closed_previous_good")
    && (sourceStatus === "stopped" || sourcePhase.includes("after") || gatePhase.includes("after") || message.includes("off-session"))
  );
}
function statusIssues(payload) {
  const issues = [];
  const required = payload.required;
  const source = payload.sourceStatus.summary;
  const gate = payload.canonicalGate.summary;
  const intraday = payload.intraday1m.row || {};
  const daily = payload.dailyVolume.row || {};
  const motherRows = payload.motherPool.rowCount;
  const priorityRows = payload.priorityTop40.rowCount;

  for (const item of payload.probes) {
    if (!item.ok) issues.push(`${item.name}_not_readable:${item.status || item.error}`);
    if (item.elapsedMs > item.maxElapsedMs) issues.push(`${item.name}_slow:${item.elapsedMs}ms`);
  }
  if (required.tradingDay && payload.marketCalendar.ok && payload.marketCalendar.row?.isTradingDay === false) {
    issues.push("market_calendar_not_trading_day");
  }
  if (isMarketClosedPreviousGood(payload) && !required.tradingDay && !required.formalNow) {
    return issues;
  }
  if (!["ok", "ready"].includes(source.status)) issues.push(`source_status_not_ready:${source.status || "missing"}`);
  if (source.priorityFreshQuoteCoverage120s < required.priorityCoverage) {
    issues.push(`priority_quote_coverage_low:${source.priorityFreshQuoteCoverage120s}`);
  }
  if (source.quoteAgeSeconds > required.quoteAgeSeconds) issues.push(`quote_age_too_old:${source.quoteAgeSeconds}`);
  if (source.intraday1mStaleSeconds > required.intraday1mStaleSeconds) {
    issues.push(`intraday_1m_stale:${source.intraday1mStaleSeconds}`);
  }
  if (required.dailyVolume && !["ready", "ok"].includes(String(source.dailyVolumeStatus || daily.status || "").toLowerCase())) {
    issues.push(`daily_volume_not_ready:${source.dailyVolumeStatus || daily.status || "missing"}`);
  }
  if (motherRows < required.motherPoolRows) issues.push(`mother_pool_rows_low:${motherRows}`);
  if (priorityRows < required.priorityTop40Rows) issues.push(`priority_top40_rows_low:${priorityRows}`);
  if (required.formalNow) {
    if (gate.canonicalGateGrade !== "A") issues.push(`canonical_gate_not_A:${gate.canonicalGateGrade || "missing"}`);
    if (!["ready", "ok"].includes(gate.canonicalGateStatus)) issues.push(`canonical_gate_not_ready:${gate.canonicalGateStatus || "missing"}`);
    if (gate.formalEntrySpeedVerdict !== "YES") issues.push(`formal_entry_speed_not_yes:${gate.formalEntrySpeedVerdict || "missing"}`);
    if (gate.formalEntryAllowed !== true) issues.push("formal_entry_allowed_false");
    if (gate.scannerCanRunOpening !== true) issues.push("scanner_can_run_opening_false");
  }
  if (intraday.today_candle_count !== undefined && asNumber(intraday.today_candle_count) <= 0) {
    issues.push("intraday_1m_today_candle_count_zero");
  }
  return issues;
}

function markdown(payload) {
  const lines = [];
  lines.push("# Terminal Water Root");
  lines.push("");
  lines.push(`- checkedAt: ${payload.checkedAt}`);
  lines.push(`- expectedDate: ${payload.expectedDate}`);
  lines.push(`- ok: ${payload.ok}`);
  lines.push(`- status: ${payload.status}`);
  lines.push(`- reason: ${payload.reason}`);
  lines.push("");
  lines.push("| probe | HTTP | elapsed | rows | key evidence |");
  lines.push("|---|---:|---:|---:|---|");
  for (const probe of payload.probes) {
    const row = probe.row || {};
    const evidence = probe.name === "source_status"
      ? `status=${payload.sourceStatus.summary.status}; coverage=${payload.sourceStatus.summary.priorityFreshQuoteCoverage120s}; quoteAge=${payload.sourceStatus.summary.quoteAgeSeconds}`
      : probe.name === "canonical_gate"
        ? `grade=${payload.canonicalGate.summary.canonicalGateGrade}; status=${payload.canonicalGate.summary.canonicalGateStatus}; verdict=${payload.canonicalGate.summary.formalEntrySpeedVerdict}`
        : `updated=${row.updated_at || row.checked_at || row.latest_candle_time || row.trade_date || "--"}`;
    lines.push(`| ${probe.name} | ${probe.status} | ${probe.elapsedMs}ms | ${probe.rowCount} | ${evidence} |`);
  }
  if (payload.issues.length) {
    lines.push("");
    lines.push("## Issues");
    for (const issue of payload.issues) lines.push(`- ${issue}`);
  }
  return lines.join("\n");
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const required = {
    tradingDay: process.argv.includes("--require-trading-day"),
    formalNow: process.argv.includes("--require-formal-now"),
    priorityCoverage: asNumber(process.env.FUMAN_WATER_ROOT_PRIORITY_COVERAGE || "0.95", 0.95),
    quoteAgeSeconds: asNumber(process.env.FUMAN_WATER_ROOT_QUOTE_AGE_SECONDS || "90", 90),
    intraday1mStaleSeconds: asNumber(process.env.FUMAN_WATER_ROOT_1M_STALE_SECONDS || "120", 120),
    dailyVolume: true,
    motherPoolRows: asNumber(process.env.FUMAN_WATER_ROOT_MOTHER_POOL_ROWS || "1", 1),
    priorityTop40Rows: asNumber(process.env.FUMAN_WATER_ROOT_PRIORITY_TOP40_ROWS || "1", 1),
  };
  const [
    calendar,
    sourceStatus,
    canonicalGate,
    motherPool,
    priorityTop40,
    intraday1m,
    dailyVolume,
  ] = await Promise.all([
    marketCalendar(),
    query("source_status", "source_status", {
      select: "source_name,status,message,payload,updated_at",
      source_name: "eq.fugle_daytrade_source",
      limit: "1",
    }),
    query("canonical_gate", "v_fugle_daytrade_canonical_gate", {
      select: "*",
      limit: "1",
    }),
    query("mother_pool", "v_fugle_daytrade_mother_pool", {
      select: "symbol,trade_date,updated_at",
      limit: "1",
    }),
    query("priority_top40", "v_fugle_daytrade_priority_top40", {
      select: "symbol,trade_date,updated_at",
      limit: "1",
    }),
    query("intraday_1m_status", "v_fugle_daytrade_intraday_1m_status", {
      select: "*",
      limit: "1",
    }),
    query("daily_volume", "fugle_daytrade_daily_volume_avg", {
      select: "symbol,trade_date,updated_at",
      limit: "1",
    }),
  ]);
  const probes = [sourceStatus, canonicalGate, motherPool, priorityTop40, intraday1m, dailyVolume];
  const payload = {
    checkedAt: new Date().toISOString(),
    expectedDate: EXPECTED_DATE,
    baseUrl: BASE_URL,
    supabaseProject: SUPABASE_URL,
    required,
    marketCalendar: calendar,
    probes,
    sourceStatus: { ...sourceStatus, summary: sourceStatusSummary(sourceStatus.row || {}) },
    canonicalGate: { ...canonicalGate, summary: gateSummary(canonicalGate.row || {}) },
    motherPool,
    priorityTop40,
    intraday1m,
    dailyVolume,
  };
  payload.marketClosedPreviousGood = isMarketClosedPreviousGood(payload);
  payload.issues = statusIssues(payload);
  payload.ok = payload.issues.length === 0;
  payload.status = payload.ok ? (payload.marketClosedPreviousGood ? "market_closed_previous_good" : "ready") : "blocked";
  payload.reason = payload.ok
    ? (payload.marketClosedPreviousGood ? "market_closed_formal_scan_skipped_preserve_previous_good" : "terminal_water_root_ready")
    : payload.issues[0];

  const jsonFile = path.join(OUT_DIR, "terminal-water-root.json");
  const mdFile = path.join(OUT_DIR, "terminal-water-root.md");
  await fs.promises.writeFile(jsonFile, JSON.stringify(payload, null, 2));
  await fs.promises.writeFile(mdFile, markdown(payload));
  console.log(JSON.stringify({
    ok: payload.ok,
    status: payload.status,
    reason: payload.reason,
    expectedDate: payload.expectedDate,
    sourceStatus: payload.sourceStatus.summary.status,
    gate: payload.canonicalGate.summary.canonicalGateGrade,
    priorityFreshQuoteCoverage120s: payload.sourceStatus.summary.priorityFreshQuoteCoverage120s,
    quoteAgeSeconds: payload.sourceStatus.summary.quoteAgeSeconds,
    intraday1mStaleSeconds: payload.sourceStatus.summary.intraday1mStaleSeconds,
    output: jsonFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[terminal-water-root] failed: ${error.stack || error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  asNumber,
  compactDate,
  sourceStatusSummary,
  gateSummary,
  isMarketClosedPreviousGood,
  statusIssues,
};

