"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const live = process.argv.includes("--live");
const argDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || "";
const tradeDate = argDate.replace(/\D/g, "").length === 8
  ? `${argDate.replace(/\D/g, "").slice(0, 4)}-${argDate.replace(/\D/g, "").slice(4, 6)}-${argDate.replace(/\D/g, "").slice(6, 8)}`
  : argDate;
const compactDate = tradeDate.replace(/\D/g, "").slice(0, 8);
const issues = [];

function add(condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}
function text(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}
function json(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function taskXml(name) {
  try {
    return execFileSync("schtasks.exe", ["/Query", "/TN", name, "/XML"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  } catch { return ""; }
}

const runner = path.join(ROOT, "run-strategy3-v2-readiness-guard.ps1");
const installer = path.join(ROOT, "scripts", "install-strategy3-v2-readiness-guard-tasks.ps1");
const closure = path.join(ROOT, "scripts", "verify-strategy3-v2-daily-unattended-closure.js");
const registry = path.join(ROOT, "scripts", "fuman-schedule-registry.json");
const runnerText = text(runner);
const installerText = text(installer);
const closureText = text(closure);
const registryText = text(registry);

add(fs.existsSync(runner), "strategy3_v2_readiness_guard_runner_missing", { runner });
add(fs.existsSync(installer), "strategy3_v2_readiness_guard_installer_missing", { installer });
add(runnerText.includes('"strategy3-v2-readiness-guard-wrapper-v1"'), "strategy3_v2_readiness_guard_contract_missing");
add(runnerText.includes('"scripts\\check-strategy3-v2-readiness.js"'), "strategy3_v2_readiness_guard_source_check_missing");
add(runnerText.includes("formal_allowed = $false"), "strategy3_v2_readiness_guard_formal_guard_missing");
add(runnerText.includes("publish_allowed = $false"), "strategy3_v2_readiness_guard_publish_guard_missing");
add(runnerText.includes("line_push_allowed = $false"), "strategy3_v2_readiness_guard_line_guard_missing");
add(runnerText.includes("legacy_strategy3_touched = $false"), "strategy3_v2_readiness_guard_legacy_guard_missing");
for (const [name, time, phase] of [["Fuman Strategy3 V2 Readiness Guard 1230", "12:30", "1230"], ["Fuman Strategy3 V2 Readiness Guard 1250", "12:50", "1250"]]) {
  add(installerText.includes(name), "strategy3_v2_readiness_guard_task_missing_in_installer", { name });
  add(installerText.includes(`Time = "${time}"`), "strategy3_v2_readiness_guard_task_time_missing_in_installer", { name, time });
  add(installerText.includes(`Phase = "${phase}"`), "strategy3_v2_readiness_guard_task_phase_missing_in_installer", { name, phase });
  add(closureText.includes(`strategy3-v2-readiness-guard-${phase}-`), "strategy3_v2_readiness_guard_receipt_not_required_by_closure", { phase });
}
add(registryText.includes("Fuman Strategy3 V2 Daily Closure Verify 1310"), "strategy3_v2_daily_closure_1310_missing_from_registry");
add(!registryText.includes("Fuman Strategy3 V2 Daily Closure Verify 1315"), "strategy3_v2_daily_closure_1315_still_in_registry");

const liveEvidence = [];
if (live) {
  for (const [name, time] of [["Fuman Strategy3 V2 Readiness Guard 1230", "12:30:00"], ["Fuman Strategy3 V2 Readiness Guard 1250", "12:50:00"]]) {
    const xml = taskXml(name);
    const ok = xml.includes(name) && xml.includes(time) && xml.includes("run-strategy3-v2-readiness-guard.ps1") && !/<Enabled>false<\/Enabled>/i.test(xml);
    add(ok, "strategy3_v2_readiness_guard_task_not_live", { name, time });
    liveEvidence.push({ name, installed: Boolean(xml), action_ok: xml.includes("run-strategy3-v2-readiness-guard.ps1"), time_ok: xml.includes(time), enabled: Boolean(xml) && !/<Enabled>false<\/Enabled>/i.test(xml) });
  }
}

const receipts = [];
if (compactDate) {
  for (const phase of ["1230", "1250"]) {
    const receiptPath = path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-readiness-guard-${phase}-${compactDate}.json`);
    const receipt = json(receiptPath);
    add(receipt?.contract === "strategy3-v2-readiness-guard-wrapper-v1", "strategy3_v2_readiness_guard_receipt_missing_or_invalid", { phase, receiptPath });
    add(receipt?.trade_date === tradeDate, "strategy3_v2_readiness_guard_receipt_trade_date_mismatch", { phase, value: receipt?.trade_date, expected: tradeDate });
    add(receipt?.formal_allowed === false && receipt?.publish_allowed === false && receipt?.line_push_allowed === false && receipt?.legacy_strategy3_touched === false, "strategy3_v2_readiness_guard_receipt_privilege_guard_failed", { phase });
    receipts.push({ phase, receipt_path: receiptPath, status: receipt?.status || null, scanner_can_run: receipt?.scanner_can_run ?? null });
  }
}

const payload = {
  ok: issues.length === 0,
  contract: "strategy3_v2_readiness_guard_contract_v1",
  checked_at: new Date().toISOString(),
  read_only: true,
  live,
  trade_date: tradeDate || null,
  static_contract: {
    runner,
    installer,
    daily_closure_1310: registryText.includes("Fuman Strategy3 V2 Daily Closure Verify 1310"),
    guard_phases: ["1230", "1250"],
    no_formal_or_publish_or_line: true,
  },
  live_evidence: liveEvidence,
  receipts,
  failed_checks: issues.map((issue) => issue.code),
  first_blocker: issues[0]?.code || null,
  issues,
};
console.log(JSON.stringify(payload, null, 2));
process.exitCode = payload.ok ? 0 : 1;
