"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const REPORT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function hasFlag(name) { return process.argv.includes(name); }
function task(name) {
  const result = spawnSync("schtasks.exe", ["/Query", "/TN", name, "/V", "/FO", "LIST"], { encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, text: `${result.stdout || ""}\n${result.stderr || ""}` };
}
function taskXml(name) {
  const result = spawnSync("schtasks.exe", ["/Query", "/TN", name, "/XML"], { encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, text: `${result.stdout || ""}\n${result.stderr || ""}` };
}
function stage(name, ok, details = {}) { return { name, ok: ok === true, status: ok === true ? "PASS" : "FAIL", ...details }; }

const tradeDate = process.env.FUMAN_TRADE_DATE || taipeiDate();
const ymd = compact(tradeDate);
const scriptPath = path.join(ROOT, "scripts", "run-opening-report-0820-preflight.js");
const script = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";
const preflight = readJson(path.join(REPORT_DIR, `opening-report-0820-preflight-receipt-${ymd}.json`));
const leaders = readJson(path.join(REPORT_DIR, `opening-report-0820-overseas-leaders-${ymd}.json`));
const snapshot = readJson(path.join(REPORT_DIR, `opening-report-0820-market-snapshot-${ymd}.json`));
const t = task("Fuman Opening Report 0820 Preflight");
const x = taskXml("Fuman Opening Report 0820 Preflight");
const requireCurrent = hasFlag("--require-current");

const checks = [
  stage("script_exists", fs.existsSync(scriptPath), { scriptPath }),
  stage("script_syntax", spawnSync(process.execPath, ["--check", scriptPath], { encoding: "utf8", windowsHide: true }).status === 0),
  stage("script_freeze_only", script.includes("preflight_only_no_terminal_no_telegram_no_codex_no_bridge") && script.includes("opening-report-0820-overseas-leaders") && script.includes("opening-report-0820-market-snapshot") && !script.includes("pushLine(") && !script.includes("terminal_plus_line")),
  stage("script_fail_closed_observability", script.includes("opening_report_0820_preflight_runner_error") && script.includes("overseas_detector_stderr_tail") && script.includes("market_snapshot_stderr_tail") && script.includes("timeout: 420000") && script.includes("writeJson(receiptPath, payload)")),
  stage("script_asia_source_gap_isolation", script.includes("summarizeReceiptFreshness") && script.includes("detectorHasStalePromotion") && script.includes("opening_report_0820_preflight_ok_with_source_gaps")),
  stage("task_exists", t.ok),
  stage("task_points_to_script", t.text.includes("run-opening-report-0820-preflight.js") && t.text.includes("C:\\fuman-release-owner\\fuman-terminal")),
  stage("task_0820_daily", x.ok && x.text.includes("T08:20:00+08:00")),
];
if (requireCurrent) {
  const marketClosed = preflight?.reason_code === "market_calendar_non_trading_day";
  checks.push(stage("current_preflight_receipt", preflight?.ok === true && compact(preflight.date) === ymd, { reason_code: preflight?.reason_code || "" }));
  checks.push(stage("current_evidence_cutoff", marketClosed || String(preflight?.evidence_cutoff || "").includes("08:20:00 Asia/Taipei")));
  const stalePromoted = (leaders?.industries || []).flatMap((industry) => industry?.leaders || []).filter((leader) => leader?.ok === true && /\.(?:T|KS)$/i.test(String(leader?.yahoo_symbol || "")) && !String(leader?.source_freshness?.reason_code || "").includes("asia_source_in_0800_0820_window"));
  checks.push(stage("current_overseas_leaders", marketClosed || (leaders?.ok === true && Array.isArray(leaders?.industries) && leaders.industries.length === 19)));
  checks.push(stage("current_no_stale_asia_promoted", marketClosed || stalePromoted.length === 0, { stale_promoted_count: stalePromoted.length }));
  checks.push(stage("current_market_snapshot", marketClosed || (snapshot?.ok === true && Array.isArray(snapshot?.items) && snapshot.items.length >= 4)));
}
const failed = checks.filter((row) => !row.ok);
const out = {
  ok: failed.length === 0,
  contract: "opening-report-0820-preflight-verifier-v1",
  checked_at: new Date().toISOString(),
  date: tradeDate,
  mode: requireCurrent ? "static_and_current" : "static",
  first_blocker: failed[0]?.name || "",
  reason_code: failed.length ? `opening_report_0820_${failed[0].name}` : "opening_report_0820_preflight_verified",
  checks,
};
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(path.join(REPORT_DIR, `opening-report-0820-preflight-verifier-${ymd}.json`), `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);

