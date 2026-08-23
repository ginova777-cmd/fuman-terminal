"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const ROOT = process.env.FUMAN_ROOT || "C:/fuman-terminal";

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const argDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
const tradeDate = argDate.replace(/\D/g, "").length === 8
  ? `${argDate.replace(/\D/g, "").slice(0, 4)}-${argDate.replace(/\D/g, "").slice(4, 6)}-${argDate.replace(/\D/g, "").slice(6, 8)}`
  : argDate;
const compactDate = tradeDate.replace(/\D/g, "").slice(0, 8);

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function runNode(script, args = [], timeout = 180000) {
  const child = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout,
    env: { ...process.env, FUMAN_RUNTIME_DIR: RUNTIME_DIR, FUMAN_ROOT: ROOT },
  });
  const stdout = String(child.stdout || "");
  let payload = null;
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { payload = JSON.parse(stdout.slice(start, end + 1)); } catch {}
  }
  return { exitCode: child.status ?? 1, payload, stdoutTail: stdout.slice(-1600), stderrTail: String(child.stderr || "").slice(-1600), error: child.error?.message || "" };
}

function runMarketGuard() {
  const child = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, "scripts", "check-market-calendar-action.js"), "--label=strategy3-v2-daily-closure", "--receipt"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    env: { ...process.env, FUMAN_RUNTIME_DIR: RUNTIME_DIR, FUMAN_ROOT: ROOT },
  });
  const stdout = String(child.stdout || "");
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  let payload = null;
  if (start >= 0 && end > start) {
    try { payload = JSON.parse(stdout.slice(start, end + 1)); } catch {}
  }
  return { closed: child.status === 10, exitCode: child.status ?? 1, payload, stderrTail: String(child.stderr || "").slice(-1600) };
}

function issue(issues, condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

function firstIssue(issues) {
  return issues[0]?.code || null;
}

function rowsOf(payload = {}) {
  return Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.matches) ? payload.matches : [];
}

const market = runMarketGuard();
const out = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-daily-unattended-closure-${compactDate}.json`);
if (market.closed) {
  const payload = {
    ok: true,
    status: "SKIPPED_MARKET_CLOSED",
    checked_at: new Date().toISOString(),
    contract: "strategy3-v2-daily-unattended-closure-v1",
    trade_date: tradeDate,
    strategy: "strategy3_v2",
    run_id: `strategy3v2-market-closed-${compactDate}`,
    count: 0,
    first: {},
    first_blocker: null,
    reason_code: "market_closed_preserve_previous_good",
    marketCalendar: market.payload,
    previous_good_preserved: true,
    issues: [],
  };
  writeJson(out, payload);
  console.log(JSON.stringify({ ...payload, receipt_path: out }, null, 2));
  process.exit(0);
}
if (market.exitCode !== 0) {
  const payload = {
    ok: false,
    status: "STRATEGY3_V2_DAILY_UNATTENDED_NO",
    checked_at: new Date().toISOString(),
    contract: "strategy3-v2-daily-unattended-closure-v1",
    trade_date: tradeDate,
    strategy: "strategy3_v2",
    first_blocker: "market_calendar_guard_failed",
    reason_code: "market_calendar_guard_failed",
    issues: [{ code: "market_calendar_guard_failed", exitCode: market.exitCode, stderrTail: market.stderrTail }],
  };
  writeJson(out, payload);
  console.log(JSON.stringify({ ...payload, receipt_path: out }, null, 2));
  process.exit(1);
}

const receipts = {
  guard1230: path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-readiness-guard-1230-${compactDate}.json`),
  guard1250: path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-readiness-guard-1250-${compactDate}.json`),
  firstAttempt1255: path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-first-attempt-1255-${compactDate}.json`),
  scan: path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-complete-scan-${compactDate}.json`),
  line: path.join(RUNTIME_DIR, "data", "line-cards", `strategy3-v2-line-card-${compactDate}.json`),
  threeSurfaceLine: path.join(RUNTIME_DIR, "data", "line-cards", `strategy3-v2-three-surface-line-closure-${compactDate}.json`),
};

const guard1230 = readJson(receipts.guard1230, null);
const guard1250 = readJson(receipts.guard1250, null);
const firstAttempt1255 = readJson(receipts.firstAttempt1255, null);
const scan = readJson(receipts.scan, null);
const line = readJson(receipts.line, null);
const threeSurfaceLine = readJson(receipts.threeSurfaceLine, null);
const surfaceRun = runNode("scripts/verify-strategy3-v2-surface-closure.js", [`--trade-date=${tradeDate}`], 120000);
const surface = surfaceRun.payload || {};
const firstAttemptRun = runNode("scripts/verify-strategy3-v2-1255-first-attempt.js", [`--trade-date=${tradeDate}`], 30000);
const firstAttemptVerify = firstAttemptRun.payload || {};
const firstAttemptEnforcedFrom = process.env.STRATEGY3_V2_1255_ENFORCED_FROM || "2026-08-21";
const requiresFirstAttempt = tradeDate >= firstAttemptEnforcedFrom;

const issues = [];
if (requiresFirstAttempt) {
  issue(issues, firstAttemptRun.exitCode === 0 && firstAttemptVerify.ok === true, "first_attempt_1255_verifier_failed", { exitCode: firstAttemptRun.exitCode, firstBlocker: firstAttemptVerify.first_blocker, stderrTail: firstAttemptRun.stderrTail });
  issue(issues, firstAttempt1255?.contract === "strategy3-v2-1255-first-attempt-wrapper-v1", "first_attempt_1255_missing_or_wrong_contract", { path: receipts.firstAttempt1255 });
  issue(issues, firstAttempt1255?.trade_date === tradeDate, "first_attempt_1255_trade_date_mismatch", { value: firstAttempt1255?.trade_date });
  issue(issues, firstAttempt1255?.formal_allowed === false && firstAttempt1255?.publish_allowed === false && firstAttempt1255?.line_push_allowed === false, "first_attempt_1255_privilege_guard_failed");
  issue(issues, firstAttempt1255?.retry_task === "Fuman Strategy3 V2 Complete Scan 1300", "first_attempt_1255_retry_target_mismatch", { value: firstAttempt1255?.retry_task });
}
issue(issues, guard1230?.contract === "strategy3-v2-readiness-guard-wrapper-v1", "readiness_guard_1230_missing_or_wrong_contract", { path: receipts.guard1230 });
issue(issues, guard1250?.contract === "strategy3-v2-readiness-guard-wrapper-v1", "readiness_guard_1250_missing_or_wrong_contract", { path: receipts.guard1250 });
issue(issues, guard1230?.legacy_strategy3_touched === false, "readiness_guard_1230_touched_legacy", { value: guard1230?.legacy_strategy3_touched });
issue(issues, guard1250?.legacy_strategy3_touched === false, "readiness_guard_1250_touched_legacy", { value: guard1250?.legacy_strategy3_touched });
issue(issues, guard1230?.line_push_allowed === false && guard1250?.line_push_allowed === false, "readiness_guard_line_push_not_forbidden");
issue(issues, scan?.ok === true && String(scan?.status || "").toUpperCase() === "COMPLETE", "complete_scan_not_complete", { path: receipts.scan, status: scan?.status, ok: scan?.ok });
issue(issues, String(scan?.run_id || "").startsWith("strategy3v2-"), "complete_scan_runid_not_v2", { run_id: scan?.run_id });
issue(issues, Number(scan?.result_count || 0) > 0 || (Array.isArray(scan?.results) && scan.results.length > 0), "complete_scan_results_empty", { result_count: scan?.result_count });
issue(issues, line?.ok === true && line?.status === "PUSHED", "line_not_pushed", { path: receipts.line, status: line?.status, ok: line?.ok });
issue(issues, line?.line_push_personal_ok === true, "line_personal_push_failed", { value: line?.line_push_personal_ok });
issue(issues, line?.line_push_group_ok === true, "line_group_push_failed", { value: line?.line_push_group_ok });
issue(issues, line?.token_logged === false && line?.target_logged === false, "line_secret_logged", { token_logged: line?.token_logged, target_logged: line?.target_logged });
issue(issues, surfaceRun.exitCode === 0 && surface.ok === true, "surface_closure_not_ready", { exitCode: surfaceRun.exitCode, status: surface.status, issues: surface.issues, stderrTail: surfaceRun.stderrTail });

const runId = surface?.canonical_api?.runId || "";
const count = Number(surface?.canonical_api?.count || 0);
issue(issues, scan?.run_id === runId, "complete_scan_runid_mismatch", { scan_run_id: scan?.run_id, expected: runId });
issue(issues, Number(scan?.result_count || 0) === count, "complete_scan_count_mismatch", { scan_count: scan?.result_count, expected: count });
const first = surface?.canonical_api?.first || {};
issue(issues, line?.run_id === runId, "line_runid_mismatch", { line_run_id: line?.run_id, expected: runId });
issue(issues, Number(line?.count || 0) === count, "line_count_mismatch", { line_count: line?.count, expected: count });
issue(issues, surface?.desktop_fast_bundle?.runId === runId, "desktop_fast_bundle_runid_mismatch", { desktop_run_id: surface?.desktop_fast_bundle?.runId, expected: runId });
issue(issues, Number(surface?.desktop_fast_bundle?.count || 0) === count, "desktop_fast_bundle_count_mismatch", { desktop_count: surface?.desktop_fast_bundle?.count, expected: count });
issue(issues, Number(surface?.mobile_fragment?.count || 0) === count, "mobile_fragment_count_mismatch", { mobile_count: surface?.mobile_fragment?.count, expected: count });
if (threeSurfaceLine) {
  issue(issues, threeSurfaceLine.run_id === runId, "three_surface_line_runid_mismatch", { closure_run_id: threeSurfaceLine.run_id, expected: runId });
  issue(issues, Number(threeSurfaceLine.count || 0) === count, "three_surface_line_count_mismatch", { closure_count: threeSurfaceLine.count, expected: count });
}

const payload = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "STRATEGY3_V2_DAILY_UNATTENDED_YES" : "STRATEGY3_V2_DAILY_UNATTENDED_NO",
  checked_at: new Date().toISOString(),
  contract: "strategy3-v2-daily-unattended-closure-v1",
  trade_date: tradeDate,
  strategy: "strategy3_v2",
  run_id: runId,
  count,
  first,
  first_blocker: firstIssue(issues),
  reason_code: issues.length === 0 ? "strategy3_v2_daily_unattended_yes" : firstIssue(issues),
  receipts,
  readiness_guards: {
    guard1230: guard1230 ? { status: guard1230.status, formal_allowed: guard1230.formal_allowed, scanner_can_run: guard1230.scanner_can_run, legacy_strategy3_touched: guard1230.legacy_strategy3_touched, reason_code: guard1230.reason_code } : null,
    guard1250: guard1250 ? { status: guard1250.status, formal_allowed: guard1250.formal_allowed, scanner_can_run: guard1250.scanner_can_run, legacy_strategy3_touched: guard1250.legacy_strategy3_touched, reason_code: guard1250.reason_code } : null,
    firstAttempt1255: { enforced: requiresFirstAttempt, enforced_from: firstAttemptEnforcedFrom, receipt: firstAttempt1255 ? { status: firstAttempt1255.status, formal_allowed: firstAttempt1255.formal_allowed, publish_allowed: firstAttempt1255.publish_allowed, line_push_allowed: firstAttempt1255.line_push_allowed, retry_task: firstAttempt1255.retry_task } : null, verifier: { exitCode: firstAttemptRun.exitCode, ok: firstAttemptVerify.ok, first_blocker: firstAttemptVerify.first_blocker || null } },
  },
  scan: scan ? { ok: scan.ok, status: scan.status, run_id: scan.run_id, result_count: scan.result_count } : null,
  surface: surface ? { ok: surface.ok, status: surface.status, canonical_api: surface.canonical_api, desktop_fast_bundle: surface.desktop_fast_bundle, mobile_fragment: surface.mobile_fragment } : null,
  line: line ? { ok: line.ok, status: line.status, run_id: line.run_id, count: line.count, line_push_ok: line.line_push_ok, line_push_personal_ok: line.line_push_personal_ok, line_push_group_ok: line.line_push_group_ok, token_logged: line.token_logged, target_logged: line.target_logged } : null,
  issues,
};

writeJson(out, payload);
console.log(JSON.stringify({ ...payload, receipt_path: out }, null, 2));
process.exitCode = payload.ok ? 0 : 1;


