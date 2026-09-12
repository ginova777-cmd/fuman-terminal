"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_ROOT || process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_ROOT, "data", "scan-receipts");
const CURRENT_FILE = path.join(RUNTIME_ROOT, "data", "scorecard-terminal-current.json");
const CONTRACT_ONLY = process.argv.includes("--contract-only");
const slotArg = process.argv.find((value) => value.startsWith("--slot="));
const slot = String(slotArg || "").slice("--slot=".length);
const targetTradeDate = String(process.argv.find((value) => value.startsWith("--trade-date=")) || "").slice("--trade-date=".length)
  || process.env.FUMAN_SCORECARD_TRADE_DATE
  || "";
const allowedSlots = new Set(["12:40", "13:15", "17:00", "21:40"]);

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function compactDate(value) { return String(value || "").replace(/\D/g, ""); }
const expectedTradeDate = targetTradeDate || taipeiDate();
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function exists(relative) { return fs.existsSync(path.join(ROOT, relative)); }

const retiredVerifierFiles = [
  "scripts/verify-scorecard-seven-strategy-daily-history-contract.js",
  "scripts/verify-scorecard-seven-strategy-daily-history-live.js",
];
const packageText = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
const wrapperText = fs.readFileSync(path.join(ROOT, "scripts", "run-scorecard88-terminal-collector.ps1"), "utf8");
const issues = [];

for (const file of retiredVerifierFiles) if (exists(file)) issues.push(`retired_verifier_present:${file}`);
for (const marker of ["verify:scorecard-seven-strategy-daily-history", "verify-scorecard-seven-strategy-daily-history-"]) {
  if (packageText.includes(marker)) issues.push(`retired_verifier_package_reference:${marker}`);
}
if (!wrapperText.includes("verify-scorecard88-collection.js")) issues.push("canonical_verifier_not_wired_to_runner");
if (wrapperText.indexOf("collect-terminal-scorecard-88.js") > wrapperText.indexOf("verify-scorecard88-collection.js")) issues.push("canonical_verifier_runs_before_collector");

let receipt = null;
let current = null;
let receiptFile = "";
if (!CONTRACT_ONLY) {
  if (!allowedSlots.has(slot)) issues.push(`invalid_slot:${slot || "missing"}`);
  receiptFile = path.join(RECEIPT_DIR, `scorecard88-collection-${compactDate(expectedTradeDate)}-${slot.replace(":", "")}.json`);
  try { receipt = readJson(receiptFile); } catch { issues.push("collection_receipt_missing_or_unreadable"); }
  try { current = readJson(CURRENT_FILE); } catch { issues.push("scorecard_current_missing_or_unreadable"); }
  if (receipt) {
    if (receipt.status !== "PASS" || receipt.ok !== true) issues.push(`collection_receipt_not_pass:${receipt.status || "missing"}`);
    if (receipt.outputFileWritten !== true || receipt.blobPublished !== true || receipt?.blob?.currentPublished !== true) issues.push("collection_not_published");
    if (String(receipt.firstBlocker || "")) issues.push(`collection_first_blocker:${receipt.firstBlocker}`);
    const reports = Array.isArray(receipt.reports) ? receipt.reports : [];
    if (!reports.length) issues.push("collection_reports_missing");
    if (reports.some((row) => row.ok !== true || !row.runId || row.desktopStatus !== "PASS" || row.mobileStatus !== "PASS")) issues.push("collection_report_closure_invalid");
    if (reports.some((row) => row.desktopRunId !== row.runId || row.mobileRunId !== row.runId)) issues.push("collection_report_run_id_mismatch");
  }
  if (receipt && current) {
    if (String(current.latestDate || current.tradeDate || current.trade_date || "") !== expectedTradeDate) issues.push("scorecard_current_trade_date_mismatch");
    if (current.ok !== true) issues.push("scorecard_current_not_complete");
  }
}

const ok = issues.length === 0;
const verifierReceipt = {
  contract: "scorecard88-collection-verifier-v1",
  ok,
  status: ok ? "PASS" : "BLOCKED",
  checkedAt: new Date().toISOString(),
  tradeDate: expectedTradeDate,
  slot: slot || null,
  contractOnly: CONTRACT_ONLY,
  collectionReceipt: receiptFile || null,
  firstBlocker: issues[0] || "",
  issues,
  retiredVerifiers: retiredVerifierFiles,
};

if (!CONTRACT_ONLY && allowedSlots.has(slot)) {
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECEIPT_DIR, `scorecard88-verifier-${compactDate(expectedTradeDate)}-${slot.replace(":", "")}.json`), `${JSON.stringify(verifierReceipt, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(verifierReceipt, null, 2));
process.exit(ok ? 0 : 3);
