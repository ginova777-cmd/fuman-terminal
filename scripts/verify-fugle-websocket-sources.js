const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const ROOT_DIR = path.resolve(__dirname, "..");

const STOCK_STATUS_FILE = path.join(RUNTIME_DIR, "state", "fugle-websocket-status.json");
const FUTOPT_STATUS_FILE = path.join(RUNTIME_DIR, "state", "fugle-futopt-websocket-status.json");
const STOCK_QUOTES_FILE = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-ws-quotes.json");
const DAYTRADE_CONFIG_FILE = path.join(RUNTIME_DIR, "config", "daytrade-source-speed.json");
const SHARED_CONFIG_FILE = path.join(RUNTIME_DIR, "config", "public-slot-shared-source.json");
const RECOVERY_LOCK_FILE = path.join(RUNTIME_DIR, "locks", "supabase-conservative-recovery-mode.json");
const OUT_DIR = path.join(RUNTIME_DIR, "reports");
const OUT_FILE = path.join(OUT_DIR, "fugle-websocket-source-readiness.json");
const STOCK_COLLECTOR_FILE = path.join(ROOT_DIR, "scripts", "fugle-websocket-collector.js");
const DAYTRADE_WRITER_FILE = path.join(ROOT_DIR, "scripts", "run-daytrade-source-writer.js");

const STOCK_MAX_SUBSCRIPTIONS = 2000;
const FUTOPT_MAX_SUBSCRIPTIONS = 2000;
const STATUS_MAX_AGE_MS = Number(process.env.FUGLE_WS_STATUS_MAX_AGE_MS || 3 * 60 * 1000);
const TASK_STILL_RUNNING = 267009; // 0x41301
const TASK_SHARING_VIOLATION = 2147946720; // 0x80070020, usually overlapping scheduled launches.

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function ageSeconds(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return 999999;
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

function addIssue(issues, condition, code, details = {}) {
  if (!condition) issues.push({ code, ...details });
}

function taskLastResultOk(task) {
  const lastResult = Number(task?.lastResult ?? -999999);
  if (lastResult === 0 || lastResult === TASK_STILL_RUNNING) return true;
  if (lastResult === TASK_SHARING_VIOLATION && /^(ready|running)$/i.test(String(task?.state || ""))) {
    return true;
  }
  return false;
}

function taskResultInterpretation(task) {
  const lastResult = Number(task?.lastResult ?? -999999);
  if (lastResult === 0) return "success";
  if (lastResult === TASK_STILL_RUNNING) return "still_running";
  if (lastResult === TASK_SHARING_VIOLATION) return "overlap_sharing_violation_treated_as_nonfatal_when_state_ready_or_running";
  return "unexpected";
}

function taskState(taskName) {
  const cleanName = String(taskName || "").replace(/^\\+/, "");
  const ps = [
    "$ErrorActionPreference='Stop';",
    `$name=${JSON.stringify(cleanName)};`,
    "$task=Get-ScheduledTask -TaskName $name;",
    "$info=Get-ScheduledTaskInfo -TaskName $name;",
    "[ordered]@{",
    "TaskName=$task.TaskName;",
    "State=($task.State | Out-String).Trim();",
    "NextRunTime=if($info.NextRunTime){$info.NextRunTime.ToString('o')}else{''};",
    "LastRunTime=if($info.LastRunTime){$info.LastRunTime.ToString('o')}else{''};",
    "LastTaskResult=$info.LastTaskResult",
    "} | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    cwd: ROOT_DIR,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return { taskName, exists: false, state: "missing", raw: result.stderr || result.stdout || "" };
  }
  const parsed = JSON.parse(result.stdout || "{}");
  return {
    taskName,
    exists: true,
    state: parsed.State || "",
    nextRunTime: parsed.NextRunTime || "",
    lastRunTime: parsed.LastRunTime || "",
    lastResult: Number(parsed.LastTaskResult ?? -999999),
  };
}

function summarizeWebSocket(status, { maxSubscriptions, requiredChannels }) {
  const channels = Array.isArray(status?.streamingChannels) ? status.streamingChannels : [];
  const subscribed = Number(status?.subscribed || 0);
  const subscribedSymbols = Number(status?.subscribedSymbols || 0);
  const subscribedChannels = Number(status?.subscribedChannels || channels.length || 0);
  const updatedAt = status?.updatedAt || "";
  return {
    ok: status?.ok !== false,
    connected: Boolean(status?.websocketConnected),
    authenticated: Boolean(status?.websocketAuthenticated),
    mode: status?.mode || "",
    streamingUrl: status?.streamingUrl || "",
    channels,
    requiredChannels,
    subscribed,
    subscribedSymbols,
    subscribedChannels,
    maxSubscriptions,
    withinSubscriptionLimit: subscribed > 0 && subscribed <= maxSubscriptions,
    forbiddenChunks: Number(status?.subscribeForbiddenChunks || 0),
    lastMessageAt: status?.lastMessageAt || "",
    updatedAt,
    ageSeconds: ageSeconds(updatedAt),
    messages: Number(status?.streamingMessages || 0),
    quotes: Number(status?.streamingQuotes || 0),
    candles: Number(status?.streamingCandles || 0),
  };
}

function summarizeFinMindPolicy(stockStatus, sharedConfig) {
  const quotePayload = readJson(STOCK_QUOTES_FILE, {});
  const rows = Array.isArray(quotePayload?.quotes) ? quotePayload.quotes : [];
  const finmindRows = rows.filter((row) => {
    const payload = row?.payload || {};
    const marker = [
      row?.quoteSource,
      row?.closeSource,
      row?.realtimeFallback,
      payload.quoteSource,
      payload.closeSource,
      payload.realtimeFallback,
      payload.source,
    ].filter(Boolean).join("|").toLowerCase();
    return marker.includes("finmind");
  });
  const undisclosedFormalRows = finmindRows
    .filter((row) => row?.fallbackUsed !== true || row?.formalPublishEligible !== false || row?.fallbackAllowed === true)
    .slice(0, 12)
    .map((row) => ({
      code: row?.code || row?.symbol || "",
      quoteSource: row?.quoteSource || row?.closeSource || row?.realtimeFallback || "",
      fallbackUsed: row?.fallbackUsed,
      fallbackAllowed: row?.fallbackAllowed,
      formalPublishEligible: row?.formalPublishEligible,
    }));
  return {
    contract: "finmind-diagnostic-only-v1",
    formalDaytradeAllowedSources: ["fugle-websocket-trades", "fugle-websocket-aggregates", "fugle-websocket-candles"],
    finmindAllowedUses: ["low_frequency_diagnostic", "after_hours_backfill", "history_daily_fill"],
    finmindFormalPublishBlocked: stockStatus?.finmindFormalPublishAllowed === false,
    finmindFallbackBlocksLatest: stockStatus?.finmindFallbackBlocksLatest === true,
    finmindFallbackPreservePreviousGood: stockStatus?.finmindFallbackPreservePreviousGood === true,
    finmindStopRetryOn402403: stockStatus?.finmindStopRetryOn402403 === true,
    sharedRecoveryEnabled: sharedConfig?.fugleCollectorFinMindRecoveryEnabled === true,
    quoteCacheFinMindRows: finmindRows.length,
    undisclosedFormalRows,
  };
}

function auditFinMindPolicyCode() {
  const collectorText = fs.readFileSync(STOCK_COLLECTOR_FILE, "utf8");
  const writerText = fs.readFileSync(DAYTRADE_WRITER_FILE, "utf8");
  const checks = {
    collectorDefaultDisabled: /FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED\s*\|\|\s*"0"/.test(collectorText),
    collectorHasQuota402Cooldown: collectorText.includes("status === 402") && collectorText.includes("FINMIND_QUOTA_COOLDOWN_MS"),
    collectorHasBan403Cooldown: collectorText.includes("status === 403") && collectorText.includes("FINMIND_IP_BAN_COOLDOWN_MS"),
    finmindQuoteFallbackUsed: collectorText.includes("fallbackUsed: true") && collectorText.includes("finmind_realtime_snapshot_recovery"),
    finmindQuoteNotFormal: collectorText.includes("formalPublishEligible: false") && collectorText.includes("fallbackAllowed: false"),
    finmindQuotePreservesGood: collectorText.includes("preservePreviousGood: true"),
    daytradeWriterExcludesFinMind: writerText.includes("isFinMindDiagnosticQuote(row)") && writerText.includes("markers.includes(\"finmind\")"),
  };
  return {
    contract: "finmind-policy-code-audit-v1",
    files: [STOCK_COLLECTOR_FILE, DAYTRADE_WRITER_FILE],
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}

function main() {
  const issues = [];
  const stockStatus = readJson(STOCK_STATUS_FILE, {});
  const futoptStatus = readJson(FUTOPT_STATUS_FILE, {});
  const daytrade = readJson(DAYTRADE_CONFIG_FILE, {});
  const shared = readJson(SHARED_CONFIG_FILE, {});
  const recoveryLock = readJson(RECOVERY_LOCK_FILE, {});

  const stock = summarizeWebSocket(stockStatus, {
    maxSubscriptions: STOCK_MAX_SUBSCRIPTIONS,
    requiredChannels: ["trades", "aggregates", "candles"],
  });
  const futopt = summarizeWebSocket(futoptStatus, {
    maxSubscriptions: FUTOPT_MAX_SUBSCRIPTIONS,
    requiredChannels: ["trades", "aggregates", "candles"],
  });
  const finmindPolicy = summarizeFinMindPolicy(stockStatus, shared);
  const finmindPolicyCodeAudit = auditFinMindPolicyCode();

  for (const [name, ws] of [["stock", stock], ["futopt", futopt]]) {
    addIssue(issues, ws.ok, `${name}_websocket_status_not_ok`, ws);
    addIssue(issues, ws.connected, `${name}_websocket_not_connected`, ws);
    addIssue(issues, ws.authenticated, `${name}_websocket_not_authenticated`, ws);
    addIssue(issues, ws.mode === "streaming", `${name}_websocket_not_streaming`, ws);
    addIssue(issues, ws.withinSubscriptionLimit, `${name}_websocket_subscription_limit_violation`, ws);
    addIssue(issues, ws.forbiddenChunks === 0, `${name}_websocket_forbidden_chunks`, ws);
    addIssue(issues, ws.ageSeconds * 1000 <= STATUS_MAX_AGE_MS, `${name}_websocket_status_stale`, ws);
    for (const channel of ws.requiredChannels) {
      addIssue(issues, ws.channels.includes(channel), `${name}_websocket_missing_channel_${channel}`, ws);
    }
  }

  const daytradeQuoteBatchSize = Number(daytrade.collector?.quoteBatchSize || 0);
  const daytradeBatchIntervalSeconds = Number(daytrade.collector?.targetBatchIntervalSeconds || 0);
  const daytradeQuotesPerMinute = daytradeBatchIntervalSeconds > 0
    ? (daytradeQuoteBatchSize * 60) / daytradeBatchIntervalSeconds
    : 0;
  addIssue(issues, daytradeQuoteBatchSize >= 1 && daytradeQuotesPerMinute >= 40, "daytrade_quote_refresh_rate_below_40_per_minute", {
    quoteBatchSize: daytrade.collector?.quoteBatchSize,
    targetBatchIntervalSeconds: daytrade.collector?.targetBatchIntervalSeconds,
    quotesPerMinute: daytradeQuotesPerMinute,
  });
  addIssue(issues, Number(daytrade.collector?.quoteConcurrency) === 1, "daytrade_quote_concurrency_not_1", {
    value: daytrade.collector?.quoteConcurrency,
  });
  addIssue(issues, Number(daytrade.collector?.targetBatchIntervalSeconds) >= 5, "daytrade_batch_interval_too_fast", {
    value: daytrade.collector?.targetBatchIntervalSeconds,
  });
  addIssue(issues, Number(daytrade.speedTargets?.selectedSymbolMaxQuoteAgeSeconds) >= 90, "selected_symbol_quote_age_too_strict_for_stability", {
    value: daytrade.speedTargets?.selectedSymbolMaxQuoteAgeSeconds,
  });
  addIssue(issues, Number(daytrade.priorityPool?.targetSymbolsMax) <= 450, "daytrade_priority_pool_too_large_for_stable_mode", {
    value: daytrade.priorityPool?.targetSymbolsMax,
  });
  addIssue(issues, Number(shared.fugleCollectorRequestDelayMilliseconds) >= 4000, "shared_collector_delay_too_fast", {
    value: shared.fugleCollectorRequestDelayMilliseconds,
  });
  addIssue(issues, !finmindPolicy.sharedRecoveryEnabled, "finmind_recovery_must_not_be_default_enabled", {
    value: shared.fugleCollectorFinMindRecoveryEnabled,
  });
  addIssue(issues, finmindPolicy.finmindFormalPublishBlocked, "finmind_policy_missing_formal_publish_block", finmindPolicy);
  addIssue(issues, finmindPolicy.finmindFallbackBlocksLatest, "finmind_policy_missing_block_latest", finmindPolicy);
  addIssue(issues, finmindPolicy.finmindFallbackPreservePreviousGood, "finmind_policy_missing_preserve_previous_good", finmindPolicy);
  addIssue(issues, finmindPolicy.finmindStopRetryOn402403, "finmind_policy_missing_402_403_stop_retry", finmindPolicy);
  addIssue(issues, finmindPolicy.undisclosedFormalRows.length === 0, "finmind_quote_cache_not_disclosed_as_non_formal", finmindPolicy);
  addIssue(issues, finmindPolicyCodeAudit.ok, "finmind_policy_code_audit_failed", finmindPolicyCodeAudit);
  addIssue(issues, recoveryLock.status === "active", "conservative_recovery_lock_not_active", {
    value: recoveryLock.status,
  });

  const tasks = [
    taskState("\\Fuman Daytrade Source Writer 0600-1330"),
    taskState("\\Fuman Fugle Daytrade Watchdog Every Minute"),
    taskState("\\Fuman Public Slot Shared Source Watchdog"),
  ];
  for (const task of tasks) {
    addIssue(issues, task.exists, "required_task_missing", task);
    addIssue(issues, /^(ready|running)$/i.test(String(task.state)), "required_task_not_ready_or_running", task);
    addIssue(issues, taskLastResultOk(task), "required_task_last_result_nonzero", {
      ...task,
      interpretation: taskResultInterpretation(task),
      allowedResults: [0, TASK_STILL_RUNNING, TASK_SHARING_VIOLATION],
    });
  }

  const report = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "ready" : "not_ready",
    checkedAt: new Date().toISOString(),
    contract: "fugle-websocket-source-readiness-v1",
    scope: "local runtime source transport only; does not prove live market A during off-session and does not run strategy scanners",
    stock,
    futopt,
    daytradeStableSpeed: {
      quoteBatchSize: daytrade.collector?.quoteBatchSize,
      quoteConcurrency: daytrade.collector?.quoteConcurrency,
      targetBatchIntervalSeconds: daytrade.collector?.targetBatchIntervalSeconds,
      effectiveQuotesPerMinute: daytradeQuotesPerMinute,
      selectedSymbolMaxQuoteAgeSeconds: daytrade.speedTargets?.selectedSymbolMaxQuoteAgeSeconds,
      priorityTargetMin: daytrade.priorityPool?.targetSymbolsMin,
      priorityTargetMax: daytrade.priorityPool?.targetSymbolsMax,
    },
    sharedSourceConservativeSpeed: {
      restQuoteBatchSize: shared.restQuoteBatchSize,
      restQuoteEverySeconds: shared.restQuoteEverySeconds,
      fugleCollectorBatchSize: shared.fugleCollectorBatchSize,
      fugleCollectorConcurrency: shared.fugleCollectorConcurrency,
      fugleCollectorRequestDelayMilliseconds: shared.fugleCollectorRequestDelayMilliseconds,
    },
    finmindPolicy,
    finmindPolicyCodeAudit,
    conservativeRecovery: {
      status: recoveryLock.status || "",
      code: recoveryLock.code || "",
      allowed: recoveryLock.allowed || [],
      blocked: recoveryLock.blocked || [],
    },
    tasks,
    taskResultPolicy: {
      allowedResults: [
        { code: 0, meaning: "success" },
        { code: TASK_STILL_RUNNING, meaning: "task still running / overlap-safe scheduled cadence" },
        { code: TASK_SHARING_VIOLATION, meaning: "overlapping scheduled launch/file lock; accepted only when task state is Ready or Running" },
      ],
    },
    issues,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, reportFile: OUT_FILE }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    status: "error",
    error: error?.stack || error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
}
