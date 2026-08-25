#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");
const marketAiLive = require("../api/market-ai-live");

const RUNTIME = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const OUT_DIR = path.join(RUNTIME, "data", "opening-report-0830");

function arg(name) {
  const prefix = "--" + name + "=";
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}
function todayYmd() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return get("year") + "-" + get("month") + "-" + get("day");
}
function compact(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeReceipt(date, payload) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, "opening-report-0830-terminal-briefing-closure-" + compact(date) + ".json");
  fs.writeFileSync(file, JSON.stringify({ ...payload, verifier_receipt: file }, null, 2));
  return file;
}

async function main() {
  const date = arg("trade-date") || todayYmd();
  const ymd = compact(date);
  const finalReceiptPath = path.join(OUT_DIR, "opening-report-0830-final-receipt-" + ymd + ".json");
  const finalReceipt = readJson(finalReceiptPath);
  const briefing = marketAiLive.__test.readOpeningMorningReport({ ymd });
  const snapshot = await readSnapshot("opening_report_0830_terminal_briefing", {
    tradeDate: date, allowLatestFallback: false, timeoutMs: 5000,
  });
  const snapshotPayload = snapshot?.payload || {};
  const desktopShell = fs.readFileSync(path.join(__dirname, "..", "terminal-desktop-fast-shell.js"), "utf8");
  const checks = [
    { name: "final_receipt_exists", ok: Boolean(finalReceipt) },
    { name: "report_core_ok", ok: finalReceipt?.report_core_ok === true },
    { name: "same_day_final_receipt", ok: finalReceipt?.date === date },
    { name: "terminal_reader_ok", ok: briefing?.ok === true },
    { name: "industry_bias_19_of_19", ok: Number(briefing?.industry_bias?.count || 0) === 19 },
    { name: "terminal_snapshot_exists", ok: Boolean(snapshot) },
    { name: "same_day_snapshot", ok: String(snapshot?.tradeDate || "") === ymd },
    { name: "same_run_id", ok: Boolean(finalReceipt?.run_id) && briefing?.run_id === finalReceipt.run_id && snapshot?.snapshotId === finalReceipt.run_id && snapshotPayload?.report_run_id === finalReceipt.run_id },
    { name: "snapshot_briefing_ok", ok: snapshotPayload?.ok === true && Number(snapshotPayload?.industry_bias?.count || 0) === 19 },
    { name: "watchlist_only", ok: finalReceipt?.watchlist_only === true && briefing?.allowed_action === "priority_scan_only" },
    { name: "formal_candidates_zero", ok: Number(finalReceipt?.formal_candidates || 0) === 0 && Number(briefing?.formal_candidates || 0) === 0 },
    { name: "desktop_renders_briefing_when_ai_blocked", ok: desktopShell.includes("renderOpeningReport0830DesktopBriefing(aiPayload);\n      return;") },
  ];
  const failed = checks.find((check) => !check.ok);
  const payload = {
    ok: !failed,
    contract: "opening_report_0830_terminal_briefing_closure_v1",
    checked_at: new Date().toISOString(),
    date,
    run_id: finalReceipt?.run_id || "",
    report_core_status: finalReceipt?.report_core_status || "",
    industry_bias_files: Number(briefing?.industry_bias?.count || 0),
    recommended_symbols: Array.isArray(briefing?.recommended_symbols) ? briefing.recommended_symbols.length : 0,
    line_delivery_warning: Array.isArray(briefing?.delivery_warnings) && briefing.delivery_warnings.includes("line_delivery_not_ok"),
    snapshot: snapshot ? {
      key: snapshot.key, trade_date: snapshot.tradeDate, snapshot_id: snapshot.snapshotId,
      updated_at: snapshot.updatedAt, reason: snapshot.reason,
    } : null,
    checks,
    failed_checks: checks.filter((check) => !check.ok).map((check) => check.name),
    first_blocker: failed?.name || null,
    reason_code: failed ? "opening_report_0830_terminal_briefing_closure_failed" : "opening_report_0830_terminal_briefing_closure_passed",
  };
  payload.verifier_receipt = writeReceipt(date, payload);
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}
main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
