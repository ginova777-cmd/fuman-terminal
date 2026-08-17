"use strict";

const {
  STRATEGY,
  CONTRACT_VERSION,
  taipeiDate,
  nowTaipeiIso,
  readJson,
  writeJson,
  scanReceiptPath,
  lineReceiptPath,
  failClosed,
} = require("./strategy3-v2-contract");

const date = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const compactDate = date.replace(/\D/g, "");
const dryRun = process.argv.includes("--dry-run");
const scan = readJson(scanReceiptPath(compactDate), null);

let receipt;
if (!scan || scan.ok !== true || scan.status !== "COMPLETE") {
  receipt = failClosed("strategy3_v2_scan_not_publishable", {
    checked_at: nowTaipeiIso(),
    date: compactDate,
    dry_run: dryRun,
    scan_receipt_found: Boolean(scan),
    scan_status: scan?.status || "missing",
    run_id: scan?.run_id || "",
    message_type: "flex",
    line_push_ok: false,
    line_card_design_contract: {
      version: "strategy3-v2-line-card-overnight-reference-v1",
      title: "隔日沖參考",
      forbidden_titles: ["日內當沖進出場參考", "日內當沖參考"],
      layout: "white_stock_card_pink_panel_six_box",
      source_contract: "Strategy3 V2 complete scan readback only; legacy Strategy3 result tables are forbidden",
    },
  });
} else {
  receipt = {
    ok: dryRun,
    strategy: STRATEGY,
    contract: CONTRACT_VERSION,
    checked_at: nowTaipeiIso(),
    date: compactDate,
    dry_run: dryRun,
    status: dryRun ? "DRY_RUN_READY" : "READY_BUT_PUSH_NOT_IMPLEMENTED",
    run_id: scan.run_id,
    count: scan.result_count || 0,
    message_type: "flex",
    line_push_ok: false,
    line_card_design_contract: {
      version: "strategy3-v2-line-card-overnight-reference-v1",
      title: "隔日沖參考",
      forbidden_titles: ["日內當沖進出場參考", "日內當沖參考"],
      layout: "white_stock_card_pink_panel_six_box",
      source_contract: "Strategy3 V2 complete scan readback only; legacy Strategy3 result tables are forbidden",
    },
  };
}

const file = writeJson(lineReceiptPath(compactDate, dryRun ? ".dry-run" : ""), receipt);
console.log(JSON.stringify({ ...receipt, receipt_path: file }, null, 2));
process.exitCode = receipt.ok || dryRun ? 0 : 1;