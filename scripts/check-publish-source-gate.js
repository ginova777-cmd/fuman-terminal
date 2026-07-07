"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const OUT_FILE = process.env.FUMAN_PUBLISH_SOURCE_GATE_FILE || path.join(STATE_DIR, "publish-source-gate.json");
const ALERT_RECEIPT = process.env.FUMAN_PUBLISH_SOURCE_GATE_ALERT_RECEIPT || path.join(STATE_DIR, "publish-source-gate-alert.json");
const NODE = process.execPath;

const STRATEGIES = [
  "strategy1",
  "strategy2",
  "strategy3",
  "strategy4",
  "strategy5",
  "institution",
  "cb",
  "warrant",
];

function hasArg(name) {
  return process.argv.includes(name);
}

function cleanNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function publishSourcePhase(date = new Date()) {
  const minute = taipeiMinuteOfDay(date);
  if (minute < 8 * 60 + 30) return { phase: "pre_warmup", hardGateRequired: false };
  if (minute < 8 * 60 + 45) return { phase: "0830_warmup", hardGateRequired: true };
  if (minute < 8 * 60 + 55) return { phase: "0845_readiness", hardGateRequired: true };
  if (minute < 9 * 60 + 5) return { phase: "0855_preopen_0905_first_1m", hardGateRequired: true };
  if (minute < 9 * 60 + 10) return { phase: "0905_first_1m", hardGateRequired: true };
  if (minute < 9 * 60 + 30) return { phase: "0910_quote_1m_hard_gate", hardGateRequired: true };
  if (minute <= 12 * 60) return { phase: "0930_ready_ge_35_hard_gate", hardGateRequired: true };
  if (minute <= 13 * 60 + 35) return { phase: "post_strategy2_live_window", hardGateRequired: false };
  return { phase: "non_live", hardGateRequired: false };
}

function ensureDirs() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.mkdirSync(path.dirname(ALERT_RECEIPT), { recursive: true });
}

function runNode(args, options = {}) {
  const result = spawnSync(NODE, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "--use-system-ca" },
    timeout: options.timeout || 120000,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}$/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function runCoverageGate() {
  const result = runNode(["scripts/check-strategy2-supabase-coverage.js", "--fail-on-critical"], { timeout: 180000 });
  const stateFile = process.env.STRATEGY2_SUPABASE_COVERAGE_FILE || path.join(STATE_DIR, "strategy2-supabase-coverage.json");
  const payload = readJson(stateFile) || parseJsonText(result.stdout) || {
    ok: false,
    issues: [{ severity: "critical", id: "coverage-output-missing", message: "strategy2 coverage output missing" }],
  };
  return { result, payload };
}

function runScannerGate(strategy) {
  const result = runNode(["scripts/check-scanner-resource-health.js", `--strategy=${strategy}`], { timeout: 90000 });
  const payload = parseJsonText(result.stdout) || {
    ok: false,
    blocked: true,
    strategy,
    status: "failed",
    reason: result.stderr || result.stdout || "scanner resource health output missing",
  };
  return { result, payload };
}

function buildSourceCoverage(coveragePayload = {}, strategy2Payload = {}) {
  const coverage = coveragePayload.coverage || {};
  const sourceStatusPayload = strategy2Payload.sourceStatus?.payload || {};
  return {
    freshQuoteCoverage120s: cleanNumber(sourceStatusPayload.fresh_quote_coverage_120s || coverage.quoteCoverageRatio),
    quoteAgeSeconds: cleanNumber(coverage.quoteAgeSeconds || sourceStatusPayload.quote_age_seconds),
    today1mSymbols: cleanNumber(sourceStatusPayload.today_1m_symbols || sourceStatusPayload.intraday_1m_symbols_today || coverage.intraday1mReadyRows),
    readyGe35: cleanNumber(sourceStatusPayload.ready_ge_35_symbols || sourceStatusPayload.ready_ge_35 || coverage.intraday1mReadyGe35),
    latestCandleTime: sourceStatusPayload.latest_candle_time_taipei || sourceStatusPayload.latest_candle_time || coverage.latestCandleTime || "",
    intraday1mStaleSeconds: cleanNumber(sourceStatusPayload.intraday_1m_stale_seconds, null),
    preopenCoverage: {
      rows: cleanNumber(coverage.preopenRows),
      finalBlindBuyRows: cleanNumber(coverage.finalBlindBuyRows),
      futoptMappingRows: cleanNumber(coverage.futoptMappingRows),
      futoptQuoteRows: cleanNumber(coverage.futoptQuoteRows),
    },
    dailyVolumeFreshness: {
      rows: cleanNumber(coverage.dailyVolumeRows),
      coverage: cleanNumber(coverage.dailyVolumeCoverage),
    },
    fallbackUsed: false,
  };
}

function issueFromGate(name, gate) {
  const status = String(gate?.payload?.status || "").toLowerCase();
  const ok = gate?.payload?.ok === true && gate?.result?.status === 0;
  if (ok) return null;
  return {
    severity: "critical",
    id: `${name}_publish_source_gate_blocked`,
    message: gate?.payload?.reason || gate?.payload?.error || gate?.result?.stderr || gate?.result?.stdout || `${name} source gate blocked`,
    details: {
      status,
      exitCode: gate?.result?.status,
      suggestedScannerBehavior: gate?.payload?.suggestedScannerBehavior || gate?.payload?.suggested_scanner_behavior || "",
    },
  };
}

function downgradedWarning(issue, reason = "non_live_phase") {
  return {
    ...issue,
    severity: "warning",
    downgradedFrom: issue.severity || "critical",
    downgradeReason: reason,
  };
}

function isNonTradingDayBlock(issue) {
  const text = `${issue?.message || ""} ${issue?.details?.status || ""}`.toLowerCase();
  return /not_trading_day|market_closed|non-trading day|weekend/.test(text);
}

function strategy1FormalWindowRequired(date = new Date()) {
  const minute = taipeiMinuteOfDay(date);
  const nightCandidate = minute >= 21 * 60 + 25 && minute <= 21 * 60 + 45;
  const morningDecision = minute >= 8 * 60 + 40 && minute <= 9 * 60 + 5;
  return nightCandidate || morningDecision;
}

function sendAlert(payload, dryRun) {
  const text = [
    "Fuman publish source gate blocked.",
    "",
    `status=${payload.status}`,
    `publishAllowed=${payload.publishAllowed}`,
    `mustPreserveLatest=${payload.mustPreserveLatest}`,
    `issues=${payload.issues.map((item) => `${item.id}: ${item.message}`).join(" | ") || "none"}`,
    "",
    "Policy: Supabase coverage insufficient -> do not publish, do not overwrite latest, preserve previous complete run.",
  ].join("\n");
  const env = {
    ...process.env,
    FUMAN_ALERT_KIND: "publish-source-gate",
    FUMAN_ALERT_SOURCE: "FumanPublishSourceGate",
    FUMAN_ALERT_SUBJECT: "Fuman Terminal publish blocked: Supabase source coverage",
    FUMAN_ALERT_TEXT: text,
    FUMAN_ALERT_RECEIPT_FILE: ALERT_RECEIPT,
  };
  if (dryRun) env.FUMAN_ALERT_DRY_RUN = "1";
  const result = spawnSync(NODE, ["scripts/send-workflow-alert.js"], {
    cwd: ROOT,
    encoding: "utf8",
    env,
    timeout: 60000,
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    dryRun,
    receiptFile: ALERT_RECEIPT,
    status: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

async function main() {
  ensureDirs();
  const dryRunAlert = hasArg("--dry-run-alert") || process.env.FUMAN_PUBLISH_SOURCE_GATE_ALERT_DRY_RUN === "1";
  const noAlert = hasArg("--no-alert") || process.env.FUMAN_PUBLISH_SOURCE_GATE_NO_ALERT === "1";
  const simulateCritical = hasArg("--simulate-critical");
  const strict = hasArg("--strict") || process.env.FUMAN_PUBLISH_SOURCE_GATE_STRICT === "1";
  const phase = publishSourcePhase();
  const hardGateRequired = strict || phase.hardGateRequired;

  const coverageGate = runCoverageGate();
  const scannerGates = Object.fromEntries(STRATEGIES.map((strategy) => [strategy, runScannerGate(strategy)]));
  const strategy2Payload = scannerGates.strategy2?.payload || {};

  const issues = [];
  const warnings = [];
  const coverageIssues = Array.isArray(coverageGate.payload.issues) ? coverageGate.payload.issues : [];
  for (const item of coverageIssues) {
    const severity = item.severity || "warning";
    const target = severity === "critical" && hardGateRequired ? issues : warnings;
    const nextIssue = {
      severity,
      id: item.id || "coverage_issue",
      message: item.message || String(item),
      details: item.details || {},
    };
    target.push(target === warnings && severity === "critical" ? downgradedWarning(nextIssue) : nextIssue);
  }
  if (coverageGate.result.status !== 0 && !issues.some((item) => item.id === "strategy2_coverage_exit_nonzero")) {
    const exitIssue = {
      severity: "critical",
      id: "strategy2_coverage_exit_nonzero",
      message: coverageGate.result.stderr || coverageGate.result.stdout || "strategy2 coverage gate exited non-zero",
      details: { exitCode: coverageGate.result.status },
    };
    (hardGateRequired ? issues : warnings).push(hardGateRequired ? exitIssue : downgradedWarning(exitIssue));
  }
  for (const [strategy, gate] of Object.entries(scannerGates)) {
    const issue = issueFromGate(strategy, gate);
    if (!issue) continue;
    if (!hardGateRequired && (
      strategy === "strategy2"
      || strategy === "strategy3"
      || (strategy === "strategy1" && !strategy1FormalWindowRequired())
      || isNonTradingDayBlock(issue)
    )) warnings.push(downgradedWarning(issue, strategy === "strategy1" ? "strategy1_off_formal_window" : "non_live_phase"));
    else issues.push(issue);
  }
  if (simulateCritical) {
    issues.push({
      severity: "critical",
      id: "simulated_publish_source_gate_block",
      message: "simulated critical source coverage failure",
      details: { preserveLatest: true },
    });
  }

  const blocked = issues.length > 0;
  const payload = {
    ok: !blocked,
    status: blocked ? "blocked" : "ready",
    checkedAt: new Date().toISOString(),
    contract: "publish-source-gate-v1",
    phase: phase.phase,
    hardGateRequired,
    publishAllowed: !blocked,
    mustPreserveLatest: blocked,
    latestRunId: strategy2Payload.readiness?.latest_run_id || "",
    fallbackUsed: false,
    sourceCoverage: buildSourceCoverage(coverageGate.payload, strategy2Payload),
    staleSeconds: buildSourceCoverage(coverageGate.payload, strategy2Payload).intraday1mStaleSeconds,
    writeBudget: {
      allowLatestWrite: !blocked,
      allowCompleteRunWrite: !blocked,
      preservePreviousCompleteRun: blocked,
      reason: blocked ? "source coverage/readiness gate blocked" : "source coverage gate ready",
    },
    retentionOk: true,
    alertRequired: blocked,
    alert: null,
    gates: {
      strategy2Coverage: coverageGate.payload,
      scannerResourceHealth: Object.fromEntries(Object.entries(scannerGates).map(([key, gate]) => [key, gate.payload])),
    },
    issues,
    warnings,
    suggestedScannerBehavior: blocked
      ? "preserve latest complete run; do not publish; do not overwrite latest; surface degraded reason"
      : "publish allowed",
  };

  if (blocked && !noAlert) {
    payload.alert = sendAlert(payload, dryRunAlert);
    if (!payload.alert.ok) {
      payload.issues.push({
        severity: "critical",
        id: "publish_source_gate_alert_failed",
        message: payload.alert.stderr || payload.alert.stdout || "alert send failed",
        details: { receiptFile: payload.alert.receiptFile, dryRun: payload.alert.dryRun },
      });
      payload.ok = false;
      payload.status = "blocked";
      payload.publishAllowed = false;
      payload.mustPreserveLatest = true;
    }
  }

  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (payload.status !== "ready") process.exitCode = 3;
}

main().catch((error) => {
  ensureDirs();
  const payload = {
    ok: false,
    status: "blocked",
    checkedAt: new Date().toISOString(),
    contract: "publish-source-gate-v1",
    publishAllowed: false,
    mustPreserveLatest: true,
    fallbackUsed: false,
    writeBudget: {
      allowLatestWrite: false,
      allowCompleteRunWrite: false,
      preservePreviousCompleteRun: true,
      reason: "publish source gate crashed",
    },
    retentionOk: false,
    issues: [{ severity: "critical", id: "publish_source_gate_error", message: error?.message || String(error) }],
    warnings: [],
  };
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
