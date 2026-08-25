"use strict";

const fs = require("fs");
const path = require("path");

const CONTRACT = "opening_limit_order_0831_prewarm_schedule_readonly_v2";
const TERMINAL_DIR = process.env.FUMAN_TERMINAL_DIR || "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = path.join(RUNTIME_DIR, "data", "opening-limit-order");
const VALID_TRENDS = new Set(["us_up_1d_and_2d", "us_up_1d_only", "us_up_2d_only", "us_not_strong", "missing_opening_report_mapping"]);

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}
function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function dashDate(value) { const c = compactDate(value); return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}` : ""; }
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function readText(file) { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return { __read_error: error?.message || String(error) }; } }
function exists(file) { try { return fs.existsSync(file); } catch { return false; } }
function array(value) { return Array.isArray(value) ? value : []; }
function finiteOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function hasUsPending(row) {
  return array(row?.pending_confirmation_rules).some((item) => item?.required_confirmation === "us_sector_up_1d");
}

function main() {
  const tradeDate = dashDate(arg("trade-date", taipeiDate()));
  const compact = compactDate(tradeDate);
  const requireRuntime = arg("require-runtime", "1") !== "0";
  const requireFiles = Number(arg("require-industry-files", "19"));
  const wrapperPath = path.join(TERMINAL_DIR, "ops", "Run-OpeningLimitOrder0831OpeningReportPrewarmReadonly.ps1");
  const staticPrefilterScriptPath = path.join(TERMINAL_DIR, "scripts", "build-opening-limit-order-static-prefilter.js");
  const receiptPath = arg("receipt", path.join(DATA_DIR, `opening-limit-order-0831-opening-report-prewarm-${compact}.json`));
  const preflightPath = arg("preflight", path.join(DATA_DIR, `opening-limit-order-0850-preflight-${compact}.json`));
  const staticPrefilterReceiptPath = arg("static-prefilter", path.join(DATA_DIR, `opening-limit-order-0850-static-prefilter-${compact}.json`));
  const failures = [];
  const rowFailures = [];

  if (!exists(wrapperPath)) failures.push("0831_prewarm_wrapper_missing");
  if (!exists(staticPrefilterScriptPath)) failures.push("static_prefilter_script_missing");
  const wrapper = readText(wrapperPath);
  const staticPrefilterScript = readText(staticPrefilterScriptPath);

  if (!wrapper.includes("0831_opening_report_auto_prewarm")) failures.push("0831_phase_missing");
  if (!wrapper.includes("Run-OpeningLimitOrder0850PreflightReadonly.ps1")) failures.push("0831_does_not_call_0850_preflight");
  if (!wrapper.includes("opening_report_files_accepted")) failures.push("0831_receipt_opening_report_readback_missing");
  if (!wrapper.includes("creates_order = $false") || !wrapper.includes("creates_formal_candidate = $false") || !wrapper.includes("publish_allowed = $false")) failures.push("0831_action_guard_missing");

  const requiredScriptTokens = [
    "opening_report_priority_observation",
    "priority_observation_symbol_count",
    "strong_sector_return_1d",
    "strong_sector_symbol_count",
    "sector_return_1d_pct",
    "sector_return_2d_pct",
    "us_sector_up_1d_symbol_count",
    "us_sector_up_2d_symbol_count",
    "us_sector_trend",
    "us_return_1d_pct",
    "us_return_2d_pct",
    "else if (!reportPresent) pendingRules.push",
  ];
  for (const token of requiredScriptTokens) {
    if (!staticPrefilterScript.includes(token)) failures.push(`static_prefilter_missing_token:${token}`);
  }

  let receipt = null;
  let preflight = null;
  let staticPrefilter = null;
  let reportRows = [];
  let strongRows = [];
  let us1Rows = [];
  let us2Rows = [];
  let mappedRowsWithBadEvidence = [];
  let mappedRowsWithBadPending = [];

  if (requireRuntime) {
    if (!exists(receiptPath)) failures.push("0831_receipt_missing");
    if (!exists(preflightPath)) failures.push("0850_preflight_receipt_missing");
    if (!exists(staticPrefilterReceiptPath)) failures.push("0850_static_prefilter_receipt_missing");

    receipt = readJson(receiptPath);
    preflight = readJson(preflightPath);
    staticPrefilter = readJson(staticPrefilterReceiptPath);

    if (receipt?.__read_error) failures.push(`0831_receipt_unreadable:${receipt.__read_error}`);
    if (preflight?.__read_error) failures.push(`0850_preflight_unreadable:${preflight.__read_error}`);
    if (staticPrefilter?.__read_error) failures.push(`0850_static_prefilter_unreadable:${staticPrefilter.__read_error}`);

    if (dashDate(receipt?.trade_date) !== tradeDate) failures.push("0831_receipt_trade_date_mismatch");
    if (dashDate(preflight?.trade_date) !== tradeDate) failures.push("0850_preflight_trade_date_mismatch");
    if (dashDate(staticPrefilter?.trade_date) !== tradeDate) failures.push("0850_static_prefilter_trade_date_mismatch");

    if (receipt?.ok !== true) failures.push("0831_receipt_ok_not_true");
    if (preflight?.ok !== true) failures.push("0850_preflight_ok_not_true");
    if (staticPrefilter?.ok !== true) failures.push("0850_static_prefilter_ok_not_true");

    if (receipt?.creates_order !== false || receipt?.creates_formal_candidate !== false || receipt?.publish_allowed !== false) failures.push("0831_action_guard_failed");
    if (staticPrefilter?.action_guard?.creates_order !== false || staticPrefilter?.action_guard?.creates_formal_candidate !== false || staticPrefilter?.action_guard?.publish_allowed !== false) failures.push("static_prefilter_action_guard_failed");

    const rb = staticPrefilter?.opening_report_readback || {};
    if (Number(rb.industry_bias_files_accepted || 0) < requireFiles) failures.push("opening_report_accepted_files_below_required");
    if (Number(rb.mapped_symbol_count || 0) < 1) failures.push("opening_report_mapped_symbols_missing");
    if (Number(rb.priority_observation_symbol_count || 0) !== Number(rb.mapped_symbol_count || 0)) failures.push("priority_observation_count_mismatch_mapped_symbols");
    if (!Number.isFinite(Number(rb.strong_sector_symbol_count))) failures.push("strong_sector_symbol_count_missing");
    if (!Number.isFinite(Number(rb.us_sector_up_1d_symbol_count))) failures.push("us_sector_up_1d_symbol_count_missing");
    if (!Number.isFinite(Number(rb.us_sector_up_2d_symbol_count))) failures.push("us_sector_up_2d_symbol_count_missing");
    if (!Array.isArray(rb.strong_industries)) failures.push("strong_industries_readback_missing");

    if (Number(receipt?.opening_report_files_accepted || 0) < requireFiles) failures.push("0831_opening_report_files_below_required");
    if (Number(receipt?.opening_report_mapped_symbol_count || 0) < 1) failures.push("0831_opening_report_mapped_symbols_missing");
    if (receipt?.strong_sector_return_readback !== true) failures.push("0831_strong_sector_readback_missing");
    if (receipt?.us_sector_up_1d_2d_trend_readback !== true) failures.push("0831_us_sector_trend_readback_missing");

    const rows = array(staticPrefilter?.rows);
    reportRows = rows.filter((row) => row?.evidence?.opening_report_priority_observation === true || array(row?.evidence?.opening_report_industries).length > 0);
    strongRows = reportRows.filter((row) => row?.evidence?.strong_sector_return_1d === true);
    us1Rows = reportRows.filter((row) => row?.evidence?.us_sector_up_1d === true);
    us2Rows = reportRows.filter((row) => row?.evidence?.us_sector_up_2d === true);
    if (reportRows.length < 1) failures.push("static_prefilter_opening_report_rows_missing");

    mappedRowsWithBadEvidence = reportRows.filter((row) => {
      const ev = row.evidence || {};
      return !array(ev.opening_report_run_ids).length
        || !array(ev.opening_report_industries).length
        || ev.opening_report_priority_observation !== true
        || !VALID_TRENDS.has(String(ev.us_sector_trend || ""))
        || finiteOrNull(ev.sector_return_1d_pct) === null
        || finiteOrNull(ev.sector_return_2d_pct) === null
        || typeof ev.strong_sector_return_1d !== "boolean"
        || typeof ev.us_sector_up_1d !== "boolean"
        || typeof ev.us_sector_up_2d !== "boolean";
    });
    if (mappedRowsWithBadEvidence.length) failures.push("opening_report_row_evidence_incomplete");

    mappedRowsWithBadPending = reportRows.filter((row) => hasUsPending(row));
    if (mappedRowsWithBadPending.length) failures.push("mapped_opening_report_rows_still_pending_us_sector_up_1d");

    if (Number(rb.strong_sector_symbol_count || 0) !== strongRows.length) failures.push("strong_sector_symbol_count_mismatch_rows");
    if (Number(rb.us_sector_up_1d_symbol_count || 0) !== us1Rows.length) failures.push("us_sector_up_1d_symbol_count_mismatch_rows");
    if (Number(rb.us_sector_up_2d_symbol_count || 0) !== us2Rows.length) failures.push("us_sector_up_2d_symbol_count_mismatch_rows");

    for (const row of mappedRowsWithBadEvidence.slice(0, 30)) rowFailures.push(`${row.symbol}:opening_report_evidence_incomplete`);
    for (const row of mappedRowsWithBadPending.slice(0, 30)) rowFailures.push(`${row.symbol}:mapped_row_should_not_pending_us_sector_up_1d`);
  }

  if (rowFailures.length) failures.push("opening_report_row_failures");

  const result = {
    ok: failures.length === 0,
    contract: CONTRACT,
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    wrapper_path: wrapperPath,
    receipt_path: receiptPath,
    static_prefilter_path: staticPrefilterReceiptPath,
    runtime_readback: requireRuntime ? {
      receipt_ok: receipt?.ok ?? null,
      opening_report_files_accepted: receipt?.opening_report_files_accepted ?? null,
      opening_report_mapped_symbol_count: receipt?.opening_report_mapped_symbol_count ?? null,
      static_prefilter_opening_report_files_accepted: staticPrefilter?.opening_report_readback?.industry_bias_files_accepted ?? null,
      static_prefilter_mapped_symbol_count: staticPrefilter?.opening_report_readback?.mapped_symbol_count ?? null,
      priority_observation_symbol_count: staticPrefilter?.opening_report_readback?.priority_observation_symbol_count ?? null,
      strong_sector_symbol_count: staticPrefilter?.opening_report_readback?.strong_sector_symbol_count ?? null,
      us_sector_up_1d_symbol_count: staticPrefilter?.opening_report_readback?.us_sector_up_1d_symbol_count ?? null,
      us_sector_up_2d_symbol_count: staticPrefilter?.opening_report_readback?.us_sector_up_2d_symbol_count ?? null,
      opening_report_rows_in_static_prefilter: reportRows.length,
      strong_sector_rows_in_static_prefilter: strongRows.length,
      us_sector_up_1d_rows_in_static_prefilter: us1Rows.length,
      us_sector_up_2d_rows_in_static_prefilter: us2Rows.length,
      rows_with_incomplete_opening_report_evidence: mappedRowsWithBadEvidence.length,
      mapped_rows_still_pending_us_sector_up_1d: mappedRowsWithBadPending.length,
      creates_order: receipt?.creates_order ?? null,
      creates_formal_candidate: receipt?.creates_formal_candidate ?? null,
      publish_allowed: receipt?.publish_allowed ?? null,
      first_blocker: receipt?.first_blocker ?? null,
    } : null,
    row_failures: rowFailures,
    failed_checks: failures,
    first_blocker: failures[0] || null,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main();
