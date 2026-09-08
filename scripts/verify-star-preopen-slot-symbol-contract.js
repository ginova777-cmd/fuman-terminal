#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const URL_ROOT = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const CONTRACT = "star_preopen_slot_symbol_canonical_verifier_v1";
const VERSION = "slot-symbol-isolation-v2";
const VALID_SLOTS = ["0845", "0850", "0855", "0859"];

function readSecret(name) {
  for (const file of [path.join(RUNTIME, "secrets", name), path.join(ROOT, "secrets", name)]) {
    try { const value = fs.readFileSync(file, "utf8").trim(); if (value) return value; } catch {}
  }
  return "";
}
function arg(name, fallback = "") { const prefix = `--${name}=`; return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback; }
function taipeiDate(value = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(value instanceof Date ? value : new Date(value)); }
function finite(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function positive(value) { const parsed = finite(value); return parsed !== null && parsed > 0; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function validTime(value, tradeDate) { const date = new Date(value || ""); return Number.isFinite(date.getTime()) && taipeiDate(date) === tradeDate; }
function millisecondsBetween(later, earlier) { const a = new Date(later || "").getTime(); const b = new Date(earlier || "").getTime(); return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, a - b) : null; }
function afterPreopenWindow(value) { const date = new Date(value || ""); if (!Number.isFinite(date.getTime())) return true; const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date); const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); return Number(map.hour) * 3600 + Number(map.minute) * 60 + Number(map.second) >= 9 * 3600; }

async function request(resource, params, key, options = {}) {
  const url = new URL(`${URL_ROOT}/rest/v1/${resource}`);
  for (const [name, value] of Object.entries(params || {})) url.searchParams.set(name, String(value));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", ...(options.body ? { "Content-Type": "application/json", Prefer: options.prefer || "return=minimal" } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
      const text = await response.text();
      if (!response.ok) { const error = new Error(`${resource}_HTTP_${response.status}:${text.slice(0, 300)}`); error.status = response.status; throw error; }
      return { status: response.status, rows: text ? JSON.parse(text) : [], attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === 3 || (error.status && error.status < 500 && error.status !== 408 && error.status !== 429)) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function classifyEvidence(universeRow, evidence, context) {
  const { tradeDate, slot, sourceCommonValid, verificationRunId, verifiedAt, publishedAt } = context;
  const failures = [];
  if (!sourceCommonValid) failures.push("COMMON_SOURCE_IDENTITY_INVALID");
  if (!evidence) failures.push("SLOT_EVIDENCE_MISSING");
  if (evidence && evidence.trade_date !== tradeDate) failures.push("CROSS_TRADE_DATE_EVIDENCE");
  if (evidence && evidence.capture_slot !== slot) failures.push("CAPTURE_SLOT_MISMATCH");
  if (evidence && evidence.natural_schedule_evidence !== true) failures.push("NATURAL_SCHEDULE_EVIDENCE_FALSE");
  if (evidence && !positive(evidence.fut_price)) failures.push("FUTURE_PRICE_MISSING");
  if (evidence && finite(evidence.fut_change_pct) === null) failures.push("FUTURE_CHANGE_MISSING");
  if (evidence && finite(evidence.relative_to_txf_percent) === null) failures.push("RELATIVE_TO_TXF_MISSING");
  if (evidence && finite(evidence.fut_volume) === null) failures.push("FUTURE_VOLUME_MISSING");
  if (evidence && !positive(evidence.trial_price)) failures.push("TRIAL_PRICE_MISSING");
  if (evidence && !positive(evidence.reference_price)) failures.push("REFERENCE_PRICE_MISSING");
  if (evidence && !positive(evidence.best_bid)) failures.push("BEST_BID_MISSING");
  if (evidence && !positive(evidence.future_0845_open_price)) failures.push("FUTURE_0845_OPEN_MISSING");
  if (evidence && !positive(evidence.future_preopen_high_price)) failures.push("FUTURE_PREOPEN_HIGH_MISSING");
  if (evidence && !positive(evidence.future_preopen_low_price)) failures.push("FUTURE_PREOPEN_LOW_MISSING");
  if (evidence && !(finite(evidence.future_preopen_sample_count) > 0)) failures.push("FUTURE_PREOPEN_SAMPLE_COUNT_MISSING");
  if (evidence && !validTime(evidence.future_preopen_range_start_at, tradeDate)) failures.push("FUTURE_PREOPEN_RANGE_START_INVALID");
  if (evidence && !validTime(evidence.future_preopen_range_end_at, tradeDate)) failures.push("FUTURE_PREOPEN_RANGE_END_INVALID");
  if (evidence && !validTime(evidence.future_0845_source_event_at, tradeDate)) failures.push("FUTURE_0845_SOURCE_EVENT_TIME_INVALID");
  if (evidence && !validTime(evidence.future_source_event_at, tradeDate)) failures.push("FUTURE_SOURCE_EVENT_TIME_INVALID");
  if (evidence && !validTime(evidence.trial_event_at, tradeDate)) failures.push("TRIAL_EVENT_TIME_INVALID");
  if (evidence && !evidence.run_id) failures.push("RUN_ID_MISSING");
  if (evidence && !evidence.generation_id) failures.push("GENERATION_ID_MISSING");
  const qualityStatus = !sourceCommonValid ? "BLOCKED_COMMON" : failures.length ? "DATA_GAP" : "READY";
  const latePublication = afterPreopenWindow(publishedAt);
  return {
    verification_run_id: verificationRunId,
    contract: CONTRACT,
    contract_version: VERSION,
    trade_date: tradeDate,
    capture_slot: slot,
    canonical_slot_run_id: `star_preopen:${tradeDate.replace(/-/g, "")}:${slot}`,
    symbol: String(universeRow.underlying_symbol || universeRow.symbol || ""),
    future_symbol: String(universeRow.future_symbol || universeRow.fut_contract || evidence?.future_symbol || "") || null,
    source_event_at: evidence?.source_event_at || evidence?.trial_event_at || evidence?.future_source_event_at || null,
    received_at: evidence?.received_at || null,
    published_at: publishedAt,
    verified_at: verifiedAt,
    source_latency_ms: millisecondsBetween(publishedAt, evidence?.source_event_at || evidence?.trial_event_at || evidence?.future_source_event_at),
    verification_latency_ms: millisecondsBetween(verifiedAt, evidence?.source_event_at || evidence?.trial_event_at || evidence?.future_source_event_at),
    late_publication: latePublication,
    preopen_realtime_usable: qualityStatus === "READY" && !latePublication,
    run_id: evidence?.run_id || null,
    generation_id: evidence?.generation_id || null,
    natural_schedule_evidence: evidence?.natural_schedule_evidence === true,
    source_common_valid: sourceCommonValid,
    quality_ok: qualityStatus === "READY",
    quality_status: qualityStatus,
    first_blocker: failures[0] || null,
    failed_checks: failures,
    technical_data: {
      fut_price: finite(evidence?.fut_price), fut_change_pct: finite(evidence?.fut_change_pct),
      relative_to_txf_percent: finite(evidence?.relative_to_txf_percent), fut_volume: finite(evidence?.fut_volume),
      trial_price: finite(evidence?.trial_price), reference_price: finite(evidence?.reference_price),
      best_bid: finite(evidence?.best_bid), best_ask: finite(evidence?.best_ask), bid_ask_ratio: finite(evidence?.bid_ask_ratio),
      future_source_event_at: evidence?.future_source_event_at || null, trial_event_at: evidence?.trial_event_at || null,
      future_0845_open_price: finite(evidence?.future_0845_open_price),
      future_preopen_high_price: finite(evidence?.future_preopen_high_price),
      future_preopen_low_price: finite(evidence?.future_preopen_low_price),
      future_preopen_sample_count: finite(evidence?.future_preopen_sample_count),
      future_preopen_range_start_at: evidence?.future_preopen_range_start_at || null,
      future_preopen_range_end_at: evidence?.future_preopen_range_end_at || null,
      future_0845_source_event_at: evidence?.future_0845_source_event_at || null,
      future_latest_source_event_at: evidence?.future_latest_source_event_at || null,
      future_pattern_evidence_mode: evidence?.future_pattern_evidence_mode || null,
      recent_1m_three_sample_supported: evidence?.recent_1m_three_sample_supported === true,
    },
    strategy_evaluable: qualityStatus === "READY",
    strategy_result: qualityStatus === "READY" ? "VIEWER_PENDING" : qualityStatus === "BLOCKED_COMMON" ? "BLOCKED_COMMON" : "BLOCKED_DATA_GAP",
    strategy_evaluation_owner: "viewer_live_rule",
    formal_candidate: false,
    formal_entry_allowed: false,
    order_allowed: false,
  };
}

function buildReceipt(universeRows, evidenceRows, options) {
  const { tradeDate, slot, checkedAt = new Date().toISOString(), publishedAt = new Date().toISOString() } = options;
  const verificationRunId = `${CONTRACT}:${tradeDate.replace(/-/g, "")}:${slot}:${checkedAt.replace(/\D/g, "")}`;
  const evidenceBySymbol = new Map();
  const duplicateEvidence = [];
  for (const row of evidenceRows) {
    const symbol = String(row.symbol || "");
    if (evidenceBySymbol.has(symbol)) duplicateEvidence.push(symbol);
    else evidenceBySymbol.set(symbol, row);
  }
  const universeSymbols = universeRows.map((row) => String(row.underlying_symbol || row.symbol || "")).filter(Boolean);
  const duplicateUniverse = universeSymbols.filter((symbol, index) => universeSymbols.indexOf(symbol) !== index);
  const commonFailures = [];
  if (!VALID_SLOTS.includes(slot)) commonFailures.push("INVALID_CAPTURE_SLOT");
  if (!universeRows.length) commonFailures.push("UNIVERSE_EMPTY");
  if (duplicateUniverse.length) commonFailures.push("UNIVERSE_DUPLICATE_SYMBOL");
  if (duplicateEvidence.length) commonFailures.push("SLOT_EVIDENCE_DUPLICATE_SYMBOL");
  if (evidenceRows.some((row) => row.trade_date !== tradeDate || row.capture_slot !== slot)) commonFailures.push("SOURCE_BATCH_IDENTITY_MISMATCH");
  const sourceCommonValid = commonFailures.length === 0;
  const results = universeRows.map((row) => classifyEvidence(row, evidenceBySymbol.get(String(row.underlying_symbol || row.symbol || "")) || null, { tradeDate, slot, sourceCommonValid, verificationRunId, verifiedAt: checkedAt, publishedAt }));
  const sourceValidCount = results.filter((row) => row.quality_status === "READY").length;
  const dataGapCount = results.filter((row) => row.quality_status !== "READY").length;
  const failureCounts = {};
  for (const row of results) for (const code of row.failed_checks || []) failureCounts[code] = (failureCounts[code] || 0) + 1;
  const status = !sourceCommonValid ? "failed" : dataGapCount ? "partial" : "complete";
  return {
    receipt: {
      verification_run_id: verificationRunId, contract: CONTRACT, contract_version: VERSION,
      trade_date: tradeDate, capture_slot: slot, canonical_slot_run_id: `star_preopen:${tradeDate.replace(/-/g, "")}:${slot}`,
      status, complete: status === "complete", exit_code: status === "complete" ? 0 : 1,
      source_common_valid: sourceCommonValid, published_at: publishedAt, verified_at: checkedAt,
      universe_count: universeRows.length, source_valid_count: sourceValidCount,
      strategy_evaluated_count: 0, strategy_match_count: null, strategy_no_match_count: null,
      data_gap_count: dataGapCount, failed_checks: commonFailures,
      first_blocker: commonFailures[0] || (dataGapCount ? "SYMBOL_DATA_GAP_PRESENT" : null),
      source_identity: { trade_date: tradeDate, capture_slot: slot, bounded_retry_max: 3, batch_mixing_allowed: false },
      diagnostic_summary: {
        ready_symbols: results.filter((row) => row.quality_ok).map((row) => row.symbol),
        data_gap_symbols: results.filter((row) => !row.quality_ok).map((row) => row.symbol),
        failure_counts: failureCounts,
        technical_data_schema: ["fut_price", "fut_change_pct", "relative_to_txf_percent", "fut_volume", "trial_price", "reference_price", "best_bid", "best_ask", "bid_ask_ratio", "future_source_event_at", "trial_event_at", "future_0845_open_price", "future_preopen_high_price", "future_preopen_low_price", "future_preopen_sample_count", "future_preopen_range_start_at", "future_preopen_range_end_at", "future_0845_source_event_at", "future_latest_source_event_at", "future_pattern_evidence_mode", "recent_1m_three_sample_supported"],
        strategy_evaluation_owner: "viewer_live_rule",
      },
    },
    results,
  };
}

function fixture() {
  const tradeDate = "2026-09-08"; const slot = "0855"; const event = "2026-09-08T00:55:10.000Z";
  const universe = Array.from({ length: 245 }, (_, index) => ({ underlying_symbol: String(1000 + index), future_symbol: `F${index}` }));
  const evidence = universe.map((row) => ({ trade_date: tradeDate, capture_slot: slot, symbol: row.underlying_symbol, future_symbol: row.future_symbol, future_source_event_at: event, trial_event_at: event, source_event_at: event, received_at: "2026-09-08T00:55:11.000Z", natural_schedule_evidence: true, fut_price: 101, fut_change_pct: 2.5, relative_to_txf_percent: 1.2, fut_volume: 80, trial_price: 100, reference_price: 98, best_bid: 100, best_ask: 101, bid_ask_ratio: 2, future_0845_open_price: 100, future_preopen_high_price: 102, future_preopen_low_price: 99, future_preopen_sample_count: 3, future_preopen_range_start_at: "2026-09-08T00:45:10.000Z", future_preopen_range_end_at: event, future_0845_source_event_at: "2026-09-08T00:45:09.000Z", future_latest_source_event_at: event, future_pattern_evidence_mode: "natural_slot_snapshots_0845_through_current_slot", recent_1m_three_sample_supported: false, run_id: "fixture-run", generation_id: `fixture:${row.underlying_symbol}` }));
  evidence[244] = { ...evidence[244], trial_price: null };
  const built = buildReceipt(universe, evidence, { tradeDate, slot, checkedAt: "2026-09-08T00:55:12.000Z", publishedAt: "2026-09-08T00:55:13.000Z" });
  const lateUniverse = [{ underlying_symbol: "2330", future_symbol: "CDFI6" }];
  const lateEvidence = [{ ...evidence[0], symbol: "2330", future_symbol: "CDFI6", capture_slot: "0859", future_source_event_at: "2026-09-08T00:59:50.000Z", trial_event_at: "2026-09-08T00:59:50.000Z", source_event_at: "2026-09-08T00:59:50.000Z", received_at: "2026-09-08T01:00:01.000Z", generation_id: "fixture:late-2330" }];
  const late = buildReceipt(lateUniverse, lateEvidence, { tradeDate, slot: "0859", checkedAt: "2026-09-08T01:00:02.000Z", publishedAt: "2026-09-08T01:00:03.000Z" });
  const commonFault = buildReceipt(lateUniverse, [lateEvidence[0], lateEvidence[0]], { tradeDate, slot: "0859", checkedAt: "2026-09-08T01:00:02.000Z", publishedAt: "2026-09-08T01:00:03.000Z" });
  const missingPatternField = buildReceipt([universe[0]], [{ ...evidence[0], future_0845_open_price: null }], { tradeDate, slot, checkedAt: "2026-09-08T00:55:12.000Z", publishedAt: "2026-09-08T00:55:13.000Z" });
  const pass = built.receipt.complete === false && built.receipt.status === "partial" && built.receipt.universe_count === 245 && built.receipt.source_valid_count === 244 && built.receipt.data_gap_count === 1 && built.results.filter((row) => row.quality_status === "READY").length === 244 && built.results.filter((row) => row.quality_status === "DATA_GAP").length === 1 && built.results[244].first_blocker === "TRIAL_PRICE_MISSING" && built.results.every((row) => row.formal_entry_allowed === false && row.order_allowed === false);
  const patternFixtures = {
    retest_holds_open: { future_0845_open_price: 100, future_preopen_high_price: 103, future_preopen_low_price: 99.6, fut_price: 100.2 },
    one_way_higher_no_retest: { future_0845_open_price: 100, future_preopen_high_price: 108, future_preopen_low_price: 100, fut_price: 108 },
    falling_pullback: { future_0845_open_price: 100, future_preopen_high_price: 101, future_preopen_low_price: 95, fut_price: 96 },
    missing_pattern_field: { future_0845_open_price: null, future_preopen_high_price: 103, future_preopen_low_price: 99.6, fut_price: 100.2 },
  };
  return { ok: pass && late.results[0].late_publication === true && late.results[0].preopen_realtime_usable === false && commonFault.receipt.source_common_valid === false && commonFault.results.every((row) => row.quality_status === "BLOCKED_COMMON") && missingPatternField.results[0].first_blocker === "FUTURE_0845_OPEN_MISSING", contract: "star_slot_symbol_isolation_fixture_v2", fixture: true, writes_supabase: false, sends_telegram: false, receipt: built.receipt, samples: { slot_symbol_ready: built.results[0], slot_symbol_data_gap: built.results[244], missing_pattern_field_isolated: missingPatternField.results[0], overall_partial_with_ready_symbols: built.receipt, late_0859_post_0900_publication: { ...late.results[0], retrospective_only: true }, common_identity_failure: commonFault.receipt, viewer_pattern_inputs: patternFixtures }, assertions: { overall_incomplete: !built.receipt.complete, ready_244: built.receipt.source_valid_count === 244, data_gap_1: built.receipt.data_gap_count === 1, single_gap_isolated: built.results[244].first_blocker === "TRIAL_PRICE_MISSING", missing_pattern_field_isolated: missingPatternField.results[0].quality_status === "DATA_GAP" && missingPatternField.results[0].first_blocker === "FUTURE_0845_OPEN_MISSING", formal_gate_unchanged: built.results.every((row) => !row.formal_entry_allowed && !row.order_allowed), natural_pattern_fields_present: positive(built.results[0].technical_data.future_0845_open_price) && positive(built.results[0].technical_data.future_preopen_high_price) && positive(built.results[0].technical_data.future_preopen_low_price) && built.results[0].technical_data.future_preopen_sample_count === 3, recent_one_minute_three_sample_not_fabricated: built.results[0].technical_data.recent_1m_three_sample_supported === false, late_publication_not_realtime: late.results[0].late_publication === true && late.results[0].preopen_realtime_usable === false, common_failure_blocks_batch: commonFault.receipt.source_common_valid === false && commonFault.results.every((row) => row.quality_status === "BLOCKED_COMMON") } };
}

async function publish(built, serviceKey) {
  const initial = { ...built.receipt, status: "failed", complete: false, exit_code: 1, first_blocker: "PUBLISH_IN_PROGRESS" };
  await request("fugle_daytrade_star_slot_verification_receipts", { on_conflict: "verification_run_id" }, serviceKey, { method: "POST", body: initial, prefer: "resolution=merge-duplicates,return=minimal" });
  for (let offset = 0; offset < built.results.length; offset += 100) {
    await request("fugle_daytrade_star_slot_symbol_results", { on_conflict: "verification_run_id,symbol" }, serviceKey, { method: "POST", body: built.results.slice(offset, offset + 100), prefer: "resolution=merge-duplicates,return=minimal" });
  }
  await request("fugle_daytrade_star_slot_verification_receipts", { verification_run_id: `eq.${built.receipt.verification_run_id}` }, serviceKey, { method: "PATCH", body: built.receipt, prefer: "return=minimal" });
}

async function main() {
  if (process.argv.includes("--fixture")) { const result = fixture(); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; return; }
  const tradeDate = arg("trade-date", taipeiDate()); const slot = arg("slot");
  if (!VALID_SLOTS.includes(slot)) throw new Error("slot must be one of 0845,0850,0855,0859");
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt");
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY_MISSING");
  const [universeResponse, evidenceResponse] = await Promise.all([
    request("v_fugle_daytrade_star_universe_readback", { select: "trade_date,underlying_symbol,underlying_name,future_symbol,selected_near_one", trade_date: `eq.${tradeDate}`, selected_near_one: "eq.true", order: "underlying_symbol.asc", limit: "1000" }, anonKey),
    request("v_fugle_daytrade_star_slot_evidence_source", { select: "*", trade_date: `eq.${tradeDate}`, capture_slot: `eq.${slot}`, order: "symbol.asc", limit: "1000" }, anonKey),
  ]);
  const built = buildReceipt(universeResponse.rows, evidenceResponse.rows, { tradeDate, slot });
  built.receipt.source_identity = { ...built.receipt.source_identity, universe_http_status: universeResponse.status, evidence_http_status: evidenceResponse.status, universe_read_attempts: universeResponse.attempts, evidence_read_attempts: evidenceResponse.attempts };
  if (process.argv.includes("--publish")) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY || readSecret("supabase-service-role-key.txt");
    if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY_MISSING_FOR_SLOT_PUBLISH");
    await publish(built, serviceKey);
  }
  const receiptDir = path.join(RUNTIME, "data", "scan-receipts"); fs.mkdirSync(receiptDir, { recursive: true });
  const receiptPath = path.join(receiptDir, `star-preopen-slot-${slot}-${tradeDate.replace(/-/g, "")}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify({ ...built.receipt, credential_role: "anon_read_only", writes_supabase: process.argv.includes("--publish"), symbol_results_view: "v_fugle_daytrade_star_slot_symbol_readback", receipt_view: "v_fugle_daytrade_star_slot_verification_readback", receipt_path: receiptPath }, null, 2) + "\n");
  console.log(JSON.stringify({ ...built.receipt, credential_role: "anon_read_only", writes_supabase: process.argv.includes("--publish"), receipt_path: receiptPath }, null, 2));
  if (!built.receipt.complete) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(JSON.stringify({ contract: CONTRACT, status: "failed", complete: false, first_blocker: error.message }, null, 2)); process.exitCode = 1; });
module.exports = { buildReceipt, classifyEvidence, fixture };
