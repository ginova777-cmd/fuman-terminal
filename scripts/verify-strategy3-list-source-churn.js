"use strict";

const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = require("path").resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }).replace(/\/+$/, "");
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });
const RUNS_TABLE = process.env.STRATEGY3_SUPABASE_RUNS_TABLE || "strategy3_scan_runs";
const RESULTS_TABLE = process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results";
const LATEST_RUN_VIEW = process.env.STRATEGY3_SUPABASE_LATEST_RUN_VIEW || "v_strategy3_latest_complete_run";
const MIN_FULL_SCAN_TOTAL = Number(process.env.STRATEGY3_MIN_FULL_SCAN_TOTAL || 1000);
const MIN_NEW_SYMBOLS = Number(process.env.STRATEGY3_MIN_CHURN_NEW_SYMBOLS || 1);
const MIN_CHURN_RATIO = Number(process.env.STRATEGY3_MIN_CHURN_RATIO || 0.01);

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function dashDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : "";
}

function runIdDate(value) {
  const match = String(value || "").match(/strategy3-(\d{8})/i);
  return match ? match[1] : "";
}

async function rest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("missing_supabase_credentials");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 30000);
  try {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    };
    if (options.count) headers.Prefer = "count=exact";
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 260)}`);
    const range = response.headers.get("content-range") || "";
    const exactCount = range.includes("/") ? Number(range.split("/").pop()) : null;
    return { rows: text ? JSON.parse(text) : [], exactCount };
  } finally {
    clearTimeout(timer);
  }
}

async function readLatestRun() {
  const select = encodeURIComponent("run_id,scan_date,status,expected_total,scanned_count,result_count,complete,quality_status,source,updated_at,payload");
  const latest = await rest(`${LATEST_RUN_VIEW}?select=${select}&limit=1`);
  const row = Array.isArray(latest.rows) ? latest.rows[0] : null;
  if (!row?.run_id) throw new Error("strategy3_latest_complete_run_missing");
  const runRows = await rest(`${RUNS_TABLE}?select=${select}&run_id=eq.${encodeURIComponent(row.run_id)}&limit=1`);
  return runRows.rows?.[0] || row;
}

async function readRecentRuns(limit = 8) {
  const select = encodeURIComponent("run_id,scan_date,status,expected_total,scanned_count,result_count,complete,quality_status,source,updated_at,payload");
  const result = await rest(`${RUNS_TABLE}?select=${select}&strategy=eq.strategy3&status=eq.complete&complete=eq.true&order=updated_at.desc&limit=${limit}`);
  return Array.isArray(result.rows) ? result.rows : [];
}

async function readResults(runId, expected = 500) {
  const select = encodeURIComponent("run_id,scan_date,rank,code,name,price,close,payload,updated_at");
  const result = await rest(`${RESULTS_TABLE}?select=${select}&run_id=eq.${encodeURIComponent(runId)}&strategy=eq.strategy3&order=rank.asc&limit=${Math.max(1, expected)}`, { count: true });
  return {
    exactCount: cleanNumber(result.exactCount ?? result.rows?.length),
    rows: (result.rows || []).map((row, index) => {
      const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
      return {
        rank: cleanNumber(row.rank || payload.rank || index + 1),
        code: normalizeCode(row.code || payload.code || payload.symbol),
        name: String(payload.name || payload.displayName || row.name || "").replace(/🔥/g, "").trim(),
        price: cleanNumber(payload.entryPrice ?? payload.entry_price ?? row.price ?? row.close),
        entryPriceSource: String(payload.entryPriceSource || payload.entry_price_source || "").trim(),
        entryTradeDate: String(payload.entryTradeDate || payload.entry_trade_date || "").slice(0, 10),
        entryCandleTime: String(payload.entryCandleTime || payload.entry_candle_time || ""),
        entryMinute: cleanNumber(payload.entryMinute),
      };
    }).filter((row) => /^\d{4}$/.test(row.code)),
  };
}

function runPayload(row = {}) {
  return row.payload && typeof row.payload === "object" ? row.payload : {};
}

function isCanonicalRepair(row = {}) {
  const payload = runPayload(row);
  return /canonical-entry1m|canonical_entry1m|canonical repair|canonical_repair/i.test([
    row.run_id,
    row.source,
    payload.source,
    payload.canonicalRepair?.source,
  ].filter(Boolean).join(" "));
}

function isPreviousGood(row = {}) {
  const payload = runPayload(row);
  const quality = payload.run_quality_at_publish || {};
  const text = [
    row.source,
    row.quality_status,
    payload.source,
    payload.cacheSource,
    payload.displayMode,
    payload.blockedReason,
    payload.scanner_block_reason,
    payload.reason,
  ].filter(Boolean).join(" ");
  return payload.preservePreviousGood === true
    || quality.preservePreviousGood === true
    || payload.fallbackUsed === true
    || /previous_good|preserve_previous_good|fallback/i.test(text);
}

function summarizeRun(row = {}) {
  const payload = runPayload(row);
  return {
    runId: row.run_id || payload.runId || "",
    scanDate: row.scan_date || dashDate(payload.usedDate || payload.scanDate || ""),
    status: row.status || "",
    complete: row.complete === true,
    expectedTotal: cleanNumber(row.expected_total ?? payload.expectedTotal ?? payload.total),
    scannedCount: cleanNumber(row.scanned_count ?? payload.scannedCount ?? payload.total),
    resultCount: cleanNumber(row.result_count ?? payload.count),
    qualityStatus: row.quality_status || payload.qualityStatus || "",
    source: row.source || payload.source || "",
    updatedAt: row.updated_at || payload.updatedAt || "",
    canonicalRepair: isCanonicalRepair(row),
    previousGood: isPreviousGood(row),
    candidateLimitApplied: payload.scanCoverage?.candidateLimitApplied === true,
    suppressedSymbols: payload.canonicalRepair?.suppressedSymbols || payload.entryPriceGuard?.suppressedSymbols || payload.sourceCoverage?.strategy3Entry1mMissingSymbols || [],
  };
}

function churn(currentRows = [], previousRows = []) {
  const currentSet = new Set(currentRows.map((row) => row.code));
  const previousSet = new Set(previousRows.map((row) => row.code));
  const added = [...currentSet].filter((code) => !previousSet.has(code)).sort();
  const removed = [...previousSet].filter((code) => !currentSet.has(code)).sort();
  const overlap = [...currentSet].filter((code) => previousSet.has(code)).length;
  const denominator = Math.max(1, currentSet.size);
  return {
    currentCount: currentSet.size,
    previousCount: previousSet.size,
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    overlap,
    overlapRatio: Math.round((overlap / denominator) * 10000) / 10000,
    churnRatio: Math.round(((added.length + removed.length) / Math.max(1, currentSet.size + previousSet.size)) * 10000) / 10000,
  };
}

function entryMinute(value) {
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}
function validEntrySource(source) {
  return ["intraday_1m_1300", "intraday_1m_1300_exact", "intraday_1m_entry_window_tolerance"].includes(String(source || "").trim());
}
function validEntryMinute(row = {}) {
  const minute = cleanNumber(row.entryMinute) || entryMinute(row.entryCandleTime);
  return minute >= 12 * 60 + 59 && minute <= 13 * 60 + 2;
}

function reasonCode(issues = []) {
  if (issues.some((issue) => issue.includes("canonical_repair"))) return "strategy3_canonical_repair_not_fresh_full_scan";
  if (issues.some((issue) => issue.includes("previous_good"))) return "strategy3_previous_good_or_fallback";
  if (issues.some((issue) => issue.includes("full_scan_not_proven"))) return "strategy3_full_scan_not_proven";
  if (issues.some((issue) => issue.includes("no_new_symbols"))) return "strategy3_previous_good_or_no_churn";
  if (issues.some((issue) => issue.includes("entry_evidence"))) return "strategy3_entry_evidence_incomplete";
  return issues[0] || "";
}

async function main() {
  const today = taipeiDateKey();
  const todayDash = dashDate(today);
  const latest = await readLatestRun();
  const recentRuns = await readRecentRuns(8);
  const latestSummary = summarizeRun(latest);
  const current = await readResults(latestSummary.runId, Math.max(500, latestSummary.resultCount + 10));
  const previousRun = recentRuns.find((row) => row.run_id && row.run_id !== latestSummary.runId) || null;
  const previousSummary = previousRun ? summarizeRun(previousRun) : null;
  const previous = previousSummary ? await readResults(previousSummary.runId, Math.max(500, previousSummary.resultCount + 10)) : { rows: [], exactCount: 0 };
  const churnSummary = previousSummary ? churn(current.rows, previous.rows) : null;

  const issues = [];
  const warnings = [];

  if (latestSummary.scanDate !== todayDash) issues.push(`trade_date_not_today:${latestSummary.scanDate || "missing"}!=${todayDash}`);
  if (runIdDate(latestSummary.runId) !== today) issues.push(`runId_date_not_today:${runIdDate(latestSummary.runId) || "missing"}!=${today}`);
  if (!latestSummary.complete || latestSummary.status !== "complete") issues.push(`latest_run_not_complete:${latestSummary.status || "missing"}`);
  if (latestSummary.canonicalRepair) issues.push("latest_run_is_canonical_repair_not_fresh_full_scan");
  if (latestSummary.previousGood) issues.push("latest_run_is_previous_good_or_fallback");
  if (latestSummary.expectedTotal < MIN_FULL_SCAN_TOTAL || latestSummary.scannedCount < MIN_FULL_SCAN_TOTAL || latestSummary.expectedTotal !== latestSummary.scannedCount) {
    issues.push(`full_scan_not_proven:expected=${latestSummary.expectedTotal};scanned=${latestSummary.scannedCount};min=${MIN_FULL_SCAN_TOTAL}`);
  }
  if (current.exactCount !== latestSummary.resultCount || current.rows.length !== latestSummary.resultCount) {
    issues.push(`result_readback_mismatch:rows=${current.rows.length};exact=${current.exactCount};run=${latestSummary.resultCount}`);
  }
  const badEntryRows = current.rows
    .filter((row) => !validEntrySource(row.entryPriceSource) || !row.entryTradeDate || !validEntryMinute(row) || !(row.price > 0))
    .slice(0, 20);
  if (badEntryRows.length) {
    issues.push(`entry_evidence_incomplete:${badEntryRows.map((row) => `${row.code}:${row.entryPriceSource || "missing"}:${row.entryTradeDate || "missing"}:${row.entryCandleTime || "missing"}:${row.price}`).join(",")}`);
  }
  if (!previousSummary) {
    warnings.push("previous_run_missing_churn_not_computed");
  } else {
    const previousFreshFullScan = previousSummary.complete
      && !previousSummary.canonicalRepair
      && !previousSummary.previousGood
      && previousSummary.expectedTotal >= MIN_FULL_SCAN_TOTAL
      && previousSummary.expectedTotal === previousSummary.scannedCount;
    const sameDayFreshRerun = previousFreshFullScan && previousSummary.scanDate === latestSummary.scanDate;
    const anySymbolChange = churnSummary.addedCount > 0 || churnSummary.removedCount > 0;
    if (churnSummary.addedCount < MIN_NEW_SYMBOLS) {
      const message = `no_new_symbols_vs_previous_run:added=${churnSummary.addedCount};min=${MIN_NEW_SYMBOLS};previousRunId=${previousSummary.runId}`;
      if (sameDayFreshRerun && anySymbolChange) warnings.push(message);
      else issues.push(message);
    }
    if (churnSummary.churnRatio < MIN_CHURN_RATIO) {
      const message = `churn_ratio_too_low:${churnSummary.churnRatio};min=${MIN_CHURN_RATIO};previousRunId=${previousSummary.runId}`;
      if (sameDayFreshRerun && anySymbolChange) warnings.push(message);
      else issues.push(message);
    }
  }
  if (latestSummary.suppressedSymbols.length) {
    warnings.push(`suppressed_symbols_without_entry_evidence:${latestSummary.suppressedSymbols.join(",")}`);
  }
  if (latestSummary.candidateLimitApplied) issues.push("candidate_limit_applied_not_full_scan");

  const output = {
    ok: issues.length === 0,
    verifier: "verify-strategy3-list-source-churn",
    checkedAt: new Date().toISOString(),
    readOnly: true,
    targetDate: todayDash,
    reason_code: reasonCode(issues),
    first_blocker: issues[0] || "",
    latest: latestSummary,
    currentRows: {
      count: current.rows.length,
      exactCount: current.exactCount,
      sample: current.rows.slice(0, 12).map((row) => ({ rank: row.rank, code: row.code, name: row.name, price: row.price })),
    },
    previous: previousSummary ? {
      ...previousSummary,
      resultRows: previous.rows.length,
    } : null,
    churn: churnSummary,
    suppressedSymbols: latestSummary.suppressedSymbols,
    issues,
    warnings,
    allowed_action: issues.length
      ? "fix_strategy3_full_scanner_hang_then_rerun_full_scan_and_reverify_churn"
      : "allow_strategy3_list_as_fresh_full_scan",
  };

  console.log(JSON.stringify(output, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    verifier: "verify-strategy3-list-source-churn",
    checkedAt: new Date().toISOString(),
    readOnly: true,
    error: error?.message || String(error),
  }, null, 2));
  process.exit(1);
});
