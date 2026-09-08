"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeFugleAggregate, normalizeFugleTrade, mergeFugleQuoteState } = require("../lib/fugle-websocket-quotes");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const REQUIRED_SLOTS = ["0845", "0850", "0855", "0859"];
const CONTRACT = "star_preopen_trial_history_canonical_verifier_v2";
const CONTRACT_VERSION = "full-stock-futures-cross-computer-v2";
const PAGE_SIZE = 1000;

function readText(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function readSecret(name) { return readText(path.join(RUNTIME_DIR, "secrets", name)).trim() || readText(path.join(ROOT, "secrets", name)).trim(); }
function arg(name, fallback = "") { const prefix = `--${name}=`; return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback; }
function taipeiDate(value = new Date()) { const parsed = value instanceof Date ? value : new Date(value); if (!Number.isFinite(parsed.getTime())) return ""; return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed); }
function number(value) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function payloadOf(row) { if (row?.payload && typeof row.payload === "object") return row.payload; try { return JSON.parse(String(row?.payload || "{}")); } catch { return {}; } }
function add(checks, code, ok, detail = null) { checks.push({ code, ok: Boolean(ok), detail }); }
function unique(values) { return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]; }

function staticChecks() {
  const checks = [];
  const trialMicros = 1788828300000000;
  const aggregate = normalizeFugleAggregate({ data: { symbol: "2337", referencePrice: 120, lastTrial: { price: 126, time: trialMicros }, bids: [{ price: 126, size: 800 }], asks: [{ price: 126.5, size: 300 }], isTrial: true, isLimitUpBid: true, lastUpdated: trialMicros } });
  const postOpen = normalizeFugleAggregate({ data: { symbol: "2337", referencePrice: 120, closePrice: 127, lastTrial: { price: 126, time: trialMicros }, lastUpdated: trialMicros + 60_000_000 } });
  const trade = normalizeFugleTrade({ data: { symbol: "2337", price: 126.5, bid: 126, ask: 126.5, isTrial: true, time: trialMicros + 1_000_000 } });
  const merged = mergeFugleQuoteState(aggregate, trade);
  add(checks, "aggregate_trial_price", aggregate?.trialPrice === 126);
  add(checks, "aggregate_explicit_is_trial", aggregate?.isTrial === true);
  add(checks, "last_trial_does_not_imply_postopen_trial", postOpen?.isTrial === false);
  add(checks, "trial_event_time_preserved", Boolean(aggregate?.trialEventAt));
  add(checks, "trial_trade_semantics", trade?.isTrial === true && trade?.trialPrice === 126.5 && Boolean(trade?.trialEventAt));
  add(checks, "sparse_trade_preserves_aggregate_context", merged?.referencePrice === 120 && merged?.bidSize === 800 && merged?.askSize === 300 && merged?.isLimitUpBid === true && merged?.trialPrice === 126.5);
  const writer = readText(path.join(ROOT, "scripts", "run-daytrade-source-writer.js"));
  const nearOne = readText(path.join(ROOT, "scripts", "run-daytrade-near-one-source.js"));
  const collector = readText(path.join(ROOT, "scripts", "fugle-websocket-collector.js"));
  const sql = readText(path.join(ROOT, "ops", "public-slot", "DaytradeStarPreopenReadbackContract_20260908.sql"));
  const receiptSql = readText(path.join(ROOT, "ops", "public-slot", "DaytradeStarSideVolumeVerificationReceipts_20260908.sql"));
  const retiredSql = path.join(ROOT, "ops", "public-slot", ["DaytradeStarPreopenReadbackContract", "20260902.sql"].join("_"));
  add(checks, "collector_uses_field_aware_merge", collector.includes("mergeFugleQuoteState(previous, quote)"));
  add(checks, "history_uses_trial_event_time", writer.includes("const observedAt = trialEventAt || normalizeTimestamp"));
  add(checks, "history_run_identity", writer.includes("run_id: `${PREOPEN_WRITER_CONTRACT}:${tradeDate.replace(/-/g, \"\")}`"));
  add(checks, "history_generation_identity", writer.includes("generation_id: `${symbol}:${observedAt}`"));
  add(checks, "preopen_window_excludes_0900", writer.includes("minutes >= PREOPEN_CAPTURE_END_MINUTES"));
  add(checks, "future_snapshot_run_identity", nearOne.includes("run_id: `daytrade_futopt_preopen:${tradeDate.replace(/-/g, \"\")}`"));
  add(checks, "future_snapshot_trial_event_time", nearOne.includes("trial_event_at: trial?.trial_event_at || null"));
  add(checks, "full_universe_view_defined", sql.includes("v_fugle_daytrade_star_universe_readback"));
  add(checks, "txf_excluded_from_stock_universe", sql.includes("future_symbol not like 'TXF%'"));
  add(checks, "removed_trial_rise_hard_gate", !sql.includes("trial_rise_percent>=2"));
  add(checks, "removed_bid_ask_ratio_hard_gate", !sql.includes("bid_ask_ratio>=1.5"));
  add(checks, "star_final_closes_stock_and_future", sql.includes("future_pattern='開盤回測守住',false) and preopen_ok"));
  add(checks, "cross_computer_receipt_view", receiptSql.includes("v_fugle_daytrade_star_verification_readback"));
  add(checks, "legacy_star_sql_removed", !fs.existsSync(retiredSql));
  return checks;
}

function anonKey() { return process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt"); }
function serviceKey() { return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY || readSecret("supabase-service-role-key.txt"); }

async function fetchJson(resource, params, key, method = "GET", body = null) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${resource}`);
  for (const [name, value] of Object.entries(params || {})) url.searchParams.set(name, String(value));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json", Prefer: "return=minimal" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
      const text = await response.text();
      if (!response.ok) { const error = new Error(`${resource}_HTTP_${response.status}:${text.slice(0, 300)}`); error.status = response.status; throw error; }
      return { status: response.status, rows: text ? JSON.parse(text) : [] };
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      if ((status && status < 500 && status !== 408 && status !== 429) || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function readAnonPaged(resource, filters, key) {
  const rows = []; let pageCount = 0;
  for (let page = 0; page < 30; page += 1) {
    const response = await fetchJson(resource, { select: "*", ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }, key);
    const pageRows = Array.isArray(response.rows) ? response.rows : [];
    rows.push(...pageRows); pageCount += 1;
    if (pageRows.length < PAGE_SIZE) return { resource, status: response.status, rows, pageCount };
  }
  throw new Error(`${resource}_PAGINATION_LIMIT_EXCEEDED`);
}

function snapshotEvidence(row) {
  const payload = payloadOf(row); const reasons = [];
  if (row.natural_schedule_evidence !== true) reasons.push("NOT_NATURAL_SCHEDULE_EVIDENCE");
  if (!(number(row.fut_price) > 0)) reasons.push("FUTURE_PRICE_MISSING");
  if (!(number(row.trial_price) > 0)) reasons.push("TRIAL_PRICE_MISSING");
  if (!(number(payload.reference_price) > 0)) reasons.push("REFERENCE_PRICE_MISSING");
  if (!(number(row.best_bid) > 0)) reasons.push("BEST_BID_MISSING");
  if (!payload.trial_event_at) reasons.push("TRIAL_EVENT_AT_MISSING");
  if (!payload.run_id) reasons.push("EVENT_RUN_ID_MISSING");
  if (!payload.generation_id) reasons.push("GENERATION_ID_MISSING");
  return { row, payload, reasons, ok: reasons.length === 0 };
}

function classifySymbol(universeRow, starRow, snapshotRows, historyRows, tradeDate) {
  const symbol = String(universeRow.underlying_symbol || "");
  const slotEvidence = REQUIRED_SLOTS.map((slot) => {
    const evidence = snapshotRows.filter((row) => String(row.capture_slot || "") === slot).map(snapshotEvidence);
    const times = evidence.map((item) => item.payload.trial_event_at || item.row.captured_at).filter(Boolean).sort();
    return { slot, row_count: evidence.length, complete_rows: evidence.filter((item) => item.ok).length, first_event_at: times[0] || null, last_event_at: times.at(-1) || null, missing_reasons: unique(evidence.flatMap((item) => item.reasons)) };
  });
  const usableHistory = historyRows.filter((row) => { const payload = payloadOf(row); const eventAt = payload.trial_event_at || row.observed_at; return number(row.trial_price) > 0 && number(row.reference_price) > 0 && row.is_trial === true && payload.writer_contract === "preopen_snapshot_history_v2" && taipeiDate(eventAt) === tradeDate && payload.run_id && payload.generation_id; });
  const gapReasons = [];
  if (!starRow) gapReasons.push("STAR_READBACK_ROW_MISSING");
  if (slotEvidence.some((item) => item.row_count === 0)) gapReasons.push("NATURAL_SLOT_MISSING");
  if (slotEvidence.some((item) => item.complete_rows === 0)) gapReasons.push("NATURAL_SLOT_INCOMPLETE");
  if (!usableHistory.length) gapReasons.push("TRIAL_HISTORY_MISSING");
  for (const [value, code] of [[starRow?.future_0845_open_price,"FUTURE_0845_OPEN_MISSING"],[starRow?.future_0859_last_price,"FUTURE_0859_PRICE_MISSING"],[starRow?.trial_price,"TRIAL_PRICE_MISSING"],[starRow?.reference_price,"REFERENCE_PRICE_MISSING"],[starRow?.best_bid_price,"BEST_BID_MISSING"]]) if (!(number(value) > 0)) gapReasons.push(code);
  for (const [value, code] of [[starRow?.future_change_percent,"FUTURE_CHANGE_MISSING"],[starRow?.relative_to_txf_percent,"TXF_RELATIVE_STRENGTH_MISSING"],[starRow?.future_total_volume,"FUTURE_VOLUME_MISSING"]]) if (number(value) === null) gapReasons.push(code);
  const noMatchReasons = []; let result = "DATA_GAP";
  if (!gapReasons.length) {
    if (number(starRow.best_bid_price) < number(starRow.trial_price)) noMatchReasons.push("BEST_BID_BELOW_TRIAL");
    if (number(starRow.future_change_percent) < 2) noMatchReasons.push("FUTURE_CHANGE_BELOW_2_PERCENT");
    if (number(starRow.relative_to_txf_percent) < 1) noMatchReasons.push("RELATIVE_TO_TXF_BELOW_1_PERCENT");
    if (number(starRow.future_total_volume) < 50) noMatchReasons.push("FUTURE_VOLUME_BELOW_50");
    if (starRow.future_open_retest_ok !== true) noMatchReasons.push("FUTURE_OPEN_RETEST_NOT_MET");
    result = noMatchReasons.length ? "NO_MATCH" : "PASS";
  }
  const historyTimes = usableHistory.map((row) => payloadOf(row).trial_event_at || row.observed_at).sort();
  return { symbol, name: universeRow.underlying_name || starRow?.name || symbol, future_symbol: universeRow.future_symbol, contract_end_date: universeRow.contract_end_date, selection_rule: universeRow.selection_rule, result, data_gap_reasons: unique(gapReasons), no_match_reasons: unique(noMatchReasons), slots: slotEvidence, snapshot_rows: snapshotRows.length, history_rows: historyRows.length, usable_history_rows: usableHistory.length, first_history_event_at: historyTimes[0] || null, last_history_event_at: historyTimes.at(-1) || null, event_run_ids: unique([...snapshotRows.map((row) => payloadOf(row).run_id), ...usableHistory.map((row) => payloadOf(row).run_id)]), generation_ids: unique([...snapshotRows.map((row) => payloadOf(row).generation_id), ...usableHistory.map((row) => payloadOf(row).generation_id)]) };
}

async function liveChecks(tradeDate, checks) {
  const key = anonKey(); if (!key) throw new Error("SUPABASE_ANON_KEY_MISSING");
  const resources = await Promise.all([
    readAnonPaged("v_fugle_daytrade_star_universe_readback", { trade_date: `eq.${tradeDate}`, order: "underlying_symbol.asc,candidate_rank.asc" }, key),
    readAnonPaged("v_fugle_daytrade_star_preopen_readback", { trade_date: `eq.${tradeDate}`, order: "underlying_symbol.asc" }, key),
    readAnonPaged("v_fugle_daytrade_preopen_snapshot_contract", { trade_date: `eq.${tradeDate}`, order: "underlying_symbol.asc,capture_slot.asc" }, key),
    readAnonPaged("v_fugle_preopen_snapshot_history", { trade_date: `eq.${tradeDate}`, order: "symbol.asc,observed_at.asc" }, key),
  ]);
  for (const source of resources) add(checks, `anon_${source.resource}_http_200`, source.status === 200, source.status);
  const [universe, star, snapshots, history] = resources;
  const selected = universe.rows.filter((row) => row.selected_near_one === true || row.selection_status === "selected");
  const selectedCounts = new Map(); for (const row of selected) selectedCounts.set(String(row.underlying_symbol), (selectedCounts.get(String(row.underlying_symbol)) || 0) + 1);
  const duplicateUnderlyingCount = [...selectedCounts.values()].filter((count) => count > 1).length;
  const starBySymbol = new Map(star.rows.map((row) => [String(row.underlying_symbol || row.symbol || ""), row]));
  const snapshotsBySymbol = new Map(); const historyBySymbol = new Map();
  for (const row of snapshots.rows) { const keySymbol = String(row.underlying_symbol || ""); snapshotsBySymbol.set(keySymbol, [...(snapshotsBySymbol.get(keySymbol) || []), row]); }
  for (const row of history.rows) { const keySymbol = String(row.symbol || ""); historyBySymbol.set(keySymbol, [...(historyBySymbol.get(keySymbol) || []), row]); }
  const cases = selected.map((row) => classifySymbol(row, starBySymbol.get(String(row.underlying_symbol)), snapshotsBySymbol.get(String(row.underlying_symbol)) || [], historyBySymbol.get(String(row.underlying_symbol)) || [], tradeDate));
  const counts = { universe_count: new Set(selected.map((row) => String(row.underlying_symbol))).size, evaluated_count: cases.length, pass_count: cases.filter((row) => row.result === "PASS").length, no_match_count: cases.filter((row) => row.result === "NO_MATCH").length, data_gap_count: cases.filter((row) => row.result === "DATA_GAP").length, missing_symbols: cases.filter((row) => row.data_gap_reasons.includes("STAR_READBACK_ROW_MISSING")).map((row) => row.symbol), duplicate_underlying_count: duplicateUnderlyingCount, page_count: resources.reduce((sum, source) => sum + source.pageCount, 0), read_rows: resources.reduce((sum, source) => sum + source.rows.length, 0) };
  add(checks, "universe_non_empty", counts.universe_count > 0, counts.universe_count);
  add(checks, "universe_fully_evaluated", counts.evaluated_count === counts.universe_count, counts);
  add(checks, "result_partition_closed", counts.pass_count + counts.no_match_count + counts.data_gap_count === counts.evaluated_count, counts);
  add(checks, "one_selected_contract_per_underlying", duplicateUnderlyingCount === 0, duplicateUnderlyingCount);
  add(checks, "full_universe_source_evidence_complete", counts.data_gap_count === 0, counts.data_gap_count);
  return { sources: Object.fromEntries(resources.map((source) => [source.resource, { http_status: source.status, row_count: source.rows.length, page_count: source.pageCount }])), counts, exclusions: universe.rows.filter((row) => row.selection_status === "excluded").map((row) => ({ symbol: row.underlying_symbol, future_symbol: row.future_symbol, contract_end_date: row.contract_end_date, exclusion_reason: row.exclusion_reason })), cases };
}

function csvCell(value) { const text = typeof value === "string" ? value : JSON.stringify(value ?? ""); return `"${String(text).replace(/"/g, '""')}"`; }
function writeArtifacts(receipt) {
  const directory = path.join(RUNTIME_DIR, "data", "scan-receipts"); fs.mkdirSync(directory, { recursive: true });
  const compact = receipt.trade_date.replace(/\D/g, ""); const jsonPath = path.resolve(arg("receipt", path.join(directory, `star-preopen-trial-history-canonical-receipt-${compact}.json`))); const csvPath = path.join(directory, `star-preopen-trial-history-detail-${compact}.csv`); const universeCsvPath = path.join(directory, `star-preopen-universe-${compact}.csv`);
  const columns = ["symbol","name","future_symbol","contract_end_date","result","data_gap_reasons","no_match_reasons","snapshot_rows","history_rows","usable_history_rows","event_run_ids","generation_ids"];
  const csv = [columns.map(csvCell).join(","), ...(receipt.live_evidence?.cases || []).map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n";
  const universeColumns = ["symbol","future_symbol","contract_end_date","selection_status","exclusion_reason","result"];
  const universeRows = [...(receipt.live_evidence?.cases || []).map((row) => ({ ...row, selection_status: "selected", exclusion_reason: null })), ...(receipt.live_evidence?.exclusions || []).map((row) => ({ ...row, selection_status: "excluded", result: null }))];
  const universeCsv = [universeColumns.map(csvCell).join(","), ...universeRows.map((row) => universeColumns.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n";
  fs.writeFileSync(jsonPath, `${JSON.stringify({ ...receipt, receipt_path: jsonPath, detail_csv_path: csvPath, universe_csv_path: universeCsvPath }, null, 2)}\n`, "utf8"); fs.writeFileSync(csvPath, csv, "utf8"); fs.writeFileSync(universeCsvPath, universeCsv, "utf8"); return { json: jsonPath, detail_csv: csvPath, universe_csv: universeCsvPath };
}

async function publishReceipt(receipt) {
  const key = serviceKey(); if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY_MISSING_FOR_RECEIPT_PUBLISH"); const counts = receipt.live_evidence?.counts || {};
  const body = { verification_run_id: receipt.verification_run_id, contract: receipt.contract, contract_version: receipt.contract_version, trade_date: receipt.trade_date, canonical_run_id: receipt.canonical_run_id, status: receipt.status, complete: receipt.complete, exit_code: receipt.exitCode, verified_at: receipt.verified_at, failed_checks: receipt.failed_checks, first_blocker: receipt.first_blocker, universe_count: counts.universe_count || 0, evaluated_count: counts.evaluated_count || 0, pass_count: counts.pass_count || 0, no_match_count: counts.no_match_count || 0, data_gap_count: counts.data_gap_count || 0, missing_symbols: counts.missing_symbols || [], duplicate_underlying_count: counts.duplicate_underlying_count || 0, page_count: counts.page_count || 0, read_rows: counts.read_rows || 0, source_identity: { sources: receipt.live_evidence?.sources || {}, event_run_ids: unique((receipt.live_evidence?.cases || []).flatMap((row) => row.event_run_ids || [])), generation_ids: unique((receipt.live_evidence?.cases || []).flatMap((row) => row.generation_ids || [])) }, diagnostic_summary: { exclusions: receipt.live_evidence?.exclusions || [], cases: receipt.live_evidence?.cases || [] } };
  await fetchJson("fugle_daytrade_star_verification_receipts", {}, key, "POST", body);
}

async function main() {
  const live = process.argv.includes("--live"); const writeReceipt = process.argv.includes("--write-receipt"); const publish = process.argv.includes("--publish-receipt"); const tradeDate = arg("trade-date", taipeiDate()); const verifiedAt = new Date().toISOString(); const checks = staticChecks(); let liveEvidence = { sources: {}, counts: {}, exclusions: [], cases: [] };
  if (live) { try { liveEvidence = await liveChecks(tradeDate, checks); } catch (error) { add(checks, "live_anon_readback", false, error.message); } }
  const failed = checks.filter((check) => !check.ok); const complete = live && failed.length === 0; const compact = tradeDate.replace(/\D/g, "");
  const receipt = { contract: CONTRACT, contract_version: CONTRACT_VERSION, mode: live ? "live_anon_read_only" : "static_contract", verification_run_id: `${CONTRACT}:${compact}:${verifiedAt.replace(/\D/g, "")}`, canonical_run_id: `star_preopen:${compact}:canonical`, status: failed.length ? "failed" : complete ? "complete" : "pass", ok: failed.length === 0, complete, exitCode: complete || !live ? 0 : 1, trade_date: tradeDate, verified_at: verifiedAt, required_slots: REQUIRED_SLOTS, scan_scope: "all_selected_stock_future_near_contracts", display_limit_affects_scan: false, live_evidence: liveEvidence, checks, failed_checks: failed.map((check) => check.code), first_blocker: failed[0]?.code || null, credential_role: "anon_read_only", writes_supabase: false, calls_fugle: false, sends_telegram: false, uses_0900_data: false };
  if (writeReceipt) receipt.receipt_files = writeArtifacts(receipt);
  if (publish) { try { await publishReceipt(receipt); receipt.writes_supabase = true; receipt.published_receipt_view = "v_fugle_daytrade_star_verification_readback"; } catch (error) { receipt.status = "failed"; receipt.ok = false; receipt.complete = false; receipt.exitCode = 1; receipt.failed_checks = unique([...receipt.failed_checks, `RECEIPT_PUBLISH_FAILED:${error.message}`]); receipt.first_blocker ||= receipt.failed_checks[0]; } }
  console.log(JSON.stringify(receipt, null, 2)); if (!receipt.ok || (live && !receipt.complete)) process.exitCode = 1;
}

main().catch((error) => { console.error(JSON.stringify({ contract: CONTRACT, status: "failed", ok: false, complete: false, first_blocker: error.message }, null, 2)); process.exitCode = 1; });
