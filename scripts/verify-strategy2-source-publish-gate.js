"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_FILE = process.env.FUMAN_SUPABASE_PUBLISH_GATE_FILE
  || path.join(RUNTIME_DIR, "state", "supabase-publish-hard-gate.json");
const ALERT_RECEIPT = process.env.FUMAN_SUPABASE_PUBLISH_GATE_ALERT_RECEIPT
  || path.join(RUNTIME_DIR, "data", "scan-receipts", "supabase-publish-hard-gate-alert.json");
const LIVE_BASE_URL = String(process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

function hasArg(name) {
  return process.argv.slice(2).includes(name);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function requireField(object, field, label, issues) {
  if (!object || !Object.prototype.hasOwnProperty.call(object, field)) issues.push(`${label}_missing_${field}`);
}

function requireFields(object, fields, label, issues) {
  for (const field of fields) requireField(object, field, label, issues);
}

function runHardGate() {
  const result = spawnSync(process.execPath, [
    "--use-system-ca",
    path.join(ROOT, "scripts", "verify-supabase-publish-hard-gate.js"),
    "--strategy=strategy2",
    "--dry-run-alert",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (![0, 1].includes(result.status)) {
    throw new Error(`verify-supabase-publish-hard-gate failed to run: ${(result.stderr || result.stdout || "").slice(0, 800)}`);
  }
  return result;
}

function callLocalStrategy2Api() {
  const handler = require("../api/strategy2-latest");
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, payload, headers: this.headers });
      },
    };
    Promise.resolve(handler({
      method: "GET",
      url: `/api/strategy2-latest?limit=20&live=1&ts=${Date.now()}`,
      headers: { host: "localhost" },
    }, response)).catch((error) => {
      resolve({ status: 500, payload: { ok: false, error: error?.message || String(error) }, headers: response.headers });
    });
  });
}

async function callLiveStrategy2Api() {
  const response = await fetch(`${LIVE_BASE_URL}/api/strategy2-latest?limit=20&live=1&ts=${Date.now()}`, {
    headers: { Accept: "application/json", "Cache-Control": "no-store" },
    cache: "no-store",
    signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, headers: {} };
}

function assertPublisherFailClosed(issues) {
  const publisher = fs.readFileSync(path.join(ROOT, "scripts", "publish-strategy2-complete-run.js"), "utf8");
  for (const marker of [
    "readValidatedFullWindowReplayReport",
    "source gate using validated full-window replay",
    "LOCAL_COMPLETE_RUN_FILE",
    "strategy2-full-window-1m-replay",
  ]) {
    if (publisher.includes(marker)) issues.push(`publisher_replay_bypass_marker_present:${marker}`);
  }
  for (const marker of [
    "assertStrategy2SourcePublishGate",
    "writeStrategy2BlockedReceipt",
    "preservedLatest=true",
    "did not write latest",
    "sendStrategy2SourceGateAlert",
  ]) {
    if (!publisher.includes(marker)) issues.push(`publisher_fail_closed_marker_missing:${marker}`);
  }
}

function validateHardGate(payload, alertReceipt, issues) {
  requireFields(payload, [
    "ok",
    "status",
    "sourceCoverage",
    "staleSeconds",
    "latestRunId",
    "fallbackUsed",
    "writeBudget",
    "retentionOk",
    "issues",
    "warnings",
    "publishAllowed",
    "writePolicy",
  ], "hard_gate", issues);
  requireFields(payload?.sourceCoverage || {}, [
    "fresh_quote_coverage_120s",
    "today_1m_symbols",
    "ready_ge_35",
    "latest_candle_time",
    "intraday_1m_stale_seconds",
    "preopen_coverage",
    "daily_volume_freshness",
  ], "hard_gate_sourceCoverage", issues);
  if (payload?.ok === false) {
    if (payload.publishAllowed !== false) issues.push("hard_gate_degraded_publishAllowed_not_false");
    if (payload.writePolicy?.allowLatestWrite !== false) issues.push("hard_gate_degraded_allowLatestWrite_not_false");
    if (payload.writePolicy?.allowCompleteRunWrite !== false) issues.push("hard_gate_degraded_allowCompleteRunWrite_not_false");
    if (payload.writePolicy?.preservePreviousCompleteRun !== true) issues.push("hard_gate_degraded_preservePreviousCompleteRun_not_true");
    if (!Array.isArray(payload.issues) || payload.issues.length <= 0) issues.push("hard_gate_degraded_issues_empty");
    if (payload.alert?.ok !== true) issues.push("hard_gate_degraded_alert_not_ok");
    if (alertReceipt?.ok !== true) issues.push("hard_gate_alert_receipt_not_ok");
    if (alertReceipt?.channel !== "smtp:dry-run") issues.push("hard_gate_alert_receipt_not_dry_run");
  }
}

function validateApi(payload, hardGate, issues) {
  requireFields(payload, [
    "ok",
    "status",
    "sourceCoverage",
    "staleSeconds",
    "latestRunId",
    "fallbackUsed",
    "writeBudget",
    "retentionOk",
    "issues",
    "warnings",
    "publishAllowed",
    "publishBlocked",
    "publishBlockedReason",
    "sourceGate",
  ], "api", issues);
  requireFields(payload?.sourceCoverage || {}, [
    "fresh_quote_coverage_120s",
    "today_1m_symbols",
    "ready_ge_35",
    "latest_candle_time",
    "intraday_1m_stale_seconds",
    "preopenCoverage",
    "dailyVolumeFreshness",
    "sourceStatus",
  ], "api_sourceCoverage", issues);
  if (hardGate?.ok === false) {
    if (payload.publishAllowed !== false) issues.push("api_degraded_publishAllowed_not_false");
    if (payload.publishBlocked !== true) issues.push("api_degraded_publishBlocked_not_true");
    if (!/^(degraded|blocked|not_ready|stale)$/i.test(String(payload.status || ""))) issues.push(`api_degraded_status_unexpected:${payload.status || "missing"}`);
    if (!Array.isArray(payload.issues) || payload.issues.length <= 0) issues.push("api_degraded_issues_empty");
    if (payload.sourceGate?.publishAllowed !== false) issues.push("api_sourceGate_publishAllowed_not_false");
  }
}

async function main() {
  const issues = [];
  const mode = hasArg("--live") ? "live" : "local";
  const hardGateRun = runHardGate();
  const hardGate = readJson(STATE_FILE);
  const alertReceipt = readJson(ALERT_RECEIPT);
  if (!hardGate) issues.push(`hard_gate_state_missing:${STATE_FILE}`);
  else validateHardGate(hardGate, alertReceipt, issues);

  assertPublisherFailClosed(issues);

  const api = mode === "live" ? await callLiveStrategy2Api() : await callLocalStrategy2Api();
  if (api.status !== 200) issues.push(`strategy2_api_http_${api.status}`);
  if (!api.payload || typeof api.payload !== "object") issues.push("strategy2_api_payload_missing");
  else validateApi(api.payload, hardGate, issues);

  const report = {
    ok: issues.length === 0,
    mode,
    checkedAt: new Date().toISOString(),
    hardGateExitCode: hardGateRun.status,
    hardGate: hardGate ? {
      ok: hardGate.ok,
      status: hardGate.status,
      publishAllowed: hardGate.publishAllowed,
      staleSeconds: hardGate.staleSeconds,
      latestRunId: hardGate.latestRunId,
      issues: hardGate.issues,
      alert: hardGate.alert,
    } : null,
    api: api.payload ? {
      status: api.payload.status,
      publishAllowed: api.payload.publishAllowed,
      publishBlocked: api.payload.publishBlocked,
      latestRunId: api.payload.latestRunId,
      staleSeconds: api.payload.staleSeconds,
      sourceCoverage: api.payload.sourceCoverage,
      issues: api.payload.issues,
      warnings: api.payload.warnings,
    } : null,
    alertReceipt: alertReceipt ? {
      ok: alertReceipt.ok,
      channel: alertReceipt.channel,
      dryRun: alertReceipt.dryRun,
      to: alertReceipt.to,
      subject: alertReceipt.subject,
    } : null,
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(`[strategy2-source-publish-gate] failed: ${error?.message || String(error)}`);
  process.exit(1);
});
