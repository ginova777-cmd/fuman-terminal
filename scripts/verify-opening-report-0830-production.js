"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");
const {
  EXPECTED_INDUSTRIES,
  OPENING_REPORT_0830_INDUSTRY_MAP,
  validateIndustryMapContract,
} = require("./opening-report-0830-industry-map-contract.js");

function listEqual(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every((value, index) => String(actual[index]) === String(value));
}

function symbolsByTier(input, tier) {
  return (Array.isArray(input?.mapped_symbols) ? input.mapped_symbols : [])
    .filter((row) => String(row.tier || "").toUpperCase() === tier)
    .map((row) => String(row.symbol || ""));
}

function verifyIndustryContract(receipt, issues) {
  const bridgeRows = Array.isArray(receipt?.bridge_results) ? receipt.bridge_results : [];
  if (bridgeRows.length !== EXPECTED_INDUSTRIES.length) issues.push("industry_contract_count_mismatch:" + bridgeRows.length + ":expected_" + EXPECTED_INDUSTRIES.length);
  const byIndustry = new Map(bridgeRows.map((row) => [row.industry, row]));
  EXPECTED_INDUSTRIES.forEach((expected, index) => {
    const row = byIndustry.get(expected.industry);
    if (!row) {
      issues.push("industry_contract_missing:" + expected.industry);
      return;
    }
    const input = readJson(row.inputPath);
    if (!input) {
      issues.push("industry_contract_input_missing:" + expected.industry);
      return;
    }
    if (input.priority_rank !== index + 1) issues.push("industry_priority_rank_mismatch:" + expected.industry + ":" + input.priority_rank + ":expected_" + (index + 1));
    if (!listEqual(input.overseas_leaders, expected.overseas)) issues.push("industry_overseas_leaders_mismatch:" + expected.industry);
    if (!listEqual(symbolsByTier(input, "A"), expected.a)) issues.push("industry_a_symbols_mismatch:" + expected.industry);
    if (!listEqual(symbolsByTier(input, "B"), expected.b)) issues.push("industry_b_symbols_mismatch:" + expected.industry);
  });
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}


function classifyMarketPercent(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return "來源不足";
  if (value >= 0.3) return "偏強";
  if (value <= -0.3) return "偏弱";
  return "中性";
}


function cutoffTimeMs(date) {
  const parsed = Date.parse(`${date}T08:30:59+08:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}
function verifyMarketSnapshot(snapshot, issues) {
  const validContracts = new Set([
    "opening-report-0830-market-snapshot-v1",
    "opening-report-0820-market-snapshot-v1",
  ]);
  if (!snapshot || !validContracts.has(snapshot.contract)) {
    issues.push("market_snapshot_missing_or_contract_invalid");
    return;
  }
  const rows = Array.isArray(snapshot.items) ? snapshot.items : [];
  if (!rows.length) issues.push("market_snapshot_items_missing");
  for (const row of rows) {
    if (!row.key || !row.label) issues.push(`market_snapshot_identity_missing:${row.key || row.label || "unknown"}`);
    if (!row.source_time) issues.push(`market_snapshot_source_time_missing:${row.key || row.label || "unknown"}`);
    if (!row.source_url) issues.push(`market_snapshot_source_url_missing:${row.key || row.label || "unknown"}`);
    const sourceMs = Date.parse(row.source_time || "");
    const cutoffMs = cutoffTimeMs(snapshot.date);
    if (Number.isFinite(sourceMs) && cutoffMs && sourceMs > cutoffMs) issues.push(`market_snapshot_after_cutoff:${row.key}:${row.source_time}`);
    if (!Number.isFinite(sourceMs)) issues.push(`market_snapshot_source_time_unparseable:${row.key || row.label || "unknown"}`);
    const hasPercent = row.percent !== null && row.percent !== undefined && String(row.percent).trim() !== "";
    const pct = Number(row.percent);
    if (hasPercent && Number.isFinite(pct)) {
      const expected = classifyMarketPercent(pct);
      if (row.display !== expected) issues.push(`market_snapshot_display_mismatch:${row.key}:${pct}:${row.display}:expected_${expected}`);
      if (pct >= 0.3 && /弱/.test(String(row.display || ""))) issues.push(`market_snapshot_positive_displayed_weak:${row.key}`);
      if (pct <= -0.3 && /強/.test(String(row.display || ""))) issues.push(`market_snapshot_negative_displayed_strong:${row.key}`);
    } else if (/偏強|偏弱/.test(String(row.display || ""))) {
      issues.push(`market_snapshot_direction_without_numeric:${row.key}:${row.display}`);
    }
  }
}
function pass(name, details = {}) {
  return { name, ok: true, status: "PASS", ...details };
}

function fail(name, reason_code, details = {}) {
  return { name, ok: false, status: "FAIL", reason_code, ...details };
}

function skip(name, reason_code, details = {}) {
  return { name, ok: true, status: "SKIP", reason_code, ...details };
}

function buildStageChecks(receipt, issues, compact, options = {}) {
  const stages = [];
  if (!receipt) {
    return [fail("final_receipt", "final_receipt_missing")];
  }

  const reportPathExists = Boolean(receipt.report_path && fs.existsSync(receipt.report_path));
  const reportCoreOk = receipt.report_core_ok !== false && receipt.overseas_sources_ok === true && reportPathExists;
  stages.push(reportCoreOk
    ? pass("report_core", { report_path: receipt.report_path, overseas_sources_ok: receipt.overseas_sources_ok })
    : fail("report_core", "opening_report_core_not_ready", { report_path: receipt.report_path || "", report_path_exists: reportPathExists, overseas_sources_ok: receipt.overseas_sources_ok, report_core_ok: receipt.report_core_ok }));

  const overseas = receipt.overseas_leader_detection || {};
  stages.push(
    overseas.ok === true && Number(overseas.valid_leaders) > 0 && Number(overseas.unavailable_leaders) === 0
      ? pass("overseas_leader_detection", {
        valid_leaders: overseas.valid_leaders,
        unavailable_leaders: overseas.unavailable_leaders,
        file: overseas.file || receipt.overseas_leader_detector?.file || ""
      })
      : fail("overseas_leader_detection", "overseas_leader_detection_not_clean", {
        ok: overseas.ok,
        valid_leaders: overseas.valid_leaders,
        unavailable_leaders: overseas.unavailable_leaders,
        file: overseas.file || receipt.overseas_leader_detector?.file || ""
      })
  );

  const bridgeRows = Array.isArray(receipt.bridge_results) ? receipt.bridge_results : [];
  const inputRows = bridgeRows.map((row) => ({ row, input: readJson(row.inputPath) }));
  const validInputs = inputRows.filter(({ input }) => input);
  const allDateAligned = validInputs.every(({ input }) => String(input.date || "").replace(/\D/g, "") === compact);
  const allPriorityOnly = validInputs.every(({ input }) =>
    input.source === "opening_report_0830"
    && input.mode === "priority_bias_only"
    && input.allowed_action === "boost_scan_priority_only"
    && input.forbidden_action === "publish_formal_candidate_without_taiwan_evidence"
  );
  stages.push(
    bridgeRows.length === EXPECTED_INDUSTRIES.length && validInputs.length === EXPECTED_INDUSTRIES.length && allDateAligned && allPriorityOnly
      ? pass("industry_bias_json_19_industries", {
        industries: bridgeRows.length,
        inputs_readable: validInputs.length,
        date_aligned: true,
        priority_bias_only: true
      })
      : fail("industry_bias_json_19_industries", "industry_bias_json_contract_failed", {
        industries: bridgeRows.length,
        inputs_readable: validInputs.length,
        date_aligned: allDateAligned,
        priority_bias_only: allPriorityOnly
      })
  );

  const lineReceipt = receipt.line_push_receipt ? readJson(receipt.line_push_receipt) : null;
  if (receipt.line_push_attempted) {
    stages.push(
      lineReceipt?.line_push_ok === true && lineReceipt?.token_logged === false && lineReceipt?.target_logged === false && Number(lineReceipt?.target_count || 0) >= 2 && lineReceipt?.has_user_target === true && lineReceipt?.has_group_target === true && receipt.line_message_type === "flex"
        ? pass("line_flex_card_push", {
          line_push_receipt: receipt.line_push_receipt,
          message_type: receipt.line_message_type,
          token_logged: lineReceipt.token_logged,
          target_logged: lineReceipt.target_logged,
          target_count: lineReceipt.target_count,
          delivered_count: lineReceipt.delivered_count,
          has_user_target: lineReceipt.has_user_target,
          has_group_target: lineReceipt.has_group_target
        })
        : fail("line_flex_card_push", "line_flex_card_push_failed_or_unsafe", {
          line_push_receipt: receipt.line_push_receipt,
          line_push_ok: lineReceipt?.line_push_ok,
          message_type: receipt.line_message_type,
          token_logged: lineReceipt?.token_logged,
          target_logged: lineReceipt?.target_logged,
          target_count: lineReceipt?.target_count,
          delivered_count: lineReceipt?.delivered_count,
          has_user_target: lineReceipt?.has_user_target,
          has_group_target: lineReceipt?.has_group_target
        })
    );
  } else if (options.requireLine) {
    stages.push(fail("line_flex_card_push", "line_push_required_but_not_attempted", {
      line_push_receipt: receipt.line_push_receipt || "",
      message_type: receipt.line_message_type || "",
      require_line: true
    }));
  } else {
    stages.push(skip("line_flex_card_push", "line_push_not_attempted", {
      line_push_receipt: receipt.line_push_receipt || "",
      message_type: receipt.line_message_type || ""
    }));
  }

  stages.push(
    receipt.terminal_briefing_snapshot?.ok === true
      ? pass("terminal_briefing_snapshot_sync", {
        snapshot_key: "opening_report_0830_terminal_briefing",
        run_id: receipt.run_id,
        snapshot_status: "PASS"
      })
      : fail("terminal_briefing_snapshot_sync", "terminal_briefing_snapshot_not_synced", {
        snapshot: receipt.terminal_briefing_snapshot || null
      })
  );

  if (receipt.mother_pool_bridge_attempted === true) {
    const bridgeReceipts = bridgeRows.map((row) => ({ row, receipt: readJson(row.receiptPath) }));
    const readable = bridgeReceipts.filter(({ receipt: bridgeReceipt }) => bridgeReceipt);
    const guardsOk = readable.length === EXPECTED_INDUSTRIES.length && readable.every(({ receipt: bridgeReceipt }) =>
      bridgeReceipt.validation?.ok === true
      && bridgeReceipt.forbidden_publish_guard === true
      && bridgeReceipt.formal_candidate_count === 0
      && bridgeReceipt.formal_candidate_allowed === false
      && bridgeReceipt.status === "priority_scan"
      && bridgeReceipt.reason_code === "opening_report_0830_industry_bias"
      && (bridgeReceipt.applied_boosts || []).every((boost) => Number(boost.applied_priority_rank) >= 41 && Number(boost.price) >= 50 && Number(boost.quote_age_seconds) <= 120)
    );
    stages.push(
      receipt.mother_pool_bridge_ok === true && guardsOk
        ? pass("mother_pool_priority_bias_bridge_handoff", {
          bridge_receipts: readable.length,
          forbidden_publish_guard: true,
          formal_candidate_count: 0,
          priority_rank_floor: 41
        })
        : skip("mother_pool_priority_bias_bridge_handoff", "mother_pool_bridge_fail_closed_optional_handoff", {
          bridge_ok: receipt.mother_pool_bridge_ok,
          bridge_receipts: readable.length,
          expected_receipts: EXPECTED_INDUSTRIES.length,
          guards_ok: guardsOk
        })
    );
  } else if (receipt.mother_pool_bridge_optional_handoff === true || receipt.stage_status?.mother_pool_priority_bias_bridge === "OPTIONAL_FAIL_CLOSED") {
    stages.push(skip("mother_pool_priority_bias_bridge_handoff", "mother_pool_bridge_optional_not_requested", {
      bridge_results: bridgeRows.length,
      optional_handoff: true
    }));
  } else {
    stages.push(fail("mother_pool_priority_bias_bridge", "mother_pool_bridge_not_attempted", {
      bridge_results: bridgeRows.length
    }));
  }

  stages.push(
    receipt.formal_candidates === 0 && receipt.watchlist_only === true
      ? pass("formal_publish_guard", {
        formal_candidates: receipt.formal_candidates,
        watchlist_only: receipt.watchlist_only,
        taiwan_gate_ok: receipt.taiwan_gate?.ok === true
      })
      : fail("formal_publish_guard", "formal_publish_guard_failed", {
        formal_candidates: receipt.formal_candidates,
        watchlist_only: receipt.watchlist_only
      })
  );

  stages.push(issues.length === 0
    ? pass("runid_closure_readback", { run_id: receipt.run_id, issues: 0 })
    : fail("runid_closure_readback", "verifier_issues_present", { run_id: receipt.run_id, issues: issues.length }));

  return stages;
}

function main() {
  const tradeDate = argValue("--date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const compact = tradeDate.replace(/\D/g, "");
  const requireLine = hasFlag("--require-line");
  const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${compact}.json`);
  const receipt = readJson(finalPath);
  const issues = [];
  const industryContractCheck = validateIndustryMapContract(OPENING_REPORT_0830_INDUSTRY_MAP);
  issues.push(...industryContractCheck.issues);
  if (!receipt) issues.push("final_receipt_missing");
  if (receipt && receipt.contract !== "opening-report-0830-production-v1") issues.push("contract_invalid");
  if (receipt && !receipt.run_id) issues.push("run_id_missing");
  if (receipt && receipt.date?.replace(/\D/g, "") !== compact) issues.push("date_mismatch");
  if (receipt && receipt.overseas_sources_ok !== true) issues.push("overseas_sources_not_ok");
  if (receipt && receipt.industry_bias_exported !== true) issues.push("industry_bias_not_exported");
  if (receipt) verifyMarketSnapshot(receipt.overseas_market_snapshot, issues);
  if (receipt && receipt.formal_candidates !== 0) issues.push("formal_candidates_not_zero_for_0830");
  if (receipt && receipt.watchlist_only !== true) issues.push("watchlist_only_not_true");
  if (receipt && receipt.report_path && !fs.existsSync(receipt.report_path)) issues.push("report_path_missing");
  const lineReceipt = receipt?.line_push_receipt ? readJson(receipt.line_push_receipt) : null;
  if (receipt?.line_push_attempted && lineReceipt?.line_push_ok !== true) issues.push("line_push_attempted_but_not_ok");
  if (lineReceipt && lineReceipt.token_logged !== false) issues.push("line_token_logging_guard_failed");
  if (receipt?.line_push_attempted && Number(lineReceipt?.target_count || 0) < 2) issues.push("line_target_count_less_than_2");
  if (receipt?.line_push_attempted && lineReceipt?.has_user_target !== true) issues.push("line_user_target_missing");
  if (receipt?.line_push_attempted && lineReceipt?.has_group_target !== true) issues.push("line_group_target_missing");
  if (lineReceipt && lineReceipt.target_logged !== false) issues.push("line_target_logging_guard_failed");
  if (receipt && receipt.terminal_briefing_snapshot?.ok !== true) issues.push("terminal_briefing_snapshot_not_synced");
  verifyIndustryContract(receipt, issues);
  const bridgeRows = Array.isArray(receipt?.bridge_results) ? receipt.bridge_results : [];
  for (const row of bridgeRows) {
    const input = readJson(row.inputPath);
    if (!input) issues.push(`bridge_input_missing:${row.industry}`);
    if (input && input.source !== "opening_report_0830") issues.push(`bridge_source_invalid:${row.industry}`);
    if (input && input.mode !== "priority_bias_only") issues.push(`bridge_mode_invalid:${row.industry}`);
    if (input && input.allowed_action !== "boost_scan_priority_only") issues.push(`bridge_allowed_action_invalid:${row.industry}`);
    if (input && input.forbidden_action !== "publish_formal_candidate_without_taiwan_evidence") issues.push(`bridge_forbidden_action_invalid:${row.industry}`);
    if (input && !(Number(input.confidence) >= 0 && Number(input.confidence) <= 1)) issues.push(`bridge_confidence_invalid:${row.industry}`);
  }
  const stageChecks = buildStageChecks(receipt, issues, compact, { requireLine });
  const failingStage = stageChecks.find((stage) => stage.status === "FAIL");
  const output = {
    ok: issues.length === 0 && !failingStage,
    contract: "opening-report-0830-production-v1-verifier",
    checked_at: new Date().toISOString(),
    final_receipt: finalPath,
    chain: "report_core -> overseas_leader_detection -> 19_industry_report -> line_flex_card -> industry_bias_json -> mother_pool_priority_bias_bridge",
    require_line: requireLine,
    stage_checks: stageChecks,
    first_blocker: failingStage?.name || "",
    reason_code: failingStage?.reason_code || "opening_report_0830_verifier_ok",
    receipt,
    issues
  };
  const verifierReceiptPath = path.join(RECEIPT_DIR, `opening-report-0830-verifier-${compact}.json`);
  fs.writeFileSync(verifierReceiptPath, JSON.stringify({ ...output, verifier_receipt: verifierReceiptPath }, null, 2), "utf8");
  console.log(JSON.stringify({ ...output, verifier_receipt: verifierReceiptPath }, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main();











