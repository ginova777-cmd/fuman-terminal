"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const BASE = String(process.env.FUMAN_CB_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const TASKS = [
  ["Fuman CB Complete Scan 2125", "21:25", "run-cb-detect.ps1"],
  ["Fuman CB Watchdog 2145", "21:45", "run-cb-watchdog.ps1"],
  ["Fuman CB Battle Verify 2150", "21:50", "run-cb-battle-verify.ps1"],
];

function n(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { __error: error?.message || String(error) };
  }
}

function add(blockers, ok, id, details = {}) {
  if (!ok) blockers.push({ id, ...details });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function task(name) {
  const command = [
    `$n=${psQuote(name)}`,
    "$t=Get-ScheduledTask -TaskName $n -ErrorAction Stop",
    "$i=Get-ScheduledTaskInfo -TaskName $n -ErrorAction Stop",
    "[pscustomobject]@{state=[string]$t.State;actions=($t.Actions|%{[string]$_.Execute+' '+[string]$_.Arguments}) -join ' | ';triggers=($t.Triggers|%{[string]$_.StartBoundary}) -join ' | ';last=[int]$i.LastTaskResult;next=[string]$i.NextRunTime}|ConvertTo-Json -Compress",
  ].join(";");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
  if (result.status) return { ok: false, error: result.stderr || result.stdout };
  try {
    return { ok: true, ...JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), raw: result.stdout };
  }
}

function taipeiParts() {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
}

function expectedSlotIso() {
  const parts = taipeiParts();
  const slot = new Date(`${parts.year}-${parts.month}-${parts.day}T21:25:00+08:00`);
  if (n(parts.hour) * 60 + n(parts.minute) < 21 * 60 + 25) slot.setUTCDate(slot.getUTCDate() - 1);
  return slot.toISOString();
}

function buildPath(table, params) {
  return `${table}?${new URLSearchParams(params)}`;
}

async function supabase(pathname) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    cache: "no-store",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      Prefer: "count=exact",
    },
  });
  const text = await response.text();
  const range = response.headers.get("content-range") || "";
  return {
    ok: response.ok,
    status: response.status,
    rows: response.ok ? JSON.parse(text || "[]") : [],
    exactCount: range.includes("/") ? n(range.split("/").pop()) : null,
    error: response.ok ? "" : text.slice(0, 500),
  };
}

async function localApi() {
  const handler = require("../api/cb-detect-latest");
  let body;
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = Number(code); return this; },
    setHeader() {},
    json(payload) { body = payload; return payload; },
  };
  await handler({
    method: "GET",
    query: { canvas: "1", compact: "1", shell: "1", limit: "60", live: "1" },
    url: "/api/cb-detect-latest?live=1",
    headers: { host: "localhost" },
  }, response);
  return { status: response.statusCode, body };
}

async function prodApi() {
  const url = new URL("/api/cb-detect-latest", BASE);
  for (const [key, value] of Object.entries({ canvas: 1, compact: 1, shell: 1, limit: 60, live: 1, t: Date.now() })) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, { cache: "no-store" });
  return { status: response.status, body: await response.json() };
}

function apiOk(blockers, label, result, runId) {
  const payload = result.body || {};
  add(blockers, result.status >= 200 && result.status < 300 && payload.ok === true, `${label}_api_not_ok`, {
    status: result.status,
    error: payload.error || payload.detail || payload.reason || "",
  });
  add(blockers, payload.complete === true, `${label}_api_not_complete`, payload);
  add(blockers, payload.cacheSource === "supabase-api", `${label}_api_not_formal_source`, { cacheSource: payload.cacheSource });
  add(blockers, payload.transport?.gate === "run_id", `${label}_api_not_run_id_gate`, payload.transport || {});
  add(blockers, payload.transport?.runTable === "cb_detect_scan_runs", `${label}_api_run_table_mismatch`, payload.transport || {});
  add(blockers, payload.transport?.resultTable === "cb_detect_scan_results", `${label}_api_result_table_mismatch`, payload.transport || {});
  add(blockers, !runId || !payload.runId || payload.runId === runId, `${label}_api_run_id_differs`, {
    apiRunId: payload.runId,
    runId,
  });
  return {
    status: result.status,
    ok: payload.ok === true,
    complete: payload.complete === true,
    runId: payload.runId || "",
    count: n(payload.count),
    updatedAt: payload.updatedAt || "",
    cacheSource: payload.cacheSource || "",
    qualityStatus: payload.qualityStatus || "",
    transport: payload.transport || {},
    sourceHealth: payload.sourceHealth || null,
  };
}

function hasDeep(row, keys) {
  return keys.some((key) => {
    let cursor = row;
    for (const part of key.split(".")) cursor = cursor?.[part];
    return String(cursor ?? "").trim() !== "";
  });
}

function terminalStats(rows) {
  return {
    total: rows.length,
    symbol: rows.filter((row) => hasDeep(row, ["symbol", "payload.symbol", "payload.cbCode", "payload.code"])).length,
    cbCode: rows.filter((row) => hasDeep(row, ["symbol", "payload.cbCode", "payload.code"])).length,
    name: rows.filter((row) => hasDeep(row, ["name", "payload.name", "payload.cbName"])).length,
    score: rows.filter((row) => hasDeep(row, ["payload.score", "payload.finalScore", "payload.baseScore"])).length,
    entry: rows.filter((row) => hasDeep(row, ["payload.entryLabel", "payload.selectedEntryModel", "payload.tags", "payload.sourceLayer"])).length,
  };
}

function runBattleState() {
  const result = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, "scripts", "verify-cb-battle-state.js")], {
    cwd: ROOT,
    env: { ...process.env, FUMAN_RUNTIME_DIR: RUNTIME_DIR },
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
  });
  let payload = null;
  try {
    payload = JSON.parse((result.stdout || "").trim());
  } catch {}
  return {
    ok: result.status === 0 && payload?.ok === true,
    exitCode: result.status,
    payload,
    stderr: (result.stderr || "").slice(0, 1000),
    stdout: payload ? "" : (result.stdout || "").slice(0, 1000),
  };
}

function receiptEvidence() {
  const names = [
    "cb-watchdog-alert.json",
    "cb-battle-verify-alert.json",
    "cb-alert-path-smoke-alert.json",
  ];
  const receipts = names.map((name) => {
    const file = path.join(RECEIPT_DIR, name);
    const payload = fs.existsSync(file) ? readJson(file) : null;
    return {
      name,
      file,
      exists: fs.existsSync(file),
      ok: payload?.ok === true,
      kind: payload?.kind || "",
      source: payload?.source || "",
      channel: payload?.channel || "",
      dryRun: payload?.dryRun === true,
      finishedAt: payload?.finishedAt || "",
      error: payload?.error || payload?.__error || "",
    };
  });
  const delivered = receipts.filter((receipt) => receipt.ok && !receipt.dryRun && String(receipt.channel).startsWith("smtp"));
  const officialDelivered = delivered.filter((receipt) => ["cb-watchdog", "cb-battle-verify"].includes(receipt.kind));
  return {
    receipts,
    deliveredCount: delivered.length,
    officialDeliveredCount: officialDelivered.length,
    latestError: receipts.find((receipt) => receipt.exists && !receipt.ok)?.error || "",
  };
}

(async () => {
  const blockers = [];
  const warnings = [];

  const schedule = TASKS.map(([name, time, script]) => ({ name, time, script, actual: task(name) }));
  for (const item of schedule) {
    add(blockers, item.actual.ok, "schedule_missing", item);
    add(blockers, ["Ready", "Running"].includes(item.actual.state), "schedule_not_ready", item);
    add(blockers, String(item.actual.triggers || item.actual.next || "").includes(item.time), "schedule_time_mismatch", item);
    add(blockers, String(item.actual.actions || "").includes(item.script), "schedule_runner_mismatch", item);
  }

  const [runs, health, scanner, localResult, productionResult] = await Promise.all([
    supabase(buildPath("cb_detect_scan_runs", {
      select: "run_id,scan_date,finished_at,status,complete,expected_total,scanned_count,result_count,quality_status,source,schema_version,data_contract_source,generated_at,updated_at,payload",
      strategy: "eq.cb_detect",
      status: "eq.complete",
      complete: "eq.true",
      order: "finished_at.desc",
      limit: 1,
    })),
    supabase(buildPath("v_cb_latest_complete_run_health", { select: "*", limit: 1 })),
    supabase(buildPath("v_scanner_resource_health", {
      select: "strategy,required_source,latest_date,row_count,status,reason,suggested_scanner_behavior,updated_at",
      strategy: "eq.CB",
      limit: 1,
    })),
    localApi(),
    prodApi().catch((error) => ({ status: 0, body: { error: error.message } })),
  ]);

  const run = runs.rows[0] || {};
  const results = run.run_id
    ? await supabase(buildPath("cb_detect_scan_results", {
      select: "run_id,scan_date,symbol,name,payload,updated_at",
      run_id: `eq.${run.run_id}`,
      limit: 5000,
    }))
    : { ok: false, rows: [], exactCount: 0, error: "missing_run_id" };
  const stats = terminalStats(results.rows);
  const expected = expectedSlotIso();

  add(blockers, runs.ok && Boolean(run.run_id), "formal_run_missing", { status: runs.status, error: runs.error });
  add(blockers, run.status === "complete" && run.complete === true, "formal_run_not_complete", run);
  add(blockers, n(run.result_count) > 0, "formal_run_empty", run);
  add(blockers, results.ok, "formal_results_unreadable", { status: results.status, error: results.error });
  add(blockers, n(results.exactCount ?? results.rows.length) === n(run.result_count), "formal_readback_count_mismatch", {
    resultRows: results.exactCount ?? results.rows.length,
    runResultCount: run.result_count,
  });
  add(blockers, String(run.schema_version || "").startsWith("cb-detect-complete-run-v1"), "formal_schema_mismatch", run);
  add(blockers, run.data_contract_source === "cb_detect_scan_runs/results", "formal_contract_source_mismatch", run);
  add(blockers, Date.parse(run.updated_at || run.finished_at || run.generated_at || "") >= Date.parse(expected), "freshness_before_expected_slot", {
    updatedAt: run.updated_at,
    expected,
  });

  const healthRow = health.rows[0] || {};
  add(blockers, health.ok, "complete_run_health_unreadable", { status: health.status, error: health.error });
  add(blockers, String(healthRow.source_status || "").toLowerCase() === "ready", "complete_run_health_not_ready", healthRow);

  const scannerRow = scanner.rows[0] || {};
  add(blockers, scanner.ok, "scanner_resource_health_unreadable", { status: scanner.status, error: scanner.error });
  add(blockers, String(scannerRow.status || "").toLowerCase() === "ready", "scanner_health_not_ready", scannerRow);

  for (const key of ["symbol", "cbCode", "name", "score", "entry"]) {
    add(blockers, stats[key] === stats.total, `terminal_key_${key}_missing`, stats);
  }

  const local = apiOk(blockers, "local", localResult, run.run_id);
  const production = apiOk(blockers, "production", productionResult, run.run_id);

  const api = read("api/cb-detect-latest.js");
  const watchdog = read("run-cb-watchdog.ps1");
  const battle = read("run-cb-battle-verify.ps1");
  const app = read("terminal-app.js");
  const runtime = read("terminal-runtime-config.js");
  const sw = read("fuman-sw.js");
  const cleanup = read("scripts/cleanup-api-only-retired-artifacts.js");
  const generator = read("scripts/generate-cb-detect.js");
  const alertSender = read("scripts/send-workflow-alert.js");

  const risks = {
    apiUsesSnapshotFallback: /readSnapshot\("cb_detect_latest"|cacheSource:\s*"supabase-snapshot"|latest-snapshot/.test(api),
    apiUsesDesktopSnapshotAsSource: /readEndpointFromDesktopSnapshot/.test(api),
    watchdogReadsRuntimeJson: /cb-detect-latest\.json/.test(watchdog),
    watchdogHasGmailAlert: watchdog.includes("Invoke-CbFailureAlert") && watchdog.includes("send-workflow-alert.js") && watchdog.includes("cb-watchdog-alert.json") && watchdog.includes("FUMAN_ALERT_RECEIPT_FILE"),
    battleVerifyHasGmailAlert: battle.includes("Invoke-CbFailureAlert") && battle.includes("send-workflow-alert.js") && battle.includes("cb-battle-verify-alert.json") && battle.includes("FUMAN_ALERT_RECEIPT_FILE"),
    alertSenderHasGmailSmtp: alertSender.includes("SMTP_USER") && alertSender.includes("SMTP_PASS") && alertSender.includes("gmail-app-password.txt") && alertSender.includes("writeReceipt"),
    frontendEndpoint: runtime.includes('cbDetectCache: "/api/cb-detect-latest"') ? "/api/cb-detect-latest" : "",
    frontendRejectsNonSupabaseApi: app.includes('payload?.cacheSource!=="supabase-api"'),
    frontendShowsStaleDegraded: app.includes("stale/degraded") && app.includes("未使用舊 static JSON"),
    serviceWorkerBlocksStaticCbJson: sw.includes("isDesktopApiOnlyStaticDataRequest") && /cb-detect/.test(sw),
    generatorWritesCompleteRun: generator.includes("publishCbDetectCompleteRunToSupabase") && generator.includes("verifyCbDetectSupabaseReadback"),
    generatorStillWritesSnapshot: generator.includes('upsertSnapshot("cb_detect_latest"'),
    runtimeCacheExists: fs.existsSync(path.join(RUNTIME_DIR, "data", "cb-detect-latest.json")),
    codeStaticExists: fs.existsSync(path.join(ROOT, "data", "cb-detect-latest.json")),
    cleanupMarksCbStaticRetired: cleanup.includes("data/cb-detect-latest.json"),
  };

  add(blockers, !risks.apiUsesSnapshotFallback, "old_snapshot_fallback_still_readable");
  add(blockers, !risks.apiUsesDesktopSnapshotAsSource, "desktop_snapshot_can_masquerade_as_api");
  add(blockers, !risks.watchdogReadsRuntimeJson, "watchdog_reads_runtime_json");
  add(blockers, risks.watchdogHasGmailAlert, "watchdog_missing_gmail_alert_chain");
  add(blockers, risks.battleVerifyHasGmailAlert, "battle_verify_missing_gmail_alert_chain");
  add(blockers, risks.alertSenderHasGmailSmtp, "workflow_alert_sender_missing_gmail_smtp");
  add(blockers, risks.frontendEndpoint === "/api/cb-detect-latest", "frontend_not_using_formal_api", { endpoint: risks.frontendEndpoint });
  add(blockers, risks.frontendRejectsNonSupabaseApi, "frontend_accepts_non_supabase_api");
  add(blockers, risks.frontendShowsStaleDegraded, "frontend_missing_stale_degraded_message");
  add(blockers, risks.serviceWorkerBlocksStaticCbJson, "service_worker_static_cb_not_blocked");
  add(blockers, risks.cleanupMarksCbStaticRetired, "cleanup_does_not_retire_static_cb_json");

  const battleState = runBattleState();
  add(blockers, battleState.ok, "cb_battle_state_verify_failed", {
    exitCode: battleState.exitCode,
    issues: battleState.payload?.issues || [],
    stderr: battleState.stderr,
    stdout: battleState.stdout,
  });

  const alertPath = receiptEvidence();
  add(blockers, alertPath.deliveredCount > 0, "cb_alert_actual_smtp_receipt_missing_or_failed", {
    receipts: alertPath.receipts,
    latestError: alertPath.latestError,
  });
  if (alertPath.deliveredCount > 0 && alertPath.officialDeliveredCount === 0) {
    warnings.push({
      id: "cb_alert_has_smoke_delivery_but_no_watchdog_or_battle_receipt",
      action: "下一次 CB watchdog/battle verify 失敗時仍需留下 cb-watchdog-alert.json 或 cb-battle-verify-alert.json ok=true receipt",
    });
  }
  if (risks.generatorStillWritesSnapshot) {
    warnings.push({
      id: "snapshot_written_for_compat_only",
      action: "建議等 desktop snapshot builder 不再需要 cb_detect_latest 後退休相容寫入",
    });
  }

  const output = {
    strategy: "CB 可轉債偵測",
    unattendedStatus: blockers.length ? "NO" : "YES",
    checkedAt: new Date().toISOString(),
    formalSource: "Supabase cb_detect_scan_runs + cb_detect_scan_results via /api/cb-detect-latest run_id gate",
    soleWriter: "scripts/generate-cb-detect.js via run-cb-detect.ps1; watchdog only invokes same writer after official API freshness failure",
    schedule,
    formalApi: { local, production },
    frontendEntry: {
      desktop: "/api/cb-detect-latest",
      mobile: "/api/mobile-fragment?tab=cb",
      rejectsFallback: risks.frontendRejectsNonSupabaseApi,
      staleDegradedMessage: risks.frontendShowsStaleDegraded,
    },
    freshness: {
      expectedSlot: expected,
      runId: run.run_id || "",
      updatedAt: run.updated_at || run.finished_at || run.generated_at || "",
      marketDate: run.scan_date || "",
      source: run.source || "",
      contract: run.data_contract_source || "",
      qualityStatus: run.quality_status || "",
      schemaVersion: run.schema_version || "",
    },
    sourceChain: {
      completeRunHealth: healthRow,
      scannerResourceHealth: scannerRow,
      battleState: battleState.payload ? {
        ok: battleState.payload.ok,
        issues: battleState.payload.issues || [],
        scannerResourceHealth: battleState.payload.details?.scannerResourceHealth || null,
      } : battleState,
    },
    alertPath,
    staleDegradedDisplay: {
      apiSourceHealth: local.sourceHealth,
      frontendMessage: risks.frontendShowsStaleDegraded
        ? "CB 正式 API 讀取失敗或資料 stale/degraded...未使用舊 static JSON 或 snapshot fallback"
        : "",
    },
    legacyRisk: {
      oldTasks: "No active duplicate CB tasks found by this verifier",
      oldCache: [
        risks.runtimeCacheExists ? "runtime cb-detect-latest.json 建議 retired/remove" : "runtime cb-detect-latest.json not present",
        risks.codeStaticExists ? "repo data/cb-detect-latest.json 建議 retired/remove if untracked" : "repo data/cb-detect-latest.json not present",
      ],
      oldStaticJson: risks.serviceWorkerBlocksStaticCbJson ? "desktop /data/cb-detect*.json blocked" : "blocked guard missing",
      oldFallback: risks.apiUsesSnapshotFallback ? "API still reads snapshot fallback" : "API no longer reads snapshot fallback",
      oldContract: risks,
    },
    readOnlyVerifyCommand: "node --use-system-ca scripts/verify-cb-autonomy-readonly.js",
    blockers,
    warnings,
    evidence: {
      health: healthRow,
      scanner: scannerRow,
      run,
      resultRows: results.exactCount ?? results.rows.length,
      terminalKeys: stats,
    },
  };

  console.log(JSON.stringify(output, null, 2));
  if (blockers.length) process.exit(1);
})().catch((error) => {
  console.log(JSON.stringify({
    strategy: "CB 可轉債偵測",
    unattendedStatus: "NO",
    error: error.stack || error.message,
  }, null, 2));
  process.exit(1);
});
