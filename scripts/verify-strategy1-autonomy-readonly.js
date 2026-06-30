"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const SUPABASE_PUBLISH_GATE_FILE = process.env.FUMAN_SUPABASE_PUBLISH_GATE_FILE || path.join(STATE_DIR, "supabase-publish-hard-gate.json");
const PUBLISH_SOURCE_GATE_FILE = process.env.FUMAN_PUBLISH_SOURCE_GATE_FILE || path.join(STATE_DIR, "publish-source-gate.json");
const TASKS = [
  "Fuman Open Buy Cache 2130",
  "Fuman Open Buy Preopen Prepare 0845",
  "Fuman Strategy1 Futopt Preopen Verify 0850",
  "Fuman Strategy1 Flame Gate Verify 0852",
  "Fuman Open Buy Preopen 0855",
  "Fuman Strategy1 Candidate Verify 2135",
];

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function firstJsonObject(text) {
  const matches = String(text || "").match(/\{[^\r\n]*\}/g) || [];
  const hit = matches.find((item) => item.includes("\"TaskName\"") || item.includes("\"State\""));
  if (!hit) throw new Error(`missing schedule JSON object: ${String(text || "").slice(0, 240)}`);
  return JSON.parse(hit);
}

function previewText(value, limit = 4000) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit)}...<truncated ${text.length - limit} chars>` : text;
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function parseJsonText(text) {
  try { return JSON.parse(text); } catch {}
  const match = String(text || "").match(/\{[\s\S]*\}$/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function runNodeScript(args, options = {}) {
  const child = spawnSync(process.execPath, ["--use-system-ca", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout || 180000,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
  return {
    status: child.status ?? 1,
    signal: child.signal || "",
    error: child.error?.message || "",
    stdout: previewText(child.stdout),
    stderr: previewText(child.stderr),
  };
}

function queryTask(taskName) {
  const ps = [
    "$ProgressPreference='SilentlyContinue'",
    "$ErrorActionPreference='Stop'",
    "$service = New-Object -ComObject 'Schedule.Service'",
    "$service.Connect()",
    `$task = $service.GetFolder('\\').GetTask(${psQuote(taskName)})`,
    "[pscustomobject]@{ TaskName=[string]$task.Name; State=[int]$task.State; Enabled=[bool]$task.Enabled; LastResult=[int]$task.LastTaskResult } | ConvertTo-Json -Compress",
  ].join("; ");
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  });
  if (child.error || child.status !== 0) {
    throw new Error(JSON.stringify({
      status: child.status,
      signal: child.signal || "",
      error: child.error?.message || "",
      stdout: previewText(child.stdout),
      stderr: previewText(child.stderr),
    }));
  }
  const row = firstJsonObject(child.stdout);
  const state = Number(row.State);
  const enabled = row.Enabled === true || row.Enabled === "true";
  const status = state === 3 ? "Ready" : state === 4 ? "Running" : `State${state}`;
  const scheduledState = enabled ? "Enabled" : "Disabled";
  const lastResult = Number(row.LastResult);
  const acceptableLastResult = lastResult === 0 || (state === 4 && lastResult === 267009);
  return {
    taskName,
    state,
    enabled,
    status,
    scheduledState,
    lastResult,
    ok: (state === 3 || state === 4) && enabled && acceptableLastResult,
  };
}

async function captureOpenBuyApi(query) {
  const handler = require("../api/open-buy-latest");
  let body = null;
  const req = { method: "GET", query, url: `/api/open-buy-latest?${new URLSearchParams(query)}`, headers: {} };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    setHeader() {},
    json(payload) { body = payload; return payload; },
    send(payload) { body = payload; return payload; },
    end(payload) { body = payload; return payload; },
  };
  await Promise.resolve(handler(req, res));
  return { statusCode: res.statusCode, body: body || {} };
}

function summarizeApi(result) {
  const body = result.body || {};
  return {
    statusCode: result.statusCode,
    ok: body.ok,
    runId: body.runId || "",
    cacheSource: body.cacheSource || "",
    qualityStatus: body.qualityStatus || "",
    decisionReady: body.decisionReady,
    decisionPending: body.decisionPending,
    count: body.count,
    reason: body.reason || body.error || body.lastError || "",
  };
}

function runBattleState() {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const child = spawnSync(process.execPath, ["--use-system-ca", "scripts/verify-strategy1-battle-state.js"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 90000,
    });
    const detail = {
      attempt,
      status: child.status,
      signal: child.signal || "",
      error: child.error?.message || "",
      stdout: previewText(child.stdout),
      stderr: previewText(child.stderr),
    };
    attempts.push(detail);
    try {
      const payload = JSON.parse(child.stdout || "{}");
      detail.parsedOk = payload.ok;
      detail.parsedIssues = payload.issues || [];
      detail.parsedWarnings = payload.warnings || [];
      if (!child.error && child.status === 0) return { payload, attempts };
    } catch (error) {
      detail.parseError = error.message;
    }
  }
  const error = new Error("battle_state_child_failed");
  error.attempts = attempts;
  throw error;
}

function runSupabasePublishHardGate() {
  const child = runNodeScript(["scripts/verify-supabase-publish-hard-gate.js"], { timeout: 180000 });
  const payload = readJsonSafe(SUPABASE_PUBLISH_GATE_FILE) || parseJsonText(child.stdout) || {};
  return {
    ok: child.status === 0 && payload.ok === true && payload.publishAllowed === true && payload.fallbackUsed !== true,
    child,
    payload,
    stateFile: SUPABASE_PUBLISH_GATE_FILE,
  };
}

function runPublishSourceGateAlertSmoke() {
  const child = runNodeScript(["scripts/check-publish-source-gate.js", "--simulate-critical", "--dry-run-alert", "--strict"], {
    timeout: 240000,
    env: { FUMAN_PUBLISH_SOURCE_GATE_ALERT_DRY_RUN: "1" },
  });
  const payload = readJsonSafe(PUBLISH_SOURCE_GATE_FILE) || parseJsonText(child.stdout) || {};
  const alertOk = payload.alert?.ok === true && payload.alert?.dryRun === true;
  return {
    ok: child.status === 3
      && payload.status === "blocked"
      && payload.publishAllowed === false
      && payload.mustPreserveLatest === true
      && alertOk,
    child,
    payload,
    stateFile: PUBLISH_SOURCE_GATE_FILE,
  };
}

async function main() {
  const issues = [];
  const warnings = [];
  const details = { checkedAt: new Date().toISOString() };

  details.schedules = TASKS.map((taskName) => {
    try { return queryTask(taskName); }
    catch (error) { return { taskName, ok: false, error: error.message }; }
  });
  for (const task of details.schedules) {
    if (!task.ok) issues.push(`schedule_not_ready_${task.taskName}`);
  }

  let battleResult;
  try {
    battleResult = runBattleState();
  } catch (error) {
    details.battleStateChild = {
      error: error.message,
      attempts: error.attempts || [],
    };
  }
  const battle = battleResult?.payload || { ok: false, issues: ["battle_state_child_failed"], warnings: [] };
  details.battleStateChild = details.battleStateChild || {
    attempts: (battleResult?.attempts || []).map((item) => ({
      attempt: item.attempt,
      status: item.status,
      signal: item.signal,
      error: item.error,
      stderr: item.stderr,
    })),
  };
  details.battleState = {
    ok: battle.ok,
    issues: battle.issues || [],
    warnings: battle.warnings || [],
    futoptSnapshotCount: battle.details?.sourceContracts?.futoptSnapshot?.exactCount,
    futoptSnapshotSampleDate: battle.details?.sourceContracts?.futoptSnapshot?.sampleDate,
    futoptJoinCount: battle.details?.sourceContracts?.futoptJoin?.exactCount,
    readyStatusLastError: battle.details?.readyStatus?.last_error || "",
  };
  if (!battle.ok) issues.push(...(battle.issues || ["battle_state_not_ok"]));
  if ((details.battleState.futoptSnapshotCount || 0) <= 0) issues.push("futopt_snapshot_empty");
  if ((details.battleState.futoptJoinCount || 0) <= 0) issues.push("futopt_join_empty");

  details.supabasePublishHardGate = runSupabasePublishHardGate();
  const supabaseGatePayload = details.supabasePublishHardGate.payload || {};
  if (!details.supabasePublishHardGate.ok) {
    issues.push("supabase_publish_hard_gate_not_ready");
  }

  details.publishSourceGateAlertSmoke = runPublishSourceGateAlertSmoke();
  if (!details.publishSourceGateAlertSmoke.ok) {
    issues.push("publish_source_gate_alert_smoke_failed");
  }

  const [bare, compact] = await Promise.all([
    captureOpenBuyApi({ live: "1" }),
    captureOpenBuyApi({ canvas: "1", compact: "1", shell: "1", limit: "60", live: "1" }),
  ]);
  details.bareApi = summarizeApi(bare);
  details.compactApi = summarizeApi(compact);

  if (compact.statusCode !== 200 || compact.body?.ok !== true) issues.push(`compact_api_not_ok_${compact.statusCode}`);
  if (!compact.body?.runId) issues.push("compact_api_missing_runId");
  if (compact.body?.decisionReady !== true && !String(compact.body?.reason || compact.body?.lastError || "").trim()) {
    issues.push("compact_api_pending_reason_missing");
  }
  const bareBody = JSON.stringify(bare.body || {});
  const expectedBare503 = bare.statusCode === 503 && /strategy1_decision_not_ready|futopt_not_ready|preopen_not_ready/i.test(bareBody);
  if (bare.statusCode !== 200 && !expectedBare503) issues.push(`bare_api_unexpected_status_${bare.statusCode}`);

  const legacy = "C:/fuman-runtime/data/open-buy-scorecard-source.json";
  details.legacyOpenBuyScorecardSource = { path: legacy, exists: fs.existsSync(legacy), expected: "absent_or_quarantined" };
  if (details.legacyOpenBuyScorecardSource.exists) issues.push("legacy_open_buy_scorecard_source_present");

  const output = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "ready" : "blocked",
    strategy: "Strategy1",
    contract: "strategy1-autonomy-readonly-v1",
    sourceCoverage: supabaseGatePayload.sourceCoverage || {},
    staleSeconds: supabaseGatePayload.staleSeconds ?? null,
    latestRunId: supabaseGatePayload.latestRunId || details.compactApi?.runId || "",
    fallbackUsed: supabaseGatePayload.fallbackUsed === true,
    writeBudget: supabaseGatePayload.writeBudget || {
      allowLatestWrite: issues.length === 0,
      allowCompleteRunWrite: issues.length === 0,
      preservePreviousCompleteRun: issues.length > 0,
      reason: issues.length === 0 ? "Strategy1 autonomy gates ready" : "Strategy1 autonomy gate blocked",
    },
    retentionOk: supabaseGatePayload.retentionOk === true,
    publishAllowed: issues.length === 0 && supabaseGatePayload.publishAllowed === true,
    mustPreserveLatest: issues.length > 0 || supabaseGatePayload.publishAllowed !== true,
    issues,
    warnings,
    details,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, strategy: "Strategy1", error: error.message }, null, 2)}\n`);
  process.exit(1);
});
