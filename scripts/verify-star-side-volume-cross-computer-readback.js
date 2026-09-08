"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const URL_ROOT = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_ANON_KEY || process.env.FUMAN_SUPABASE_ANON_KEY || (() => {
  try { return fs.readFileSync(path.join(RUNTIME, "secrets", "supabase-anon-key.txt"), "utf8").trim(); } catch { return ""; }
})();
const tradeDate = value("trade-date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sideRun = value("side-volume-verification-run-id");
const starRun = value("star-verification-run-id");
const starSlot = value("star-slot");

function value(name) {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || "";
}

async function read(view, params) {
  const url = new URL(`${URL_ROOT}/rest/v1/${view}`);
  for (const [name, entry] of Object.entries(params)) url.searchParams.set(name, String(entry));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      const text = await response.text();
      if (!response.ok) throw new Error(`${view}_HTTP_${response.status}:${text.slice(0, 240)}`);
      return { http_status: response.status, rows: JSON.parse(text) || [], attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function readBoundRows(view, verificationRunId) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await read(view, { select: "*", verification_run_id: `eq.${verificationRunId}`, order: "symbol.asc", limit: 500, offset });
    rows.push(...page.rows);
    if (page.rows.length < 500) return { http_status: page.http_status, attempts: page.attempts, rows };
  }
}

function sample(rows, predicate) {
  const row = rows.find(predicate);
  if (!row) return null;
  return {
    verification_run_id: row.verification_run_id,
    symbol: row.symbol,
    in_mother_pool: row.in_mother_pool,
    quality_status: row.quality_status,
    threshold_status: row.threshold_status || null,
    first_blocker: row.first_blocker,
    inside_volume: row.inside_volume,
    outside_volume: row.outside_volume,
    side_volume_total: row.side_volume_total,
    side_volume_unit: row.side_volume_unit,
    side_volume_ge_2000_lots: row.side_volume_ge_2000_lots,
    side_volume_source_event_at: row.side_volume_source_event_at,
    source_event_age_seconds_at_verification: row.source_event_age_seconds_at_verification ?? null,
    source_fresh_120s_at_verification: row.source_fresh_120s_at_verification ?? null,
    failed_checks: row.failed_checks,
  };
}

function receiptSummary(row) {
  if (!row) return null;
  const fields = [
    "verification_run_id", "contract", "contract_version", "trade_date", "capture_slot",
    "canonical_slot_run_id", "canonical_run_id", "status", "complete", "exit_code",
    "source_common_valid", "published_at", "verified_at", "first_blocker", "failed_checks",
    "universe_count", "source_valid_count", "data_gap_count", "source_view", "symbol_result_view",
    "read_rows", "symbol_result_rows", "mother_pool_rows", "diagnostic_extra_rows", "ready_rows",
    "below_threshold_rows", "blocked_common_rows", "contract_complete_rows", "missing_field_rows",
    "wrong_trade_date_rows", "wrong_run_rows", "stale_rows", "threshold_met_rows",
  ];
  return Object.fromEntries(fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]));
}

async function latestReceipt(view, exactRun, extra = {}) {
  const params = exactRun
    ? { select: "*", verification_run_id: `eq.${exactRun}`, limit: 1 }
    : { select: "*", trade_date: `eq.${tradeDate}`, ...extra, order: "verified_at.desc", limit: 1 };
  const response = await read(view, params);
  return { ...response, row: response.rows[0] || null };
}

async function main() {
  if (!KEY) throw new Error("SUPABASE_ANON_KEY_MISSING");
  const failures = [];
  const starReceipt = await latestReceipt("v_fugle_daytrade_star_slot_verification_readback", starRun, starSlot ? { capture_slot: `eq.${starSlot}` } : {});
  const sideReceipt = await latestReceipt("v_fugle_daytrade_side_volume_verification_readback", sideRun, { canonical_run_id: `eq.fugle_daytrade_source:${tradeDate.replace(/\D/g, "")}:canonical` });

  const starRows = starReceipt.row ? await readBoundRows("v_fugle_daytrade_star_slot_symbol_readback", starReceipt.row.verification_run_id) : { rows: [] };
  const sideRows = sideReceipt.row ? await readBoundRows("v_fugle_daytrade_side_volume_symbol_readback", sideReceipt.row.verification_run_id) : { rows: [] };
  if (!starReceipt.row) failures.push("STAR_V2_RECEIPT_MISSING");
  if (!sideReceipt.row) failures.push("SIDE_VOLUME_V3_RECEIPT_MISSING");
  if (starReceipt.row && starReceipt.row.contract_version !== "slot-symbol-isolation-v2") failures.push("STAR_V2_CONTRACT_VERSION_MISMATCH");
  if (sideReceipt.row && sideReceipt.row.contract_version !== "cross-computer-symbol-isolation-v3") failures.push("SIDE_VOLUME_V3_CONTRACT_VERSION_MISMATCH");

  const legalFutureModes = ["natural_slot_snapshots_0845_through_current_slot"];
  const starModes = [...new Set(starRows.rows.map((row) => row?.technical_data?.future_pattern_evidence_mode).filter(Boolean))];
  const invalidStarModes = starModes.filter((mode) => !legalFutureModes.includes(mode));
  if (invalidStarModes.length) failures.push("STAR_FUTURE_PATTERN_EVIDENCE_MODE_INVALID");
  if (starReceipt.row && starRows.rows.length !== Number(starReceipt.row.universe_count)) failures.push("STAR_V2_SYMBOL_DENOMINATOR_MISMATCH");
  if (sideReceipt.row && sideRows.rows.length !== Number(sideReceipt.row.symbol_result_rows ?? sideRows.rows.length)) failures.push("SIDE_VOLUME_SYMBOL_DENOMINATOR_MISMATCH");
  const sideMotherRows = sideRows.rows.filter((row) => row.in_mother_pool !== false).length;
  const sideDiagnosticRows = sideRows.rows.filter((row) => row.in_mother_pool === false).length;

  const output = {
    contract: "star_v2_side_volume_v3_bound_readback_v3",
    trade_date: tradeDate,
    credential_role: "anon_read_only",
    bounded_retry_max: 3,
    batch_mixing_allowed: false,
    writes_supabase: false,
    schema_ok: failures.length === 0,
    natural_complete: starReceipt.row?.complete === true && sideReceipt.row?.complete === true,
    star_v2: {
      receipt_view: "v_fugle_daytrade_star_slot_verification_readback",
      symbol_view: "v_fugle_daytrade_star_slot_symbol_readback",
      requested_verification_run_id: starRun || null,
      receipt_http_status: starReceipt.http_status,
      receipt: receiptSummary(starReceipt.row),
      symbol_http_status: starRows.http_status || null,
      symbol_rows: starRows.rows.length,
      ready_rows: starRows.rows.filter((row) => row.quality_status === "READY").length,
      data_gap_rows: starRows.rows.filter((row) => row.quality_status === "DATA_GAP").length,
      blocked_common_rows: starRows.rows.filter((row) => row.quality_status === "BLOCKED_COMMON").length,
      legal_future_pattern_evidence_modes: legalFutureModes,
      observed_future_pattern_evidence_modes: starModes,
      invalid_future_pattern_evidence_modes: invalidStarModes,
      sample_ready: starRows.rows.find((row) => row.quality_status === "READY") || null,
      sample_data_gap: starRows.rows.find((row) => row.quality_status === "DATA_GAP") || null,
    },
    side_volume_v3: {
      receipt_view: "v_fugle_daytrade_side_volume_verification_readback",
      symbol_view: "v_fugle_daytrade_side_volume_symbol_readback",
      requested_verification_run_id: sideRun || null,
      receipt_http_status: sideReceipt.http_status,
      receipt: receiptSummary(sideReceipt.row),
      symbol_http_status: sideRows.http_status || null,
      symbol_result_rows: sideRows.rows.length,
      mother_pool_rows: sideMotherRows,
      diagnostic_extra_rows: sideDiagnosticRows,
      diagnostic_symbols: sideRows.rows.filter((row) => row.in_mother_pool === false).map((row) => row.symbol),
      ready_rows: sideRows.rows.filter((row) => row.quality_status === "READY").length,
      below_threshold_rows: sideRows.rows.filter((row) => row.quality_status === "READY" && row.side_volume_ge_2000_lots !== true).length,
      data_gap_rows: sideRows.rows.filter((row) => row.quality_status === "DATA_GAP").length,
      blocked_common_rows: sideRows.rows.filter((row) => row.quality_status === "BLOCKED_COMMON").length,
      sample_ready_ge_2000: sample(sideRows.rows, (row) => row.quality_status === "READY" && row.side_volume_ge_2000_lots === true),
      sample_ready_below_2000: sample(sideRows.rows, (row) => row.quality_status === "READY" && row.side_volume_ge_2000_lots !== true),
      sample_data_gap: sample(sideRows.rows, (row) => row.quality_status === "DATA_GAP"),
      sample_blocked_common: sample(sideRows.rows, (row) => row.quality_status === "BLOCKED_COMMON"),
      viewer_rule: "Use only the bound verification_run_id. READY below 2000 is NO_MATCH, DATA_GAP is unknown, BLOCKED_COMMON blocks the batch. Recheck live source_event age <=120s at decision time.",
    },
    status: failures.length ? "failed" : "readback_complete",
    complete: failures.length === 0,
    exitCode: failures.length ? 1 : 0,
    failed_checks: failures,
    first_blocker: failures[0] || null,
    checked_at: new Date().toISOString(),
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.complete) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ contract: "star_v2_side_volume_v3_bound_readback_v3", status: "failed", complete: false, exitCode: 1, failed_checks: [error.message], first_blocker: error.message }, null, 2));
  process.exitCode = 1;
});
