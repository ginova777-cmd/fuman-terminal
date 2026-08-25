"use strict";

const fs = require("fs");
const { spawnSync } = require("child_process");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const {
  ROOT,
  RUNTIME_DIR,
  CONTRACT_VERSION,
  STRATEGY,
  RESULTS_TABLE,
  RUNS_TABLE,
  LATEST_VIEW,
  ENTRY_WINDOW,
  taipeiDate,
  nowTaipeiIso,
  newRunId,
  readJson,
  writeJson,
  scanReceiptPath,
  failClosed,
} = require("./strategy3-v2-contract");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = tradeDate.replace(/\D/g, "");
const runId = newRunId(compactDate);
const apply = process.argv.includes("--apply");
const attemptPhase = process.argv.find((arg) => arg.startsWith("--attempt-phase="))?.slice("--attempt-phase=".length) || "";
const quoteCachePath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-quotes.json");
const candleCachePath = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-candles.json");
const MIN_LOCAL_COVERAGE_RATIO = Math.max(0.9, Number(process.env.STRATEGY3_V2_MIN_LOCAL_COVERAGE_RATIO || 0.9));

const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

async function supabaseRequest(method, table, query, body) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("supabase_credentials_missing");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`${method} ${table} HTTP ${response.status} ${text.slice(0, 300)}`);
  try { return JSON.parse(text || "null"); } catch { return null; }
}

async function applySupabaseRun(receipt) {
  const now = new Date().toISOString();
  const runRow = {
    run_id: receipt.run_id,
    trade_date: receipt.trade_date,
    strategy: STRATEGY,
    contract: CONTRACT_VERSION,
    status: "complete",
    complete: true,
    formal_allowed: true,
    publish_allowed: true,
    line_allowed: true,
    source_chain: {
      scanner_source: receipt.scanner_source,
      entry_window: receipt.entry_window,
      apply_source: "strategy3_v2_scanner_apply",
    },
    readiness: receipt.readiness?.payload || receipt.readiness || {},
    coverage: receipt.scanner_summary || {},
    issues: [],
    started_at: receipt.checked_at || now,
    finished_at: now,
  };
  await supabaseRequest("POST", RUNS_TABLE, "on_conflict=run_id", [runRow]);
  await supabaseRequest("DELETE", RESULTS_TABLE, `run_id=eq.${encodeURIComponent(receipt.run_id)}`);
  const rows = (receipt.results || []).map((row) => ({
    run_id: receipt.run_id,
    trade_date: receipt.trade_date,
    rank: row.rank,
    code: row.code,
    name: row.name || "",
    entry_price: row.entry_price,
    entry_price_source: row.entry_price_source || "intraday_1m",
    entry_window_start: "12:59",
    entry_window_end: "13:02",
    change_percent: row.change_percent,
    volume_ratio: row.volume_ratio || null,
    score: row.score,
    quality_status: "complete",
    complete: true,
    formal_allowed: true,
    payload: row,
  }));
  if (rows.length) await supabaseRequest("POST", RESULTS_TABLE, "", rows);
  return { ok: true, run_id: receipt.run_id, result_count: rows.length, tables: { runs: RUNS_TABLE, results: RESULTS_TABLE } };
}

function parseJson(text) {
  const raw = String(text || "");
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(raw.slice(first, last + 1)); } catch { return null; }
}

function runMarketGuard() {
  const child = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, "scripts", "check-market-calendar-action.js"), "--label=strategy3-v2-complete-scan", "--receipt"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, FUMAN_RUNTIME_DIR: RUNTIME_DIR },
  });
  const stdout = String(child.stdout || "");
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  let payload = null;
  if (first >= 0 && last > first) {
    try { payload = JSON.parse(stdout.slice(first, last + 1)); } catch {}
  }
  return { closed: child.status === 10, exitCode: child.status ?? 1, payload, stderr: String(child.stderr || "").trim() };
}

function runReadiness() {
  const child = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, "scripts", "check-strategy3-v2-readiness.js"), `--trade-date=${tradeDate}`], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 90000,
  });
  return {
    ok: child.status === 0,
    exitCode: child.status,
    payload: parseJson(child.stdout),
    stderr: String(child.stderr || "").trim(),
  };
}

function readCacheArray(file, key) {
  const payload = readJson(file, null);
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.[key]) ? payload[key] : [];
  return {
    ok: Array.isArray(rows),
    file,
    updated_at: payload?.updatedAt || "",
    count: rows.length,
    rows,
  };
}

function candleMinute(candle) {
  const parsed = Date.parse(candle?.candleTime || candle?.date || "");
  if (!Number.isFinite(parsed)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(parsed));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function buildScannerCoreResults() {
  const quoteCache = readCacheArray(quoteCachePath, "quotes");
  const candleCache = readCacheArray(candleCachePath, "candles");
  const quoteByCode = new Map();
  for (const quote of quoteCache.rows) {
    const code = String(quote.code || quote.symbol || "").replace(/\D/g, "").slice(0, 4);
    if (/^\d{4}$/.test(code)) quoteByCode.set(code, quote);
  }

  const candlesByCode = new Map();
  for (const candle of candleCache.rows) {
    if (String(candle.tradeDate || "").slice(0, 10) !== tradeDate) continue;
    const code = String(candle.code || candle.symbol || "").replace(/\D/g, "").slice(0, 4);
    if (!/^\d{4}$/.test(code)) continue;
    if (!candlesByCode.has(code)) candlesByCode.set(code, []);
    candlesByCode.get(code).push(candle);
  }

  const candidates = [];
  let ready20Count = 0;
  let entryWindowCount = 0;

  for (const [code, candles] of candlesByCode.entries()) {
    candles.sort((a, b) => Date.parse(a.candleTime || "") - Date.parse(b.candleTime || ""));
    const count = candles.length;
    if (count >= 20) ready20Count += 1;
    const entryCandles = candles.filter((candle) => {
      const minute = candleMinute(candle);
      return minute !== null && minute >= 12 * 60 + 59 && minute <= 13 * 60 + 2;
    });
    if (entryCandles.length) entryWindowCount += 1;
    if (count < 20 || !entryCandles.length) continue;

    const quote = quoteByCode.get(code) || {};
    const entry = entryCandles[0];
    const last = candles[candles.length - 1] || {};
    const entryPrice = Number(entry.close || entry.average || 0);
    const closePrice = Number(quote.close || last.close || 0);
    const prevClose = Number(quote.prevClose || 0);
    const changePercent = Number.isFinite(Number(quote.percent))
      ? Number(quote.percent)
      : prevClose > 0 && closePrice > 0
        ? ((closePrice - prevClose) / prevClose) * 100
        : 0;
    const totalVolume = candles.reduce((sum, candle) => sum + Number(candle.volume || 0), 0);
    const tailVolume = candles
      .filter((candle) => {
        const minute = candleMinute(candle);
        return minute !== null && minute >= 12 * 60 + 45;
      })
      .reduce((sum, candle) => sum + Number(candle.volume || 0), 0);
    const entryTrendPct = entryPrice > 0 ? ((closePrice - entryPrice) / entryPrice) * 100 : 0;
    if (!(changePercent >= 2 && closePrice >= entryPrice && totalVolume > 0)) continue;

    const tailShare = totalVolume > 0 ? (tailVolume / totalVolume) * 100 : 0;
    const fullSessionBonus = count >= 200 ? 8 : count >= 100 ? 4 : 0;
    const score = Math.max(1, Math.min(100, Math.round(
      50
      + Math.min(28, changePercent * 4)
      + Math.min(18, tailShare)
      + Math.max(0, Math.min(10, entryTrendPct * 2))
      + fullSessionBonus
    )));

    candidates.push({
      rank: 0,
      code,
      symbol: code,
      name: quote.name || "",
      strategy: STRATEGY,
      signal_type: "overnight_chip_reference_v2",
      entry_price: round(entryPrice, 2),
      entry_price_source: "local_fugle_daytrade_ws_candles_1259_1302",
      entry_candle_time: entry.candleTime || "",
      close_price: round(closePrice, 2),
      change_percent: round(changePercent, 2),
      score,
      candle_count: count,
      first_candle_time: candles[0]?.candleTime || "",
      last_candle_time: last.candleTime || "",
      tail_volume: round(tailVolume, 0),
      total_1m_volume: round(totalVolume, 0),
      tail_volume_share_pct: round(tailShare, 2),
      entry_to_close_pct: round(entryTrendPct, 2),
      stop_price: round(entryPrice * 0.97, 2),
      conservative_target_price: round(entryPrice * 1.06, 2),
      aggressive_target_price: round(entryPrice * 1.10, 2),
      reason_codes: [
        "strategy3_v2_same_day_1m_ready",
        "strategy3_v2_1300_entry_window_present",
        "strategy3_v2_close_above_entry",
        "strategy3_v2_positive_quote_change",
      ],
      formal_source: "local_fugle_daytrade_ws_candles+local_fugle_daytrade_ws_quotes",
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.change_percent - a.change_percent || b.tail_volume_share_pct - a.tail_volume_share_pct);
  candidates.forEach((item, index) => { item.rank = index + 1; });
  return {
    quote_cache: { file: quoteCache.file, updated_at: quoteCache.updated_at, count: quoteCache.count },
    candle_cache: { file: candleCache.file, updated_at: candleCache.updated_at, count: candleCache.count },
    same_day_candle_symbols: candlesByCode.size,
    local_ready_20_candle_symbols: ready20Count,
    local_entry_window_symbols: entryWindowCount,
    results: candidates,
  };
}

async function main() {
  const market = runMarketGuard();
  if (market.closed) {
    const receipt = {
      ok: true,
      strategy: STRATEGY,
      contract: CONTRACT_VERSION,
      status: "SKIPPED_MARKET_CLOSED",
      checked_at: nowTaipeiIso(),
      trade_date: tradeDate,
      run_id: `strategy3v2-market-closed-${compactDate}`,
      apply,
      scanner_core_ready: false,
      scanner_source: "market_calendar_guard",
      scanner_summary: { result_count: 0 },
      readiness: { ok: true, skipped: true, reason_code: "market_closed_preserve_previous_good" },
      entry_window: ENTRY_WINDOW,
      result_count: 0,
      results: [],
      line_allowed: false,
      formal_allowed: false,
      publish_allowed: false,
      marketCalendar: market.payload,
      reason_code: "market_closed_preserve_previous_good",
      previous_good_preserved: true,
    };
    const file = writeJson(scanReceiptPath(compactDate), receipt);
    console.log(JSON.stringify({ ...receipt, receipt_path: file }, null, 2));
    return;
  }
  if (market.exitCode !== 0) throw new Error(`strategy3_v2_market_calendar_guard_failed exit=${market.exitCode} ${market.stderr}`);
  const readiness = runReadiness();
  if (attemptPhase === "1255") {
    const attemptReceipt = {
      ok: false,
      strategy: STRATEGY,
      contract: CONTRACT_VERSION,
      status: "PREOPEN_ATTEMPT_FAIL_CLOSED",
      checked_at: nowTaipeiIso(),
      trade_date: tradeDate,
      run_id: "strategy3v2-1255-attempt-" + compactDate,
      attempt_phase: "1255",
      apply: false,
      formal_allowed: false,
      publish_allowed: false,
      line_allowed: false,
      line_push_allowed: false,
      readiness,
      reason_code: "strategy3_v2_1255_preopen_attempt_requires_1300_retry",
      allowed_action: "retry_strategy3_v2_complete_scan_at_1300_only",
      result_count: 0,
      results: [],
    };
    const attemptFile = path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy3-v2-complete-scan-attempt-1255-" + compactDate + ".json");
    const file = writeJson(attemptFile, attemptReceipt);
    console.log(JSON.stringify({ ...attemptReceipt, receipt_path: file }, null, 2));
    process.exitCode = 1;
    return;
  }
  const issues = [];
  const scanner = buildScannerCoreResults();
  const formalReadyTarget = Number(readiness.payload?.mother_pool?.minimumReadySymbols || readiness.payload?.minimums?.motherPoolReadySymbols || 1000);
  const localCoverageRatio = formalReadyTarget > 0 ? scanner.local_ready_20_candle_symbols / formalReadyTarget : 0;
  const localCoverageOk = localCoverageRatio >= MIN_LOCAL_COVERAGE_RATIO;
  const scannerCoreReady = scanner.results.length > 0 && localCoverageOk;
  const readinessOk = readiness.ok && readiness.payload?.ok === true;
  if (!readinessOk && !scannerCoreReady) {
    issues.push("readiness_not_ready");
  }
  if (!localCoverageOk) issues.push("strategy3_v2_local_1m_coverage_below_90_percent");
  if (!scanner.results.length) issues.push("strategy3_v2_no_candidates_from_local_formal_cache");

  const receipt = issues.length
    ? failClosed("strategy3_v2_core_not_ready", {
        checked_at: nowTaipeiIso(),
        trade_date: tradeDate,
        run_id: runId,
        apply,
        readiness,
        scanner_core_ready: scannerCoreReady,
        scanner_source: "local_fugle_daytrade_ws_candles+local_fugle_daytrade_ws_quotes",
        scanner_summary: {
          same_day_candle_symbols: scanner.same_day_candle_symbols,
          local_ready_20_candle_symbols: scanner.local_ready_20_candle_symbols,
          local_entry_window_symbols: scanner.local_entry_window_symbols,
          formal_ready_target: formalReadyTarget,
          local_coverage_ratio: round(localCoverageRatio, 4),
          min_local_coverage_ratio: MIN_LOCAL_COVERAGE_RATIO,
          tolerance_policy: "overnight_strategy3_v2_allows_90_percent_local_1m_backtest_coverage",
          result_count: scanner.results.length,
          quote_cache: scanner.quote_cache,
          candle_cache: scanner.candle_cache,
        },
        result_tables: { results: RESULTS_TABLE, runs: RUNS_TABLE, latestView: LATEST_VIEW },
        entry_window: ENTRY_WINDOW,
        issues,
        allowed_action: "inspect_local_fugle_formal_cache_then_rerun_strategy3_v2_scan",
      })
    : {
        ok: true,
        strategy: STRATEGY,
        contract: CONTRACT_VERSION,
        status: "COMPLETE",
        checked_at: nowTaipeiIso(),
        trade_date: tradeDate,
        run_id: runId,
        apply,
        scanner_core_ready: true,
        scanner_source: "local_fugle_daytrade_ws_candles+local_fugle_daytrade_ws_quotes",
        scanner_summary: {
          same_day_candle_symbols: scanner.same_day_candle_symbols,
          local_ready_20_candle_symbols: scanner.local_ready_20_candle_symbols,
          local_entry_window_symbols: scanner.local_entry_window_symbols,
          formal_ready_target: formalReadyTarget,
          local_coverage_ratio: round(localCoverageRatio, 4),
          min_local_coverage_ratio: MIN_LOCAL_COVERAGE_RATIO,
          tolerance_policy: "overnight_strategy3_v2_allows_90_percent_local_1m_backtest_coverage",
          result_count: scanner.results.length,
          quote_cache: scanner.quote_cache,
          candle_cache: scanner.candle_cache,
        },
        readiness,
        entry_window: ENTRY_WINDOW,
        result_count: scanner.results.length,
        results: scanner.results,
        line_allowed: true,
        formal_allowed: true,
        publish_allowed: true,
      };

  if (apply && receipt.ok) {
    try {
      receipt.supabase_apply = await applySupabaseRun(receipt);
    } catch (error) {
      receipt.ok = false;
      receipt.status = "FAIL_CLOSED";
      receipt.reason_code = "strategy3_v2_supabase_apply_failed";
      receipt.publish_allowed = false;
      receipt.formal_allowed = false;
      receipt.line_allowed = false;
      receipt.supabase_apply = { ok: false, error: String(error?.message || error).slice(0, 600) };
    }
  }
  const file = writeJson(scanReceiptPath(compactDate), receipt);
  console.log(JSON.stringify({ ...receipt, receipt_path: file }, null, 2));
  process.exitCode = receipt.ok ? 0 : 1;
}

main().catch((error) => { console.error(error); process.exit(1); });