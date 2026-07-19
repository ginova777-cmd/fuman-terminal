"use strict";

const fs = require("fs");
const path = require("path");
const { buildPreflight } = require("./check-full-scan-date-preflight");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-predictive-preflight");
const CONTRACT = "terminal-predictive-preflight-v1";

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function normalizePredictivePreflight(raw = {}) {
  const action = String(raw.action || "");
  const status = String(raw.status || "");
  const reason = String(raw.reason || "");
  const scannerTargetDate = compactDate(raw.scannerTargetDate || raw.scannerTargetTradeDate);
  const displayTradeDate = compactDate(raw.displayTradeDate || raw.marketCalendar?.displayTradeDate || raw.marketDate);
  const taipeiToday = compactDate(raw.taipeiToday || raw.marketCalendar?.requestedDate);
  const marketDate = compactDate(raw.marketDate || raw.marketCalendar?.marketDate);
  const waitingSourceWindow = action === "skip_formal_scan" && raw.marketOpen === true && raw.sourceFreshnessRequired !== true;
  const marketClosed = (action === "skip_formal_scan" && !waitingSourceWindow) || status === "market_closed" || raw.marketOpen === false;
  const closedRepair = action === "allow_closed_target_repair" || raw.closedTargetRepair === true;
  const formalScanAllowed = action === "allow_formal_scan" || closedRepair;
  const failClosed = raw.ok !== true || action === "fail_closed" || status === "failed";
  const sourceFreshnessRequired = raw.sourceFreshnessRequired === true;
  let state = "BLOCKED_DATE_PREFLIGHT";
  if (formalScanAllowed && !failClosed) state = closedRepair ? "CLOSED_TARGET_REPAIR_ALLOWED" : "READY_FOR_FORMAL_SCAN";
  if (marketClosed && !closedRepair) state = "MARKET_CLOSED_SKIP_SCAN";
  if (waitingSourceWindow && !closedRepair) state = "TRADING_DAY_WAIT_SOURCE_WINDOW";
  if (failClosed) state = "BLOCKED_DATE_PREFLIGHT";

  const issues = [];
  if (!scannerTargetDate) issues.push("missing_scanner_target_date");
  if (!displayTradeDate) issues.push("missing_display_trade_date");
  if (failClosed && raw.publishAllowed === true) issues.push("fail_closed_publish_allowed_true");
  if (failClosed && raw.preservePreviousGood !== true) issues.push("fail_closed_without_preserve_previous_good");
  if (marketClosed && !closedRepair && raw.latestPointerUpdated === true) issues.push("market_closed_latest_pointer_updated");
  if (marketClosed && !closedRepair && raw.emptyResultWritten === true) issues.push("market_closed_empty_result_written");
  if (formalScanAllowed && !closedRepair && scannerTargetDate !== taipeiToday) {
    issues.push(`formal_scan_target_not_taipei_today:${scannerTargetDate || "missing"}:${taipeiToday || "missing"}`);
  }
  if (formalScanAllowed && !closedRepair && marketDate && marketDate !== scannerTargetDate) {
    issues.push(`market_date_target_mismatch:${marketDate}:${scannerTargetDate}`);
  }

  const ok = issues.length === 0 && (
    (formalScanAllowed && raw.publishAllowed === true && raw.evidenceStatus === "complete")
    || (waitingSourceWindow && raw.preservePreviousGood === true && raw.formalScanSkipped === true && raw.publishAllowed !== true)
    || (marketClosed && raw.preservePreviousGood === true && raw.formalScanSkipped === true)
    || (closedRepair && raw.publishAllowed === true)
    || (failClosed && raw.publishAllowed !== true && raw.preservePreviousGood === true)
  );

  return {
    contract: CONTRACT,
    ok,
    state,
    status,
    action,
    reason,
    checkedAt: new Date().toISOString(),
    runner: raw.runner || raw.label || "full-scan",
    taipeiToday,
    marketOpen: raw.marketOpen === true,
    marketStatus: raw.marketStatus || raw.marketCalendar?.marketStatus || "",
    marketDate,
    displayTradeDate,
    scannerTargetDate,
    scannerTargetTradeDate: scannerTargetDate,
    sourceDate: compactDate(raw.sourceDate),
    formalScanAllowed,
    formalScanSkipped: raw.formalScanSkipped === true,
    sourceFreshnessRequired,
    publishAllowed: raw.publishAllowed === true,
    preservePreviousGood: raw.preservePreviousGood === true,
    latestPointerUpdated: raw.latestPointerUpdated === true,
    emptyResultWritten: raw.emptyResultWritten === true,
    evidenceStatus: raw.evidenceStatus || "",
    unattendedStatus: raw.unattendedStatus || "NO",
    closedReason: raw.closedReason || raw.marketCalendar?.closedReason || "",
    closedReasonText: raw.closedReasonText || raw.marketCalendar?.closedReasonText || "",
    env: raw.env || {},
    issues,
    rawPreflight: raw,
  };
}

async function buildPredictivePreflight(options = {}) {
  const raw = await buildPreflight(options);
  return normalizePredictivePreflight(raw);
}

function markdown(payload) {
  const lines = [];
  lines.push("# Terminal Predictive Preflight");
  lines.push("");
  lines.push(`- contract: ${payload.contract}`);
  lines.push(`- ok: ${payload.ok}`);
  lines.push(`- state: ${payload.state}`);
  lines.push(`- action: ${payload.action}`);
  lines.push(`- reason: ${payload.reason || "--"}`);
  lines.push(`- taipeiToday: ${payload.taipeiToday}`);
  lines.push(`- displayTradeDate: ${payload.displayTradeDate}`);
  lines.push(`- scannerTargetDate: ${payload.scannerTargetDate}`);
  lines.push(`- formalScanAllowed: ${payload.formalScanAllowed}`);
  lines.push(`- preservePreviousGood: ${payload.preservePreviousGood}`);
  lines.push(`- publishAllowed: ${payload.publishAllowed}`);
  lines.push(`- sourceFreshnessRequired: ${payload.sourceFreshnessRequired}`);
  lines.push("");
  lines.push("## Issues");
  if (!payload.issues.length) lines.push("- none");
  for (const issue of payload.issues) lines.push(`- ${issue}`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const payload = await buildPredictivePreflight({});
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const jsonFile = path.join(OUT_DIR, "terminal-predictive-preflight.json");
  const mdFile = path.join(OUT_DIR, "terminal-predictive-preflight.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(payload), "utf8");
  console.log(JSON.stringify({
    ok: payload.ok,
    state: payload.state,
    action: payload.action,
    reason: payload.reason,
    scannerTargetDate: payload.scannerTargetDate,
    displayTradeDate: payload.displayTradeDate,
    formalScanAllowed: payload.formalScanAllowed,
    preservePreviousGood: payload.preservePreviousGood,
    output: jsonFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[terminal-predictive-preflight] failed: ${error.stack || error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  CONTRACT,
  normalizePredictivePreflight,
  buildPredictivePreflight,
};
