"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TARGET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date()).reduce((value, part) => {
  if (part.type !== "literal") value[part.type] = part.value;
  return value;
}, {});
const TRADE_DATE = TARGET_DATE.year + "-" + TARGET_DATE.month + "-" + TARGET_DATE.day;

function parseJsonOutput(stdout) {
  const text = String(stdout || "").trim();
  const match = text.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function runStage(key, scriptName, args = []) {
  const child = spawnSync(process.execPath, [
    "--use-system-ca",
    path.join(ROOT, "scripts", scriptName),
    ...args,
  ], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    env: processEnv(),
  });
  const payload = parseJsonOutput(child.stdout);
  const errorText = String(child.stderr || "").trim();
  const issues = Array.isArray(payload?.issues)
    ? payload.issues
    : Array.isArray(payload?.verification?.issues)
      ? payload.verification.issues
      : payload?.error
        ? [payload.error]
        : errorText
          ? [errorText.slice(0, 700)]
          : [];
  return {
    key,
    ok: child.status === 0 && payload?.ok === true,
    exitCode: child.status,
    payload,
    issues,
  };
}

function processEnv() {
  return { ...process.env };
}

function dateOf(value) {
  const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function enforce(stage) {
  const payload = stage.payload || {};
  const issues = [...stage.issues];

  if (stage.key === "strategy2_1m_water") {
    if (payload.status !== "ready_for_strategy3") issues.push("strategy2_1m_status_not_ready_for_strategy3");
    if (payload.publishAllowedForStrategy3 !== true) issues.push("strategy2_1m_publish_not_allowed_for_strategy3");
    if (!(Number(payload.readyCount) >= Number(payload.strategy3MinReady))) issues.push("strategy2_1m_ready_count_below_strategy3_threshold");
  }

  if (stage.key === "strategy3_complete_scan") {
    if (dateOf(payload.scanDate) !== TRADE_DATE) issues.push("strategy3_complete_scan_date_not_today");
    if (!String(payload.runId || "").includes(TRADE_DATE.replace(/-/g, ""))) issues.push("strategy3_complete_scan_runId_not_today");
    if (!(Number(payload.count) > 0)) issues.push("strategy3_complete_scan_count_empty");
  }

  if (stage.key === "entry_1m_evidence") {
    if (dateOf(payload.scanDate) !== TRADE_DATE) issues.push("strategy3_entry_evidence_date_not_today");
    if (payload.entryWindow !== "12:59-13:02") issues.push("strategy3_entry_window_contract_invalid");
    if (!(Number(payload.exactCount) + Number(payload.toleranceCount) > 0)) issues.push("strategy3_entry_evidence_empty");
    if (payload.line?.runId !== payload.runId) issues.push("strategy3_line_runId_mismatch");
    if (Number(payload.line?.count) !== Number(payload.count)) issues.push("strategy3_line_count_mismatch");
  }

  if (stage.key === "desktop_mobile_scorecard") {
    if (payload.expectedTradeDate !== TRADE_DATE) issues.push("surface_expected_date_mismatch");
    if (payload.verification?.ok !== true) issues.push("desktop_mobile_scorecard_alignment_failed");
    if (payload.mobileStrategy3?.status !== 200) issues.push("authenticated_mobile_fragment_not_readable");
    if (payload.mobileStrategy3?.runId !== payload.strategy3SourceReport?.runId) issues.push("authenticated_mobile_fragment_runId_mismatch");
    if (Number(payload.mobileStrategy3?.count) !== Number(payload.strategy3SourceReport?.resultCount)) issues.push("authenticated_mobile_fragment_count_mismatch");
    if (payload.mobileStrategy3?.formalDisplayAllowed !== true) issues.push("authenticated_mobile_fragment_formal_display_not_allowed");
  }

  return { ...stage, ok: stage.ok && issues.length === 0, issues };
}

const stages = [
  ["strategy2_1m_water", "check-strategy2-daytrade-1m-chain.js"],
  ["strategy3_complete_scan", "verify-strategy3-canonical-closure.js"],
  ["entry_1m_evidence", "verify-strategy3-entry-window-evidence.js"],
  ["scan_churn", "verify-strategy3-list-source-churn.js"],
  ["desktop_mobile_scorecard", "verify-daytrade-strategy3-closure-live.js", ["--require-authenticated-mobile"]],
].map(([key, scriptName, args]) => enforce(runStage(key, scriptName, args || [])));

const issues = stages.flatMap((stage) => stage.issues.map((issue) => stage.key + ":" + issue));
const result = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "STRATEGY3_FORMAL_CLOSURE_PASS" : "STRATEGY3_FORMAL_CLOSURE_FAIL",
  contract: "strategy3-water-scan-desktop-mobile-scorecard-v1",
  tradeDate: TRADE_DATE,
  stages: stages.map((stage) => ({
    key: stage.key,
    ok: stage.ok,
    exitCode: stage.exitCode,
    runId: stage.payload?.runId || stage.payload?.strategy3SourceReport?.runId || "",
    scanDate: stage.payload?.scanDate || stage.payload?.expectedTradeDate || "",
    count: stage.payload?.count ?? stage.payload?.strategy3SourceReport?.resultCount ?? 0,
    issues: stage.issues,
  })),
  issues,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
