"use strict";

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
  MOTHER_POOL_CONTRACT_VERSION,
  MOTHER_POOL_VIEW,
  MOTHER_POOL_RECEIPT_VIEW,
  QUOTE_TABLE,
  INTRADAY_1M_RPC,
  MIN_MOTHER_POOL_COVERAGE_RATIO,
  taipeiDate,
  nowTaipeiIso,
  newRunId,
  writeJson,
  scanReceiptPath,
  failClosed,
} = require("./strategy3-v2-contract");
const { readCanonicalDaytradeWater } = require("../lib/daytrade-canonical-water-reader");

const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = tradeDate.replace(/\D/g, "");
const recoveryReplay = process.argv.includes("--recovery-replay");
const runId = recoveryReplay
  ? `strategy3v2-recovery-replay-${compactDate}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`
  : newRunId(compactDate);
const apply = process.argv.includes("--apply");
const attemptPhase = process.argv.find((arg) => arg.startsWith("--attempt-phase="))?.slice("--attempt-phase=".length) || "";

const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const MIN_CHANGE_PERCENT = 5;
const MAX_CHANGE_PERCENT = 7;

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
    formal_allowed: receipt.recovery_replay !== true,
    publish_allowed: true,
    line_allowed: true,
    source_chain: {
      scanner_source: receipt.scanner_source,
      entry_window: receipt.entry_window,
      apply_source: receipt.recovery_replay === true ? "strategy3_v2_recovery_replay_apply" : "strategy3_v2_scanner_apply",
      recovery_replay: receipt.recovery_replay === true,
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
    quality_status: receipt.recovery_replay === true ? "recovery_replay_complete" : "complete",
    complete: true,
    formal_allowed: receipt.recovery_replay !== true,
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

function candleMinute(candle) {
  const parsed = Date.parse(candle?.candle_time || candle?.candleTime || candle?.date || "");
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

async function buildScannerCoreResults(readWater = readCanonicalDaytradeWater) {
  const water = await readWater({
    tradeDate,
    consumerName: STRATEGY,
    strategy3Consumer: true,
    requireMarketCalendar: true,
    // Natural 13:00 runs require the live producer receipt. A post-close
    // recovery validates the persisted v4.1 identities and 1m rows directly;
    // the latest live receipt is expected to become stale after the session.
    requireMotherPoolReceipt: !recoveryReplay,
    hydrateMotherPoolCandles: true,
    minimumCandlesPerSymbol: 20,
    // At the 13:00 natural slot, 20 bars cover readiness and the entry minute.
    // A post-close recovery needs 40 bars to include 12:59-13:02 through 13:30.
    barsPerSymbol: recoveryReplay ? 40 : 20,
    historicalRecoveryReplay: recoveryReplay,
  });
  const poolSymbols = [...water.poolBySymbol.keys()];
  const candidates = [];
  let ready20Count = 0;
  let entryWindowCount = 0;
  let belowChangeRangeCount = 0;
  let aboveChangeRangeOrLimitUpCount = 0;
  if (!water.ok || water.skipped) {
    return {
      water,
      mother_pool: {
        source: MOTHER_POOL_VIEW,
        receipt_source: MOTHER_POOL_RECEIPT_VIEW,
        trade_date: tradeDate,
        contract_version: MOTHER_POOL_CONTRACT_VERSION,
        canonical_run_id: water.receipt?.canonical_run_id || "",
        symbol_count: poolSymbols.length,
      },
      same_day_candle_symbols: water.candleRowsBySymbol.size,
      ready_20_candle_symbols: 0,
      entry_window_symbols: 0,
      symbol_data_gap_rows: water.symbolDataGaps.size,
      results: [],
    };
  }

  for (const code of poolSymbols) {
    if (water.symbolDataGaps.has(code)) continue;
    const pool = water.poolBySymbol.get(code) || {};
    const quote = water.quoteBySymbol.get(code) || {};
    const candles = [...(water.candleRowsBySymbol.get(code) || [])];
    candles.sort((a, b) => Date.parse(a.candle_time || "") - Date.parse(b.candle_time || ""));
    const count = candles.length;
    if (count >= 20) ready20Count += 1;
    const entryCandles = candles.filter((candle) => {
      const minute = candleMinute(candle);
      return minute !== null && minute >= 12 * 60 + 59 && minute <= 13 * 60 + 2;
    });
    if (entryCandles.length) entryWindowCount += 1;
    if (count < 20 || !entryCandles.length) continue;

    const entry = entryCandles[0];
    const last = candles[candles.length - 1] || {};
    const entryAverage = [entry.open, entry.high, entry.low, entry.close].map(Number).filter((value) => Number.isFinite(value) && value > 0);
    const entryPrice = Number(entry.close || (entryAverage.length ? entryAverage.reduce((sum, value) => sum + value, 0) / entryAverage.length : 0));
    const closePrice = Number(quote.price || last.close || 0);
    const prevClose = Number(quote.previous_close || 0);
    const changePercent = Number.isFinite(Number(quote.change_percent))
      ? Number(quote.change_percent)
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
    if (changePercent < MIN_CHANGE_PERCENT) {
      belowChangeRangeCount += 1;
      continue;
    }
    // The 7% inclusive ceiling explicitly excludes every limit-up stock from
    // Strategy3, without relying on a separately inferred limit-price field.
    if (changePercent > MAX_CHANGE_PERCENT) {
      aboveChangeRangeOrLimitUpCount += 1;
      continue;
    }
    if (!(closePrice >= entryPrice && totalVolume > 0)) continue;

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
      name: pool.name || quote.name || "",
      strategy: STRATEGY,
      signal_type: "overnight_chip_reference_v2",
      entry_price: round(entryPrice, 2),
      entry_price_source: `${INTRADAY_1M_RPC}:first_close_1259_1302`,
      entry_candle_time: entry.candle_time || "",
      close_price: round(closePrice, 2),
      change_percent: round(changePercent, 2),
      score,
      candle_count: count,
      first_candle_time: candles[0]?.candle_time || "",
      last_candle_time: last.candle_time || "",
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
        "strategy3_v2_change_percent_5_to_7_inclusive",
        "strategy3_v2_limit_up_exclusion_passed",
      ],
      formal_source: `${MOTHER_POOL_VIEW}+${QUOTE_TABLE}+rpc:${INTRADAY_1M_RPC}`,
      universe_source: MOTHER_POOL_VIEW,
      in_daytrade_mother_pool: true,
      contract_version: pool.contract_version,
      trade_date: pool.trade_date,
      canonical_run_id: pool.canonical_run_id,
      writer_run_id: pool.writer_run_id,
      generation_id: pool.generation_id,
      market: pool.market,
      source_name: pool.source_name,
      source_trade_date: pool.source_trade_date,
      source_updated_at: pool.source_updated_at,
      source_freshness: pool.source_freshness,
      updated_at: pool.updated_at,
      mother_pool_rank: pool.mother_pool_rank,
      priority_rank: pool.priority_rank,
      mother_pool_score: pool.mother_pool_score,
      priority_score: pool.priority_score,
      entry_score: pool.entry_score,
      upgrade_score: pool.upgrade_score,
      priority_reason: pool.priority_reason,
      priority_reasons: pool.priority_reasons,
      mother_reason: pool.mother_reason,
      mother_source: pool.mother_source,
      pool_source: pool.pool_source,
      pool_layer: pool.pool_layer,
      source_flags: pool.source_flags,
      source_run_ids: pool.source_run_ids,
      mother_readiness_status: pool.mother_readiness_status,
      is_formal_entry_eligible: pool.is_formal_entry_eligible,
      price: pool.price,
      open_price: pool.open_price,
      previous_close: pool.previous_close,
      high_price: pool.high_price,
      low_price: pool.low_price,
      total_volume: pool.total_volume,
      trade_value: pool.trade_value,
      avg_volume5: pool.avg_volume5,
      quote_trade_date: quote.trade_date,
      quote_seen_at: quote.quote_seen_at || quote.canonical_quote_time || "",
      quote_age_seconds: pool.quote_age_seconds,
      last_trade_time: quote.last_trade_time || "",
      last_trade_age_seconds: pool.last_trade_age_seconds,
      latest_candle_time: pool.latest_candle_time,
      intraday_1m_stale_seconds: pool.intraday_1m_stale_seconds,
      mother_updated_at: pool.mother_updated_at,
      pool_updated_trade_date: pool.pool_updated_trade_date,
      sector_name: pool.sector_name,
      sector_strength_score: pool.sector_strength_score,
      sector_member_active_count: pool.sector_member_active_count,
      industry_signal_fast_injected: pool.industry_signal_fast_injected,
      industry_signal_fast_inject_industries: pool.industry_signal_fast_inject_industries,
      ma5: pool.ma5,
      ma10: pool.ma10,
      ma20: pool.ma20,
      ma5_ma10_ma20_bullish: pool.ma5_ma10_ma20_bullish,
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.change_percent - a.change_percent || b.tail_volume_share_pct - a.tail_volume_share_pct);
  candidates.forEach((item, index) => { item.rank = index + 1; });
  return {
    water,
    mother_pool: {
      source: MOTHER_POOL_VIEW,
      receipt_source: MOTHER_POOL_RECEIPT_VIEW,
      trade_date: tradeDate,
      contract_version: MOTHER_POOL_CONTRACT_VERSION,
      canonical_run_id: water.receipt?.canonical_run_id || "",
      symbol_count: poolSymbols.length,
      pages: water.receipt?.mother_pool_pages || 0,
    },
    quote_source: { table: QUOTE_TABLE, valid_symbols: water.receipt?.quote_valid_rows || 0 },
    candle_source: { rpc: INTRADAY_1M_RPC, valid_symbols: water.receipt?.intraday_1m_valid_rows || 0 },
    same_day_candle_symbols: water.candleRowsBySymbol.size,
    ready_20_candle_symbols: ready20Count,
    entry_window_symbols: entryWindowCount,
    change_percent_gate: {
      min_inclusive: MIN_CHANGE_PERCENT,
      max_inclusive: MAX_CHANGE_PERCENT,
      limit_up_excluded: true,
      policy: "strategy3_v2_change_percent_5_to_7_inclusive_exclude_limit_up",
      below_range_count: belowChangeRangeCount,
      above_range_or_limit_up_count: aboveChangeRangeOrLimitUpCount,
    },
    symbol_data_gap_rows: water.symbolDataGaps.size,
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
  const scanner = await buildScannerCoreResults();
  // The 300-symbol Mother Pool size is a discovery target, not a hard scan
  // gate. Measure Strategy3 against the actual same-day Mother Pool instead.
  const formalReadyTarget = Number(scanner.mother_pool?.symbol_count || 0);
  const motherPoolCoverageRatio = formalReadyTarget > 0 ? Math.min(1, scanner.ready_20_candle_symbols / formalReadyTarget) : 0;
  const motherPoolCoverageOk = motherPoolCoverageRatio >= MIN_MOTHER_POOL_COVERAGE_RATIO;
  const scannerCoreReady = scanner.water.ok === true && scanner.water.skipped !== true && motherPoolCoverageOk;
  const readinessOk = readiness.ok && readiness.payload?.ok === true;
  if (!readinessOk && !scannerCoreReady) {
    issues.push("readiness_not_ready");
  }
  if (!scanner.water.ok) issues.push(...(scanner.water.failedChecks || [scanner.water.firstBlocker || "strategy3_v2_mother_pool_v4_1_not_ready"]));
  if (!motherPoolCoverageOk) issues.push("strategy3_v2_mother_pool_v4_1_usable_1m_coverage_below_90_percent");

  const receipt = issues.length
    ? failClosed("strategy3_v2_core_not_ready", {
        checked_at: nowTaipeiIso(),
        trade_date: tradeDate,
        run_id: runId,
        apply,
        readiness,
        scanner_core_ready: scannerCoreReady,
        scanner_source: `${MOTHER_POOL_VIEW}+${QUOTE_TABLE}+rpc:${INTRADAY_1M_RPC}`,
        scanner_summary: {
          universe_scope: "daytrade_mother_pool_only",
          mother_pool: scanner.mother_pool,
          same_day_candle_symbols: scanner.same_day_candle_symbols,
          ready_20_candle_symbols: scanner.ready_20_candle_symbols,
          entry_window_symbols: scanner.entry_window_symbols,
          change_percent_gate: scanner.change_percent_gate,
          formal_ready_target: formalReadyTarget,
          mother_pool_coverage_ratio: round(motherPoolCoverageRatio, 4),
          minimum_mother_pool_coverage_ratio: MIN_MOTHER_POOL_COVERAGE_RATIO,
          symbol_data_gap_rows: scanner.symbol_data_gap_rows,
          tolerance_policy: "strategy3_v2_isolates_symbol_data_gap_and_requires_90_percent_v4_1_usable_1m_coverage",
          result_count: scanner.results.length,
          quote_source: scanner.quote_source,
          candle_source: scanner.candle_source,
          consumer_receipt: scanner.water.receipt,
        },
        result_tables: { results: RESULTS_TABLE, runs: RUNS_TABLE, latestView: LATEST_VIEW },
        entry_window: ENTRY_WINDOW,
        issues,
        allowed_action: "repair_first_v4_1_blocker_then_rerun_strategy3_v2_scan",
      })
    : {
        ok: true,
        strategy: STRATEGY,
        contract: CONTRACT_VERSION,
        status: recoveryReplay ? "RECOVERY_REPLAY_COMPLETE" : "COMPLETE",
        checked_at: nowTaipeiIso(),
        trade_date: tradeDate,
        run_id: runId,
        apply,
        scanner_core_ready: true,
        scanner_source: `${MOTHER_POOL_VIEW}+${QUOTE_TABLE}+rpc:${INTRADAY_1M_RPC}`,
        scanner_summary: {
          universe_scope: "daytrade_mother_pool_only",
          mother_pool: scanner.mother_pool,
          same_day_candle_symbols: scanner.same_day_candle_symbols,
          ready_20_candle_symbols: scanner.ready_20_candle_symbols,
          entry_window_symbols: scanner.entry_window_symbols,
          change_percent_gate: scanner.change_percent_gate,
          formal_ready_target: formalReadyTarget,
          mother_pool_coverage_ratio: round(motherPoolCoverageRatio, 4),
          minimum_mother_pool_coverage_ratio: MIN_MOTHER_POOL_COVERAGE_RATIO,
          symbol_data_gap_rows: scanner.symbol_data_gap_rows,
          tolerance_policy: "strategy3_v2_isolates_symbol_data_gap_and_requires_90_percent_v4_1_usable_1m_coverage",
          result_count: scanner.results.length,
          quote_source: scanner.quote_source,
          candle_source: scanner.candle_source,
          consumer_receipt: scanner.water.receipt,
        },
        readiness,
        entry_window: ENTRY_WINDOW,
        result_count: scanner.results.length,
        results: scanner.results,
        line_allowed: true,
        formal_allowed: !recoveryReplay,
        publish_allowed: true,
        recovery_replay: recoveryReplay,
        natural_slot_complete: !recoveryReplay,
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
  receipt.consumer_name = STRATEGY;
  receipt.consumer_commit = scanner.water.receipt?.consumer_commit || "unknown";
  receipt.contract_version = MOTHER_POOL_CONTRACT_VERSION;
  receipt.source_contract_version = MOTHER_POOL_CONTRACT_VERSION;
  receipt.canonical_run_id = scanner.water.receipt?.canonical_run_id || null;
  receipt.mother_pool_http_status = scanner.water.receipt?.mother_pool_http_status || null;
  receipt.mother_pool_rows = scanner.water.receipt?.mother_pool_rows || 0;
  receipt.mother_pool_pages = scanner.water.receipt?.mother_pool_pages || 0;
  receipt.unique_symbols = scanner.water.receipt?.unique_symbols || 0;
  receipt.quote_valid_rows = scanner.water.receipt?.quote_valid_rows || 0;
  receipt.intraday_1m_valid_rows = scanner.water.receipt?.intraday_1m_valid_rows || 0;
  receipt.symbol_data_gap_rows = scanner.water.receipt?.symbol_data_gap_rows || 0;
  receipt.global_formal_gate_blocked = scanner.water.receipt?.global_formal_gate_blocked === true;
  receipt.receipt_incomplete = scanner.water.receipt?.receipt_incomplete === true;
  receipt.runner_status = receipt.ok ? "COMPLETE" : "FAILED";
  receipt.verifier_ok = null;
  receipt.receipt_written = true;
  receipt.failed_checks = receipt.ok ? [] : [...new Set([...(issues || []), receipt.reason_code || "strategy3_v2_failed"])];
  receipt.first_blocker = receipt.failed_checks[0] || null;
  const outputPath = recoveryReplay
    ? path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-recovery-replay-${compactDate}.json`)
    : scanReceiptPath(compactDate);
  const file = writeJson(outputPath, receipt);
  console.log(JSON.stringify({ ...receipt, receipt_path: file }, null, 2));
  process.exitCode = receipt.ok ? 0 : 1;
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { buildScannerCoreResults, MIN_CHANGE_PERCENT, MAX_CHANGE_PERCENT };
