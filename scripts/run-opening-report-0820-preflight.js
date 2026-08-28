"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");
const {
  CONTRACT,
  OPENING_REPORT_0830_INDUSTRY_MAP,
  validateIndustryMapContract,
} = require("./opening-report-0830-industry-map-contract.js");
const { summarizeReceiptFreshness } = require("../lib/opening-report-asia-freshness");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function taipeiHm(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.hour}:${byType.minute}`;
}
function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const match = process.argv.find((item) => item === name || item.startsWith(prefix));
  return match === name ? "1" : (match ? match.slice(prefix.length) : fallback);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function calendarDateAt(value, time) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  const iso = digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : taipeiDateKey();
  return new Date(`${iso}T${time}:00+08:00`);
}

async function main() {
  const tradeDate = argValue("--date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const compact = tradeDate.replace(/\D/g, "");
  const runId = argValue("--run-id", `opening-report-0820-preflight-${compact}-${Date.now()}`);
  const selfTest = process.argv.includes("--self-test");
  const taipeiTime = taipeiHm();
  const marketCalendar = await buildMarketCalendarContract({ now: calendarDateAt(tradeDate, "08:20"), stateDir: path.join(RUNTIME_DIR, "state") });
  const calendarAllowsPreflight = marketCalendar.tradingDayOpen === true;
  const withinPreflightWindow = selfTest || (taipeiTime >= "08:20" && taipeiTime < "08:30");
  const shouldRunDetector = calendarAllowsPreflight && withinPreflightWindow;
  const mapCheck = validateIndustryMapContract(OPENING_REPORT_0830_INDUSTRY_MAP);
  const detector = shouldRunDetector
    ? spawnSync(process.execPath, [
      path.join(ROOT, "scripts", "run-opening-report-0830-overseas-leader-detector.js"),
      `--date=${tradeDate}`,
      `--run-id=${runId}`,
    ], { cwd: ROOT, encoding: "utf8", env: process.env, timeout: 420000, windowsHide: true })
    : { status: 2, stdout: "", stderr: calendarAllowsPreflight ? "outside_0820_preflight_window" : "market_calendar_non_trading_day" };
  const detectorPath = path.join(RECEIPT_DIR, `overseas-leaders-0830-${compact}.json`);
  const detectorReceipt = readJson(detectorPath);
  const detectorFreshness = summarizeReceiptFreshness(detectorReceipt, tradeDate);
  const detectorHasStalePromotion = detectorFreshness.stale_promoted_count > 0;
  const preservedDetectorPath = path.join(RECEIPT_DIR, `opening-report-0820-overseas-leaders-${compact}.json`);
  if (shouldRunDetector && detector.status === 0 && detectorReceipt) writeJson(preservedDetectorPath, detectorReceipt);
  const marketSnapshotRunner = shouldRunDetector
    ? spawnSync(process.execPath, [
      path.join(ROOT, "scripts", "run-opening-report-0830-production.js"),
      "--freeze-market-snapshot",
      `--date=${tradeDate}`,
      `--run-id=${runId}`,
    ], { cwd: ROOT, encoding: "utf8", env: process.env, timeout: 420000, windowsHide: true })
    : { status: 2, stdout: "", stderr: calendarAllowsPreflight ? "outside_0820_preflight_window" : "market_calendar_non_trading_day" };
  const frozenMarketSnapshotPath = path.join(RECEIPT_DIR, `opening-report-0820-market-snapshot-${compact}.json`);
  const frozenMarketSnapshot = readJson(frozenMarketSnapshotPath);
  const marketSnapshotOk = shouldRunDetector && marketSnapshotRunner.status === 0
    && String(frozenMarketSnapshot?.date || "").replace(/\D/g, "") === compact
    && String(frozenMarketSnapshot?.cutoff || "").includes("08:20:00 Asia/Taipei")
    && Array.isArray(frozenMarketSnapshot?.items) && frozenMarketSnapshot.items.length >= 4;
  const receiptPath = path.join(RECEIPT_DIR, `opening-report-0820-preflight-receipt-${compact}.json`);
  const skippedForMarketClosed = !calendarAllowsPreflight;
  const ok = skippedForMarketClosed || (withinPreflightWindow && mapCheck.ok === true && detector.status === 0 && detectorReceipt?.ok === true && !detectorHasStalePromotion && marketSnapshotOk);
  const receipt = {
    contract: "opening-report-0820-preflight-v2",
    ok,
    phase: skippedForMarketClosed ? "skip_non_trading_day_no_terminal_no_line_no_bridge" : "preflight_only_no_terminal_no_telegram_no_codex_no_bridge",
    market_calendar: marketCalendar,
    skipped_for_market_closed: skippedForMarketClosed,
    no_terminal_no_line_no_industry_bias_no_bridge: skippedForMarketClosed,
    date: tradeDate,
    run_id: runId,
    started_at: new Date().toISOString(),
    taipei_time: taipeiTime,
    within_0820_preflight_window: withinPreflightWindow,
    calendar_allows_preflight: calendarAllowsPreflight,
    formal_publish_time: `${tradeDate} 08:30:00 Asia/Taipei`,
    evidence_cutoff: `${tradeDate} 08:20:00 Asia/Taipei`,
    industry_contract: CONTRACT,
    industry_count: OPENING_REPORT_0830_INDUSTRY_MAP.length,
    map_contract_ok: mapCheck.ok === true,
    map_contract_issues: mapCheck.issues,
    overseas_detector_exit_code: detector.status ?? 9009,
    overseas_detector_error: detector.error?.message || "",
    overseas_detector_stderr_tail: String(detector.stderr || "").slice(-2000),
    market_snapshot_exit_code: marketSnapshotRunner.status ?? 9009,
    market_snapshot_error: marketSnapshotRunner.error?.message || "",
    market_snapshot_stderr_tail: String(marketSnapshotRunner.stderr || "").slice(-2000),
    frozen_market_snapshot_receipt: frozenMarketSnapshotPath,
    frozen_market_snapshot_ok: marketSnapshotOk,
    overseas_detector_receipt: detectorPath,
    preserved_overseas_detector_receipt: preservedDetectorPath,
    overseas_detector_ok: shouldRunDetector && detectorReceipt?.ok === true && !detectorHasStalePromotion,
    overseas_source_gap_count: shouldRunDetector ? detectorFreshness.source_gap_count : 0,
    overseas_stale_promoted_count: shouldRunDetector ? detectorFreshness.stale_promoted_count : 0,
    overseas_stale_promoted: shouldRunDetector ? detectorFreshness.stale_promoted : [],
    valid_leaders: shouldRunDetector ? (detectorReceipt?.valid_leaders ?? 0) : 0,
    total_leaders: shouldRunDetector ? (detectorReceipt?.total_leaders ?? 0) : 0,
    reason_code: skippedForMarketClosed ? "market_calendar_non_trading_day" : (detectorHasStalePromotion ? "opening_report_0820_stale_asia_leader_promoted" : (ok ? (detectorFreshness.source_gap_count ? "opening_report_0820_preflight_ok_with_source_gaps" : "opening_report_0820_preflight_ok") : "opening_report_0820_preflight_fail_closed")),
    next_action: skippedForMarketClosed ? "skip_all_report_actions_until_next_trading_day" : "08:30 delivery must consume only this frozen 08:20 evidence and publish terminal_plus_telegram_plus_codex",
  };
  writeJson(receiptPath, { ...receipt, receipt_path: receiptPath });
  console.log(JSON.stringify({ ok, receipt_path: receiptPath, run_id: runId, phase: receipt.phase, reason_code: receipt.reason_code, valid_leaders: receipt.valid_leaders, total_leaders: receipt.total_leaders }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  const tradeDate = argValue("--date", process.env.FUMAN_TRADE_DATE || taipeiDateKey());
  const compact = tradeDate.replace(/\D/g, "");
  const receiptPath = path.join(RECEIPT_DIR, `opening-report-0820-preflight-receipt-${compact}.json`);
  const payload = {
    contract: "opening-report-0820-preflight-v2",
    ok: false,
    phase: "preflight_only_no_terminal_no_telegram_no_codex_no_bridge",
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    reason_code: "opening_report_0820_preflight_runner_error",
    error: error?.stack || error?.message || String(error),
    receipt_path: receiptPath,
  };
  try { writeJson(receiptPath, payload); } catch {}
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
