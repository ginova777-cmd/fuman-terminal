const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const LIVE = process.argv.includes("--live");
const STATIC_ONLY = process.argv.includes("--static-only") || !LIVE;

const blockers = [];
const warnings = [];
const evidence = {};

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
  ]) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function addIssue(list, ok, code, detail = {}) {
  if (!ok) list.push({ code, detail });
}

function includesAll(file, markers) {
  const text = read(file);
  for (const marker of markers) {
    addIssue(blockers, text.includes(marker), `${file}:missing:${marker}`);
  }
  return text;
}

function numberValue(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(/[,%]/g, "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value) {
  if (value === true) return true;
  if (value === false) return false;
  return /^(1|true|yes|ok|ready)$/i.test(String(value ?? "").trim());
}

function taipeiClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    text: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function isRegularSession(clock = taipeiClock()) {
  const minutes = clock.hour * 60 + clock.minute;
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 35;
}

function staticChecks() {
  const runner = includesAll("ops/public-slot/Run-PublicSlotSharedSource.ps1", [
    "Intraday1mSelfHealEnabled",
    "Intraday1mSelfHealStaleSeconds",
    "Intraday1mSelfHealCooldownSeconds",
    "FUMAN_PUBLIC_SLOT_INTRADAY_1M_SELF_HEAL_ENABLED",
    "FUMAN_PUBLIC_SLOT_INTRADAY_1M_SELF_HEAL_STALE_SECONDS",
    "FUMAN_PUBLIC_SLOT_INTRADAY_1M_SELF_HEAL_COOLDOWN_SECONDS",
    "public-slot-intraday-1m-self-heal-state.json",
    "function Invoke-Intraday1mSelfHeal",
    "function Merge-IntradayStatsWithFallbackRows",
    "Update-MinuteRows -QuoteRows $QuoteRows -CandidateSymbols $CandidateSymbols",
    "Write-PublicSlotIntraday1m -Rows $rows",
    "intraday_1m_self_heal_enabled",
    "intraday_1m_self_heal_triggered",
    "intraday_1m_self_heal_reason",
    "intraday_1m_self_heal_rows",
    "self_heal_current_batch",
  ]);

  const watchdog = includesAll("ops/public-slot/Watchdog-PublicSlotSharedSource.ps1", [
    "Invoke-PublicSlotWatchdogAlert",
    "send-workflow-alert.js",
    "FUMAN_ALERT_RECEIPT_FILE",
    "public-slot-shared-source-watchdog-alert.json",
    "public-slot-shared-source-watchdog",
    "quote/collector 健康不可遮蔽 1m writer 失速",
    "MinIntraday1mCoverage",
    "MinReadyGe35Coverage",
    "CoverageHardGateStart",
    "today_1m_symbols coverage 低於",
    "ready_ge35 coverage 低於",
    "Start-SharedSourceTask -Reason",
    "-Alert",
  ]);

  includesAll("ops/public-slot/public-slot-shared-source.config.example.json", [
    "\"intraday1mSelfHealEnabled\": true",
    "\"intraday1mSelfHealStaleSeconds\": 75",
    "\"intraday1mSelfHealCooldownSeconds\": 30",
  ]);

  const staleRestartIndex = watchdog.indexOf("quote/collector 健康不可遮蔽 1m writer 失速");
  const quoteHealthyEarlyExitIndex = watchdog.indexOf("且 live collector/quote 有活資料；不因 source_status 落後而重啟");
  addIssue(
    blockers,
    staleRestartIndex >= 0 && quoteHealthyEarlyExitIndex >= 0 && staleRestartIndex < quoteHealthyEarlyExitIndex,
    "watchdog_intraday_stale_must_precede_quote_healthy_early_exit",
    { staleRestartIndex, quoteHealthyEarlyExitIndex },
  );

  evidence.static = {
    runnerHasSelfHeal: runner.includes("function Invoke-Intraday1mSelfHeal"),
    runnerHasPayloadEvidence: runner.includes("intraday_1m_self_heal_triggered"),
    watchdogHasAlertReceipt: watchdog.includes("public-slot-shared-source-watchdog-alert.json"),
    watchdogHasCoverageHardGate: watchdog.includes("today_1m_symbols coverage 低於") && watchdog.includes("ready_ge35 coverage 低於"),
    watchdogIntradayStaleBeforeQuoteEarlyExit: staleRestartIndex >= 0 && staleRestartIndex < quoteHealthyEarlyExitIndex,
  };
}

async function restGet(pathAndQuery) {
  const baseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || readSecret("supabase-service-role-key.txt")
    || readSecret("supabase-anon-key.txt");
  if (!key) return { skipped: true, reason: "missing Supabase key" };
  const url = `${baseUrl.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`;
  const response = await fetch(url, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return JSON.parse(text);
}

async function liveChecks() {
  if (STATIC_ONLY) {
    evidence.live = { skipped: true, reason: "run with --live after release deploy to inspect source_status payload" };
    return;
  }

  const rows = await restGet("source_status?source_name=eq.fugle_shared_source&select=source_name,status,updated_at,message,payload&limit=1");
  if (rows?.skipped) {
    warnings.push({ code: "live_skipped", detail: rows });
    evidence.live = rows;
    return;
  }
  const row = Array.isArray(rows) ? rows[0] : null;
  addIssue(blockers, Boolean(row), "source_status_missing");
  if (!row) return;

  const payload = row.payload || {};
  const clock = taipeiClock();
  const regular = isRegularSession(clock);
  const staleSeconds = numberValue(payload.intraday_1m_stale_seconds, 999999);
  const thresholdSeconds = numberValue(payload.intraday_1m_self_heal_threshold_seconds, 999999);
  const cooldownSeconds = numberValue(payload.intraday_1m_self_heal_cooldown_seconds, 999999);

  addIssue(blockers, boolValue(payload.intraday_1m_self_heal_enabled), "source_status_missing_self_heal_enabled", payload);
  addIssue(blockers, "intraday_1m_self_heal_triggered" in payload, "source_status_missing_self_heal_triggered");
  addIssue(blockers, "intraday_1m_self_heal_reason" in payload, "source_status_missing_self_heal_reason");
  addIssue(blockers, thresholdSeconds <= 75, "source_status_self_heal_threshold_too_loose", { thresholdSeconds });
  addIssue(blockers, cooldownSeconds <= 60, "source_status_self_heal_cooldown_too_loose", { cooldownSeconds });

  if (regular) {
    addIssue(blockers, staleSeconds <= 180, "regular_session_intraday_1m_stale_over_watchdog_restart_gate", { staleSeconds });
    addIssue(blockers, numberValue(payload.today_1m_symbols) > 0, "regular_session_today_1m_symbols_zero", payload);
    addIssue(blockers, boolValue(payload.quote_derived_1m_full_universe), "regular_session_quote_derived_not_full_universe", payload);
  } else if (staleSeconds > 180) {
    warnings.push({ code: "off_session_intraday_1m_stale_not_blocking", detail: { staleSeconds, clock: clock.text } });
  }

  evidence.live = {
    sourceName: row.source_name,
    status: row.status,
    updatedAt: row.updated_at,
    clockTaipei: clock.text,
    regularSession: regular,
    intraday1mStaleSeconds: staleSeconds,
    today1mSymbols: numberValue(payload.today_1m_symbols),
    readyGe35: numberValue(payload.ready_ge_35_symbols ?? payload.ready_ge_35),
    selfHealEnabled: boolValue(payload.intraday_1m_self_heal_enabled),
    selfHealTriggered: boolValue(payload.intraday_1m_self_heal_triggered),
    selfHealReason: payload.intraday_1m_self_heal_reason || "",
    selfHealRows: numberValue(payload.intraday_1m_self_heal_rows),
    selfHealThresholdSeconds: thresholdSeconds,
    selfHealCooldownSeconds: cooldownSeconds,
    statsSource: payload.intraday_1m_stats_source || "",
  };
}

async function main() {
  staticChecks();
  await liveChecks();

  const result = {
    ok: blockers.length === 0,
    unattendedScope: "shared_source_intraday_1m_self_heal",
    staticOnly: STATIC_ONLY,
    blockers,
    warnings,
    evidence,
    checkedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    unattendedScope: "shared_source_intraday_1m_self_heal",
    error: error?.message || String(error),
    blockers,
    warnings,
    evidence,
    checkedAt: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
});
