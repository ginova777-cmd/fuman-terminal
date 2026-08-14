"use strict";

const path = require("path");
const fs = require("fs");
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
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
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

function taipeiClock() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${value.hour || "00"}:${value.minute || "00"}`;
}

function aggregateScorecardDue() {
  return taipeiClock() >= "22:45";
}
function dateOf(value) {
  const match = String(value || "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function enforce(stage) {
  const payload = stage.payload || {};
  const issues = [...stage.issues];


  if (stage.key === "strategy3_mother_pool_water") {
    if (payload.ready !== true) issues.push("strategy3_mother_pool_hydration_not_ready");
    if (payload.source !== "strategy2_daytrade_mother_pool:fugle_daytrade_intraday_1m") issues.push("strategy3_mother_pool_source_invalid");
    if (Number(payload.dataGapCount || 0) !== (Array.isArray(payload.dataGaps) ? payload.dataGaps.length : 0)) issues.push("strategy3_mother_pool_data_gap_count_mismatch");
  }

  if (stage.key === "strategy3_complete_scan") {
    if (dateOf(payload.scanDate) !== TRADE_DATE) issues.push("strategy3_complete_scan_date_not_today");
    if (!String(payload.runId || "").includes(TRADE_DATE.replace(/-/g, ""))) issues.push("strategy3_complete_scan_runId_not_today");
    if (!(Number(payload.count) > 0)) issues.push("strategy3_complete_scan_count_empty");
  }

  if (stage.key === "entry_1m_evidence") {
    if (dateOf(payload.scanDate) !== TRADE_DATE) issues.push("strategy3_entry_evidence_date_not_today");
    if (payload.entryWindow !== "12:59-13:02_or_12:45-12:58_tail_volume") issues.push("strategy3_entry_window_contract_invalid");
    if (!(Number(payload.exactCount) + Number(payload.toleranceCount) + Number(payload.tailVolumeCount) > 0)) issues.push("strategy3_entry_evidence_empty");
    if (payload.line?.runId !== payload.runId) issues.push("strategy3_line_runId_mismatch");
    if (Number(payload.line?.count) !== Number(payload.count)) issues.push("strategy3_line_count_mismatch");
  }

  if (stage.key === "strategy3_scorecard_source") {
    if (dateOf(payload.scanDate) !== TRADE_DATE) issues.push("strategy3_scorecard_date_not_today");
    if (!payload.runId || !String(payload.runId).includes(TRADE_DATE.replace(/-/g, ""))) issues.push("strategy3_scorecard_runId_not_today");
    if (!(Number(payload.count) > 0)) issues.push("strategy3_scorecard_count_empty");
    if (Number(payload.scorecard?.records) !== Number(payload.count)) issues.push("strategy3_scorecard_records_not_aligned");
  }
  if (stage.key === "strategy3_scorecard_production" && !stage.deferred) {
    if (dateOf(payload.latestDate) !== TRADE_DATE) issues.push("strategy3_scorecard_production_date_not_today");
    if (!payload.runId || !String(payload.runId).includes(TRADE_DATE.replace(/-/g, ""))) issues.push("strategy3_scorecard_production_runId_not_today");
    if (Number(payload.records) !== Number(payload.count)) issues.push("strategy3_scorecard_production_records_not_aligned");
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

const stageDefinitions = [
  ["strategy3_mother_pool_water", "verify-strategy3-mother-pool-hydration.js"],
  ["strategy3_complete_scan", "verify-strategy3-canonical-closure.js"],
  ["entry_1m_evidence", "verify-strategy3-entry-window-evidence.js"],
  ["scan_churn", "verify-strategy3-list-source-churn.js"],
  ["strategy3_scorecard_source", "verify-strategy3-scorecard-source.js"],
  ["desktop_mobile_scorecard", "verify-daytrade-strategy3-closure-live.js", ["--require-authenticated-mobile"]],
];
const stages = stageDefinitions.map(([key, scriptName, args]) => {
  const stage = runStage(key, scriptName, args || []);
  return enforce(stage);
});

/* legacy stage list retained below for source review only.
  ["strategy2_1m_water", "check-strategy2-daytrade-1m-chain.js"],
  ["strategy3_mother_pool_water", "verify-strategy3-mother-pool-hydration.js"],
  ["strategy3_complete_scan", "verify-strategy3-canonical-closure.js"],
  ["entry_1m_evidence", "verify-strategy3-entry-window-evidence.js"],
  ["scan_churn", "verify-strategy3-list-source-churn.js"],
  ["strategy3_scorecard_source", "verify-strategy3-scorecard-source.js"],
  ["strategy3_scorecard_production", "verify-strategy3-scorecard-production.js"],
  ["desktop_mobile_scorecard", "verify-daytrade-strategy3-closure-live.js", ["--require-authenticated-mobile"]],
].map(([key, scriptName, args]) => enforce(runStage(key, scriptName, args || []))); */

const scanStage = stages.find((stage) => stage.key === "strategy3_complete_scan")?.payload || {};
const scorecardStage = stages.find((stage) => stage.key === "strategy3_scorecard_source")?.payload || {};
const surfaceStage = stages.find((stage) => stage.key === "desktop_mobile_scorecard")?.payload || {};
const runnerContract = fs.readFileSync(path.join(ROOT, "run-strategy3-complete-scan.ps1"), "utf8");
const runnerContractIssues = [];
if (!/STRATEGY3_ALLOW_READY_SNAPSHOT\s*=\s*'0'/.test(runnerContract)) runnerContractIssues.push("strategy3_runner_must_disable_ready_snapshot");
if (!/same-day Fugle mother-pool 1m only/.test(runnerContract)) runnerContractIssues.push("strategy3_runner_formal_source_policy_missing");

const chainIssues = [];
const canonicalRunId = scanStage.runId || "";
const canonicalCount = Number(scanStage.count || 0);
if (canonicalRunId && scorecardStage.runId !== canonicalRunId) chainIssues.push("strategy3_scorecard_chain_runId_mismatch");
if (canonicalCount > 0 && Number(scorecardStage.count) !== canonicalCount) chainIssues.push("strategy3_scorecard_chain_count_mismatch");
if (canonicalRunId && surfaceStage.strategy3SourceReport?.runId !== canonicalRunId) chainIssues.push("strategy3_surface_chain_runId_mismatch");
if (canonicalCount > 0 && Number(surfaceStage.mobileStrategy3?.count) !== canonicalCount) chainIssues.push("strategy3_mobile_chain_count_mismatch");
const issues = [...stages.flatMap((stage) => stage.issues.map((issue) => stage.key + ":" + issue)), ...chainIssues, ...runnerContractIssues];
const result = {
  ok: issues.length === 0,
  status: issues.length === 0 ? "STRATEGY3_FORMAL_CLOSURE_PASS" : "STRATEGY3_FORMAL_CLOSURE_FAIL",
  contract: "strategy3-independent-mother-pool-water-scan-terminal-mobile-scorecard-v6",
  flow: ["strategy3_candidate_mother_pool_formal_fugle_1m", "complete_scan", "desktop_terminal", "production_mobile", "strategy3_scorecard_source"],
  tradeDate: TRADE_DATE,
  stages: stages.map((stage) => ({
    key: stage.key,
    ok: stage.ok,
    exitCode: stage.exitCode,
    runId: stage.payload?.runId || stage.payload?.strategy3SourceReport?.runId || "",
    scanDate: stage.payload?.scanDate || stage.payload?.expectedTradeDate || "",
    count: stage.payload?.count ?? stage.payload?.strategy3SourceReport?.resultCount ?? 0,
    issues: stage.issues,
     deferred: stage.deferred === true,
     deferredReason: stage.deferredReason || "",
  })),
  issues,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
