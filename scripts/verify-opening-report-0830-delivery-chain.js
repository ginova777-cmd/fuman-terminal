"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function pass(name, details = {}) {
  return { name, ok: true, status: "PASS", ...details };
}

function fail(name, reason_code, details = {}) {
  return { name, ok: false, status: "FAIL", reason_code, ...details };
}

function targetTypes(lineReceipt) {
  return (Array.isArray(lineReceipt?.target_types) ? lineReceipt.target_types : [])
    .map((value) => String(value || "").toLowerCase());
}

function hasUserTarget(lineReceipt) {
  const types = targetTypes(lineReceipt);
  return lineReceipt?.has_user_target === true || types.includes("user") || types.includes("u");
}

function hasGroupTarget(lineReceipt) {
  const types = targetTypes(lineReceipt);
  return lineReceipt?.has_group_target === true || types.includes("group") || types.includes("c");
}

function targetLoggingSafe(lineReceipt) {
  if (!lineReceipt) return false;
  if (lineReceipt.target_logged === false) return true;
  if (lineReceipt.target_logged === true) return false;
  const serialized = JSON.stringify(lineReceipt);
  return !/[UC][0-9a-f]{20,}/i.test(serialized);
}

function main() {
  const tradeDate = argValue("--date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const compact = compactDate(tradeDate);
  const finalPath = path.join(RECEIPT_DIR, `opening-report-0830-final-receipt-${compact}.json`);
  const finalReceipt = readJson(finalPath);
  const lineReceipt = finalReceipt?.line_push_receipt ? readJson(finalReceipt.line_push_receipt) : null;
  const terminalVerifierPath = path.join(RECEIPT_DIR, `opening-report-0830-terminal-briefing-verifier-${compact}.json`);
  const terminalVerifier = readJson(terminalVerifierPath);
  const checks = [];

  checks.push(finalReceipt?.contract === "opening-report-0830-production-v1"
    && finalReceipt?.date?.replace(/\D/g, "") === compact
    && finalReceipt?.report_status === "REPORT_OK"
    && finalReceipt?.overseas_sources_ok === true
    && finalReceipt?.industry_bias_exported === true
    && finalReceipt?.report_path
    && fs.existsSync(finalReceipt.report_path)
    ? pass("report_file_and_core_receipt", {
      final_receipt: finalPath,
      report_path: finalReceipt.report_path,
      run_id: finalReceipt.run_id
    })
    : fail("report_file_and_core_receipt", "opening_report_core_receipt_not_ready", {
      final_receipt: finalPath,
      contract: finalReceipt?.contract || "",
      report_status: finalReceipt?.report_status || "",
      report_path: finalReceipt?.report_path || ""
    }));

  const deliveredOk = Number(lineReceipt?.delivered_count || lineReceipt?.target_count || 0) >= Number(lineReceipt?.target_count || 0);
  checks.push(finalReceipt?.line_push_attempted === true
    && finalReceipt?.line_push_ok === true
    && finalReceipt?.line_message_type === "flex"
    && lineReceipt?.line_push_ok === true
    && lineReceipt?.token_logged === false
    && targetLoggingSafe(lineReceipt)
    && Number(lineReceipt?.target_count || 0) >= 2
    && deliveredOk
    && hasUserTarget(lineReceipt)
    && hasGroupTarget(lineReceipt)
    ? pass("line_personal_and_group_flex_delivery", {
      line_push_receipt: finalReceipt.line_push_receipt,
      message_type: finalReceipt.line_message_type,
      target_count: lineReceipt.target_count,
      delivered_count: lineReceipt.delivered_count || lineReceipt.target_count,
      has_user_target: true,
      has_group_target: true,
      token_logged: lineReceipt.token_logged,
      target_logged: lineReceipt.target_logged === undefined ? false : lineReceipt.target_logged
    })
    : fail("line_personal_and_group_flex_delivery", "line_personal_or_group_delivery_not_proven", {
      line_push_receipt: finalReceipt?.line_push_receipt || "",
      line_push_ok: lineReceipt?.line_push_ok,
      message_type: finalReceipt?.line_message_type || "",
      target_count: lineReceipt?.target_count,
      delivered_count: lineReceipt?.delivered_count,
      has_user_target: hasUserTarget(lineReceipt),
      has_group_target: hasGroupTarget(lineReceipt),
      token_logged: lineReceipt?.token_logged,
      target_logged: lineReceipt?.target_logged
    }));

  const finalSnapshotOk = finalReceipt?.terminal_briefing_snapshot?.ok === true;
  const verifierSnapshotOk = terminalVerifier?.ok === true
    && terminalVerifier?.briefing_status === "PASS"
    && compactDate(terminalVerifier?.date) === compact
    && (!finalReceipt?.run_id || !terminalVerifier?.run_id || terminalVerifier.run_id === finalReceipt.run_id);
  checks.push(finalSnapshotOk || verifierSnapshotOk
    ? pass("terminal_0830_briefing_display_readback", {
      final_snapshot_ok: finalSnapshotOk,
      terminal_verifier: terminalVerifierPath,
      terminal_verifier_status: terminalVerifier?.briefing_status || "",
      run_id: finalReceipt?.run_id || terminalVerifier?.run_id || ""
    })
    : fail("terminal_0830_briefing_display_readback", "terminal_0830_briefing_display_not_proven", {
      final_snapshot: finalReceipt?.terminal_briefing_snapshot || null,
      terminal_verifier: terminalVerifierPath,
      terminal_verifier_status: terminalVerifier?.briefing_status || ""
    }));

  checks.push(finalReceipt?.formal_candidates === 0 && finalReceipt?.watchlist_only === true
    ? pass("formal_publish_guard_0830", {
      formal_candidates: finalReceipt.formal_candidates,
      watchlist_only: finalReceipt.watchlist_only
    })
    : fail("formal_publish_guard_0830", "opening_report_created_formal_candidate", {
      formal_candidates: finalReceipt?.formal_candidates,
      watchlist_only: finalReceipt?.watchlist_only
    }));

  const firstFailure = checks.find((check) => !check.ok);
  const output = {
    ok: !firstFailure,
    contract: "opening-report-0830-delivery-chain-verifier-v1",
    checked_at: new Date().toISOString(),
    date: compact,
    chain: "report_file -> terminal_0830_display -> line_personal_and_group_flex",
    first_blocker: firstFailure?.name || "",
    reason_code: firstFailure?.reason_code || "opening_report_0830_delivery_chain_ok",
    checks
  };
  const receiptPath = path.join(RECEIPT_DIR, `opening-report-0830-delivery-chain-verifier-${compact}.json`);
  fs.writeFileSync(receiptPath, JSON.stringify({ ...output, verifier_receipt: receiptPath }, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...output, verifier_receipt: receiptPath }, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main();
