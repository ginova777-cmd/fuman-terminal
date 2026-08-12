"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const dns = require("dns");
try { dns.setDefaultResultOrder("ipv4first"); } catch {}
const { spawnSync } = require("child_process");
const { Client } = require("pg");

const ROOT = process.env.FUMAN_ROOT || "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SOURCE_NAME = "fugle_daytrade_source";
const DEDICATED_WRITER_TASK = "Fuman Daytrade Source Writer 0600-1330";
const OUT_DIR = path.join(RUNTIME_DIR, "state");
const PROD_OUT_DIR = process.env.DAYTRADE_UNATTENDED_OUTPUT_DIR || "C:/Users/ginov/Documents/Codex/buy-sell-autonomy-main/outputs";
const LOG_DIR = path.join(RUNTIME_DIR, "logs");
const PRIORITY_FILE = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-ws-priority-symbols.json");
const STRATEGY_PRIORITY_BRIDGE_CACHE_FILE = path.join(RUNTIME_DIR, "cache", "intraday", "fugle-strategy-chip-priority-bridge.json");
const STATUS_FILE = path.join(RUNTIME_DIR, "state", "fugle-websocket-status.json");
const RATE_STATE_FILE = path.join(RUNTIME_DIR, "state", "fugle-rest-collector-rate-state.json");
const SELF_HEAL_RETRY_COUNT = safeNumber(process.env.DAYTRADE_GATE_RETRY_COUNT, 3);
const SELF_HEAL_RETRY_INTERVAL_SECONDS = safeNumber(process.env.DAYTRADE_GATE_RETRY_INTERVAL_SECONDS, 20);
const FORMAL_DAYTRADE_PRIORITY_LIMIT = Math.max(1, safeNumber(process.env.DAYTRADE_FORMAL_PRIORITY_LIMIT, 40));
const DAYTRADE_WARMUP_WRITER_BUILD = "daytrade-warmup-websocket-hard-gate-20260721-01";
const PHASE_SCHEDULE_MINUTES = { "0700": 7 * 60, "0845": 8 * 60 + 45, "0900": 9 * 60 };
const NATURAL_SCHEDULE_WINDOW_MINUTES = Math.max(1, safeNumber(process.env.DAYTRADE_NATURAL_SCHEDULE_WINDOW_MINUTES, 20));
const RUNTIME_CONTEXT = {
  phase: argValue("phase", defaultPhase()),
  tradeDate: taipeiTradeDate(),
  runId: "",
  logFile: "",
};

function readSecret(name) {
  const candidates = [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
    path.join(process.cwd(), name),
  ];
  for (const file of candidates) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readPriorityBridgeFields() {
  const current = readJson(PRIORITY_FILE, {});
  const bridge = current.priorityBridge || readJson(STRATEGY_PRIORITY_BRIDGE_CACHE_FILE, {});
  const groups = bridge && bridge.groups && typeof bridge.groups === "object" ? bridge.groups : {};
  if (!Object.keys(groups).length) return {};
  const fields = { priorityBridge: bridge };
  for (const key of ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "warrant", "cb"]) {
    const group = groups[key] || {};
    const status = String(group.status || "").toLowerCase();
    if (["ready", "blocked", "empty"].includes(status)) {
      fields[key] = Array.isArray(group.symbols) ? group.symbols : [];
    }
  }
  return fields;
}
function appendLog(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${new Date().toISOString()} ${value}\n`, "utf8");
}

function writePhaseArtifacts(phase, output) {
  const normalized = normalizeGateOutput(phase, output);
  const dated = compactTradeDate(normalized.trade_date);
  const evidenceDate = dated || compactTradeDate(RUNTIME_CONTEXT.tradeDate) || "unknown";
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const evidenceFiles = [
    path.join(OUT_DIR, `daytrade-unattended-gate-${phase}-evidence-${evidenceDate}-${stamp}-${process.pid}.json`),
    path.join(PROD_OUT_DIR, `daytrade-unattended-gate-${phase}-evidence-${evidenceDate}-${stamp}-${process.pid}.json`),
  ];
  const isNatural = normalized.natural_schedule_evidence === true
    && normalized.manual_verification_only !== true;
  normalized.evidence_type = isNatural ? "natural_schedule" : "manual_or_recovery";
  normalized.evidence_written_at = new Date().toISOString();
  for (const file of evidenceFiles) writeJson(file, normalized);

  const canonicalFiles = [
    path.join(OUT_DIR, `daytrade-unattended-gate-${phase}.json`),
    path.join(PROD_OUT_DIR, `daytrade-unattended-gate-${phase}.json`),
  ];
  if (dated) {
    canonicalFiles.push(path.join(OUT_DIR, `daytrade-unattended-gate-${phase}-${dated}.json`));
    canonicalFiles.push(path.join(PROD_OUT_DIR, `daytrade-unattended-gate-${phase}-${dated}.json`));
  }
  const files = [...evidenceFiles];
  for (const file of canonicalFiles) {
    const existing = readJson(file, null);
    const existingDate = compactTradeDate(existing?.trade_date);
    const existingNatural = existingDate === dated
      && existing?.natural_schedule_evidence === true
      && existing?.manual_verification_only !== true;
    if (!existingNatural || isNatural) {
      writeJson(file, normalized);
      files.push(file);
    }
  }
  return files;
}
function writeAlertArtifact(phase, output) {
  const alert = {
    receipt_type: "daytrade_phase_blocked_receipt",
    alert_type: "daytrade_unattended_gate_checkpoint_failed",
    blocked_receipt: true,
    source_name: SOURCE_NAME,
    checked_at: output.checked_at,
    trade_date: output.trade_date,
    phase,
    run_id: output.run_id,
    gate_grade: output.gate_grade,
    gate_status: output.gate_status,
    blocked_reason: output.gate_reason || (output.failed_checks || []).join(";"),
    blocked_reason_code: failureCode(output.gate_reason || (output.failed_checks || [])[0] || "UNKNOWN_FAILURE"),
    failure_codes: [...new Set((output.failed_checks || []).map(failureCode))],
    formal_entry_speed_verdict: "NO",
    scanner_can_run_opening: false,
    failed_checks: output.failed_checks || [],
    priority_pool_symbols: output.priority_pool_symbols,
    priority_fresh_quote_coverage_120s: output.priority_fresh_quote_coverage_120s,
    fresh_quotes_120s: output.fresh_quotes_120s,
    quote_age_seconds: output.quote_age_seconds,
    active_429_cooldown: output.active_429_cooldown,
    preserve_previous_good: true,
    latest_update_allowed: false,
    stdout_log: output.stdout_log || "",
    stderr_log: output.stderr_log || "",
    runtime_log: output.stdout_stderr_log_file || "",
    ...currentWriterFingerprint(),
  };
  const files = [
    path.join(OUT_DIR, `daytrade-unattended-gate-alert-${phase}.json`),
    path.join(PROD_OUT_DIR, `daytrade-unattended-gate-alert-${phase}.json`),
  ];
  for (const file of files) writeJson(file, alert);
  return files;
}

function writeFailureArtifact(error) {
  const phase = RUNTIME_CONTEXT.phase || argValue("phase", defaultPhase());
  const tradeDate = RUNTIME_CONTEXT.tradeDate || taipeiTradeDate();
  const runId = RUNTIME_CONTEXT.runId || makeRunId(phase);
  const message = error && (error.stack || error.message) ? (error.stack || error.message) : String(error);
  const output = {
    ok: false,
    unattended_yes: false,
    phase,
    trade_date: tradeDate,
    run_id: runId,
    checked_at: new Date().toISOString(),
    gate_grade: "D",
    gate_status: "runtime_failure",
    gate_reason: "runtime_exception_before_success_artifact",
    formal_entry_speed_verdict: "NO",
    formal_entry_stopped: true,
    formal_entry_allowed: false,
    latest_update_allowed: false,
    preserve_previous_good: true,
    no_empty_latest: true,
    no_latest_pointer_update: true,
    blocked_receipt_required: true,
    failed_checks: ["runtime_exception"],
    self_heal_count: 0,
    last_self_heal_at: new Date().toISOString(),
    last_self_heal_reason: "runtime_exception",
    last_self_heal_action: "write_failure_artifact_preserve_previous_good",
    retry_result: {
      attempted: false,
      reason: "runtime_exception_before_gate_evaluation",
      recovered: false,
    },
    fatal_error: message,
    stdout_stderr_log_file: RUNTIME_CONTEXT.logFile || "",
    processEvidence: {
      node: process.execPath,
      argv: process.argv,
      cwd: process.cwd(),
      runtime_dir: RUNTIME_DIR,
      output_dir: OUT_DIR,
      production_output_dir: PROD_OUT_DIR,
    },
  };
  const files = writePhaseArtifacts(phase, output);
  if (RUNTIME_CONTEXT.logFile) {
    appendLog(RUNTIME_CONTEXT.logFile, `FAILURE_ARTIFACT ${files.join(";")}`);
    appendLog(RUNTIME_CONTEXT.logFile, `STDERR ${message}`);
  }
  return files;
}

function taipeiDateParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function taipeiTradeDate(date = new Date()) {
  const p = taipeiDateParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function taipeiMinute(date = new Date()) {
  const p = taipeiDateParts(date);
  return Number(p.hour) * 60 + Number(p.minute);
}

function isAfter0845() {
  return taipeiMinute() >= 8 * 60 + 45;
}
function isAfter0900() {
  return taipeiMinute() >= 9 * 60;
}
function formatTaipeiMinute(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return "unknown";
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildScheduleEvidence(phase, date = new Date()) {
  const expectedMinute = PHASE_SCHEDULE_MINUTES[String(phase)];
  const checkedMinute = taipeiMinute(date);
  const natural = Number.isFinite(expectedMinute)
    && checkedMinute >= expectedMinute
    && checkedMinute <= expectedMinute + NATURAL_SCHEDULE_WINDOW_MINUTES;
  return {
    expected_phase: String(phase),
    expected_taipei_time: formatTaipeiMinute(expectedMinute),
    expected_minute: Number.isFinite(expectedMinute) ? expectedMinute : null,
    checked_taipei_minute: checkedMinute,
    checked_taipei_time: formatTaipeiMinute(checkedMinute),
    schedule_window_minutes: NATURAL_SCHEDULE_WINDOW_MINUTES,
    natural_schedule_evidence: natural,
    manual_verification_only: !natural,
    natural_schedule_reason: natural ? "inside_natural_schedule_window" : "outside_natural_schedule_window_or_unknown_phase",
  };
}


function currentCommitSha() {
  const envSha = process.env.FUMAN_RELEASE_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.COMMIT_SHA;
  if (envSha) return envSha;
  try {
    const result = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000, windowsHide: true });
    const sha = String(result.stdout || "").trim();
    if (result.status === 0 && sha) return sha;
  } catch {}
  return "unknown";
}

function currentWriterFingerprint() {
  return {
    writer_build: DAYTRADE_WARMUP_WRITER_BUILD,
    commit_sha: currentCommitSha(),
    hostname: os.hostname(),
    pid: process.pid,
  };
}

function failureCode(failure) {
  const text = String(failure || "");
  if (text.startsWith("task_missed:")) return `TASK_MISSED_${text.split(":")[1] || "UNKNOWN"}`.toUpperCase();
  if (text.includes("natural_schedule_evidence")) return "MISSING_NATURAL_SCHEDULE_EVIDENCE";
  if (text.includes("manual_verification_only")) return "MANUAL_VERIFICATION_ONLY";
  if (text.includes("priorityPoolSymbols") || text.includes("priority_pool_symbols")) return "PRIORITY_POOL_NOT_40";
  if (text.includes("priorityFreshQuoteCoverage120s") || text.includes("priority_fresh_quote_coverage_120s") || text.includes("fresh_quotes_120s_or_priority_ready")) return "PRIORITY_COVERAGE_LT_095";
  if (text.includes("scannerCanRunOpening") || text.includes("scanner_can_run_opening")) return "SCANNER_OPENING_FALSE";
  if (text.includes("formalEntrySpeedVerdict") || text.includes("formal_entry_speed_verdict")) return "FORMAL_VERDICT_NO";
  if (text.includes("websocket")) return "WEBSOCKET_NOT_READY";
  if (text.includes("quoteAgeSeconds") || text.includes("quote_age_seconds")) return "QUOTE_STALE";
  if (text.includes("intraday_1m") || text.includes("today_1m")) return "INTRADAY_1M_NOT_FRESH";
  if (text.includes("daily_volume_status")) return "DAILY_VOLUME_NOT_READY";
  if (text.includes("issues:") || text.includes("failed_checks")) return "ISSUES_NOT_EMPTY";
  if (text.includes("GateGrade") || text.includes("gate_grade")) return "GATE_NOT_A";
  if (text.includes("missing_or_invalid_artifact")) return "MISSING_OR_INVALID_ARTIFACT";
  return text.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "UNKNOWN_FAILURE";
}

function previousCalendarTradeDate(tradeDate) {
  const ms = Date.parse(`${tradeDate}T00:00:00+08:00`);
  if (!Number.isFinite(ms)) return "";
  const p = taipeiDateParts(new Date(ms - 24 * 60 * 60 * 1000));
  return `${p.year}-${p.month}-${p.day}`;
}

function previousUnattendedYes(tradeDate) {
  const previousDate = previousCalendarTradeDate(tradeDate);
  if (!previousDate) return "UNKNOWN";
  const file = path.join(PROD_OUT_DIR, `daytrade-warmup-unattended-summary-${previousDate.replace(/-/g, "")}.json`);
  const row = readJson(file, {});
  return row.unattended_yes || row.unattendedYes || "UNKNOWN";
}

function nextTaipeiRunAt(hour, minute) {
  const now = new Date();
  const p = taipeiDateParts(now);
  const today = `${p.year}-${p.month}-${p.day}`;
  const candidate = new Date(`${today}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`);
  if (candidate.getTime() > now.getTime()) return candidate.toISOString();
  return new Date(candidate.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function buildOpsPolicy({ yes, failedPhase, failureCodes, previousUnattendedYes, selfHealRecovered }) {
  const uniqueCodes = [...new Set(failureCodes || [])];
  const firstCode = uniqueCodes[0] || null;
  const taskMissed = uniqueCodes.some((code) => String(code).startsWith("TASK_MISSED_"));
  const sourceNotReady = uniqueCodes.some((code) => [
    "PRIORITY_POOL_NOT_40",
    "PRIORITY_COVERAGE_LT_095",
    "QUOTE_STALE",
    "INTRADAY_1M_NOT_FRESH",
    "DAILY_VOLUME_NOT_READY",
    "SCANNER_OPENING_FALSE",
    "FORMAL_VERDICT_NO",
  ].includes(code));
  return {
    policy_decision: yes ? "ALLOW_FORMAL_SCAN" : "FAIL_CLOSED_PRESERVE_PREVIOUS_GOOD",
    scanner_action: yes ? "ALLOW_SCANNER_OPENING" : "BLOCK_SCANNER_OPENING",
    publish_action: yes ? "ALLOW_TODAY_FORMAL_PUBLISH" : "PREVIOUS_GOOD_ONLY",
    latest_action: yes ? "ALLOW_LATEST_UPDATE" : "BLOCK_LATEST_UPDATE",
    incident_status: yes ? "NONE" : "OPEN",
    incident_severity: yes ? "NONE" : (taskMissed ? "CRITICAL" : "HIGH"),
    incident_reason_code: firstCode,
    incident_reason_codes: uniqueCodes,
    first_failed_phase: failedPhase[0] || null,
    self_heal_action: yes ? "NO_ACTION" : (taskMissed ? "QUEUE_TASK_MISSED_DIAGNOSTIC_ONLY_DO_NOT_BACKFILL_NATURAL" : "QUEUE_SOURCE_RECHECK_DO_NOT_BACKFILL_NATURAL"),
    self_heal_does_not_count_as_natural: true,
    self_heal_recovered: Boolean(selfHealRecovered),
    next_retry_at: yes ? null : nextTaipeiRunAt(7, 0),
    next_retry_policy: yes ? "NONE" : "next natural 0700/0845/0900 evidence required; manual retry cannot set unattended YES",
    owner_message: yes
      ? "當沖暖機三段自然 evidence 全綠，可宣告 unattended YES。"
      : `當沖暖機 fail-closed：${failedPhase[0] || "unknown"} failed, code=${firstCode || "UNKNOWN"}; preserve previous good, do not enter formal scan.`,
    previous_unattended_yes: previousUnattendedYes,
    auto_recovered: previousUnattendedYes === "NO" && yes,
    regressed_today: previousUnattendedYes === "YES" && !yes,
    source_not_ready: sourceNotReady,
    task_missed: taskMissed,
  };
}
function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function toDaytradeWarmupEvidence(output) {
  const issues = Array.isArray(output.issues)
    ? output.issues
    : (Array.isArray(output.failed_checks) ? output.failed_checks : []);
  return {
    phase: output.phase,
    checked_at: output.checked_at,
    trade_date: output.trade_date,
    daytradeGateGrade: firstDefined(output.daytradeGateGrade, output.gate_grade, "D"),
    priorityGateGrade: firstDefined(output.priorityGateGrade, output.priority_gate_grade, output.gate_grade, "D"),
    priorityPoolSymbols: firstDefined(output.priorityPoolSymbols, output.priority_pool_symbols),
    priorityFreshQuoteCoverage120s: firstDefined(output.priorityFreshQuoteCoverage120s, output.priority_fresh_quote_coverage_120s),
    priorityFreshQuotes120s: firstDefined(output.priorityFreshQuotes120s, output.priority_fresh_quotes_120s, output.priority_fresh_120s, output.fresh_quotes_120s),
    quoteAgeSeconds: firstDefined(output.quoteAgeSeconds, output.quote_age_seconds),
    scannerCanRunOpening: output.scannerCanRunOpening === true || output.scanner_can_run_opening === true,
    formalEntrySpeedVerdict: firstDefined(output.formalEntrySpeedVerdict, output.formal_entry_speed_verdict, "NO"),
    readyMa20Continuous: firstDefined(output.readyMa20Continuous, output.ready_ma20),
    readyMa35Continuous: firstDefined(output.readyMa35Continuous, output.ready_ma35),
    issues,
  };
}

function compactTradeDate(value) {
  return String(value || String()).replace(/\D/g, String()).slice(0, 8);
}
function normalizeGateOutput(phase, output) {
  const scheduleEvidence = output.schedule_evidence || buildScheduleEvidence(phase);
  const evidence = toDaytradeWarmupEvidence(output);
  return {
    ...output,
    ...evidence,
    phase,
    issues: evidence.issues,
    schedule_evidence: scheduleEvidence,
    natural_schedule_evidence: scheduleEvidence.natural_schedule_evidence,
    manual_verification_only: scheduleEvidence.manual_verification_only,
    expected_schedule_time: scheduleEvidence.expected_taipei_time,
    schedule_window_minutes: scheduleEvidence.schedule_window_minutes,
    phase_unattended_evidence_ready: output.ok === true && scheduleEvidence.natural_schedule_evidence === true,
    unattended_yes_scope: "daily_summary_only",
    daytradeWarmupEvidence: {
      ...evidence,
      scheduleEvidence,
    },
  };
}

function makeRunId(phase) {
  return `${SOURCE_NAME}-${phase}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${process.pid}`;
}

function defaultPhase() {
  const m = taipeiMinute();
  if (m < 8 * 60 + 45) return "0700";
  if (m < 9 * 60) return "0845";
  if (m < 9 * 60 + 10) return "0900";
  if (m < 9 * 60 + 35) return "0910";
  return "0935";
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeBool(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function cooldownUntilFromStatus(status, rateState) {
  const candidates = [
    status.cooldownUntil,
    status.adaptiveCooldownUntil,
    rateState.cooldownUntil,
    rateState.priorityOnlyUntil,
  ].filter(Boolean);
  let latest = null;
  for (const value of candidates) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (!latest || ms > latest.getTime()) latest = new Date(ms);
  }
  return latest;
}

function runSchtask(name) {
  const enableResult = name === DEDICATED_WRITER_TASK
    ? spawnSync("schtasks.exe", ["/Change", "/TN", name, "/ENABLE"], {
        encoding: "utf8",
        timeout: 20000,
        windowsHide: true,
      })
    : null;
  const result = spawnSync("schtasks.exe", ["/Run", "/TN", name], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    enable_status: enableResult ? enableResult.status : null,
    enable_stdout: enableResult ? String(enableResult.stdout || "").trim() : "",
    enable_stderr: enableResult ? String(enableResult.stderr || "").trim() : "",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDbError(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return text.includes("statement timeout")
    || text.includes("canceling statement due to statement timeout")
    || text.includes("echeckouttimeout")
    || text.includes("unable to check out connection from the pool")
    || text.includes("timeout")
    || text.includes("terminating connection")
    || text.includes("connection terminated")
    || text.includes("econnreset")
    || text.includes("enotfound")
    || text.includes("eai_again")
    || text.includes("getaddrinfo")
    || text.includes("econnrefused")
    || text.includes("57014");
}

async function withDbRetry(label, operation, options = {}) {
  const attempts = Math.max(1, safeNumber(options.attempts ?? process.env.DAYTRADE_DB_RETRY_ATTEMPTS, 4));
  const baseDelayMs = Math.max(0, safeNumber(options.baseDelayMs ?? process.env.DAYTRADE_DB_RETRY_DELAY_MS, 1500));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientDbError(error)) throw error;
      appendLog(RUNTIME_CONTEXT.logFile || path.join(LOG_DIR, "daytrade-unattended-gate-db-retry.log"), `DB_RETRY label=${label} attempt=${attempt}/${attempts} reason=${error?.message || error}`);
      await sleep(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

function gateWriteFailure(error, phase, runId, step) {
  const message = String(error?.message || error || "unknown gate write failure").slice(0, 1000);
  const reasonCode = isTransientDbError(error)
    ? "supabase_gate_write_timeout"
    : "supabase_gate_write_failed";
  appendLog(
    RUNTIME_CONTEXT.logFile || path.join(LOG_DIR, "daytrade-unattended-gate-write-failure.log"),
    `GATE_WRITE_FAILURE phase=${phase} run_id=${runId} step=${step} reason=${reasonCode} message=${message}`,
  );
  return {
    ok: false,
    status: "not_persisted",
    reason_code: reasonCode,
    step,
    message,
    preserve_previous_good: true,
    latest_update_allowed: false,
    blocked_receipt_required: true,
    local_evidence_required: true,
  };
}

async function connectDb(dbUrl) {
  const attempts = Math.max(1, safeNumber(process.env.DAYTRADE_DB_CONNECT_ATTEMPTS, 4));
  const baseDelayMs = Math.max(0, safeNumber(process.env.DAYTRADE_DB_CONNECT_RETRY_DELAY_MS, 500));
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      query_timeout: 12000,
      statement_timeout: 10000,
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      if (attempt >= attempts || !isTransientDbError(error)) throw error;
      appendLog(RUNTIME_CONTEXT.logFile || path.join(LOG_DIR, "daytrade-unattended-gate-db-retry.log"), `DB_RETRY label=db_connect attempt=${attempt}/${attempts} reason=${error?.message || error}`);
      await sleep(baseDelayMs * attempt);
    }
  }
  throw lastError;
}

function shouldRetryGate(failed) {
  const retryable = new Set([
    "priority_fresh_quote_coverage_120s",
    "fresh_quotes_120s_or_priority_ready",
    "quote_age_seconds",
    "today_1m_symbols_after_0900",
    "intraday_1m_stale_seconds_after_0900",
    "active_429_cooldown",
  ]);
  return failed.some((name) => retryable.has(name));
}

function selfHealAction(activeCooldown) {
  return activeCooldown ? "cooldown_wait_then_dedicated_priority_retry" : "dedicated_priority_retry_no_full_market";
}

function maybeRunDedicatedWriterTask() {
  if (process.env.DAYTRADE_GATE_ALLOW_WRITER_START !== "1") {
    return {
      skipped: true,
      reason: "writer_start_disabled_by_policy",
      policy: "gate/watchdog is read-only; writer starts only from the 06:00 dedicated task",
      task_name: DEDICATED_WRITER_TASK,
    };
  }
  if (process.env.DAYTRADE_GATE_SKIP_WRITER === "1") {
    return {
      skipped: true,
      reason: "DAYTRADE_GATE_SKIP_WRITER=1",
      task_name: DEDICATED_WRITER_TASK,
    };
  }
  return runSchtask(DEDICATED_WRITER_TASK);
}

async function evaluateGate(client, phase, runId, taskRun, prioritySymbols) {
  const status = readJson(STATUS_FILE, {});
  const metrics = await collectMetrics(client);
  const collectorRunning = Boolean(status.pid) && Number.isFinite(Number(status.pid));
  const watchdogRunning = true;
  const { checks, activeCooldown, cooldownUntil } = buildChecks(metrics, status, collectorRunning, watchdogRunning);
  const verdict = verdictFromChecks(checks);
  const processEvidence = {
    phase,
    runId,
    dedicatedWriterTask: DEDICATED_WRITER_TASK,
    dedicatedWriterTaskRun: taskRun,
    prioritySymbolsWritten: prioritySymbols.length,
    collectorRunning,
    watchdogRunning,
    collectorStatusUpdatedAt: status.updatedAt || "",
    collectorPid: status.pid || null,
    openingBoostActive: safeBool(status.openingBoostActive),
    activeCooldown,
    cooldownUntil,
    adaptivePriorityOnly: safeBool(status.adaptivePriorityOnly),
    adaptiveSelectionUniverse: status.adaptiveSelectionUniverse || "",
  };
  return { status, metrics, checks, verdict, processEvidence, activeCooldown, cooldownUntil };
}

async function runSelfHealLoop(client, phase, runId, taskRun, prioritySymbols, firstEvaluation, logFile) {
  const attempts = [];
  let evaluation = firstEvaluation;
  const isWatchdogPhase = String(phase).toLowerCase() === "watchdog";
  const retryCount = isWatchdogPhase ? 0 : SELF_HEAL_RETRY_COUNT;
  const retryIntervalSeconds = isWatchdogPhase ? 0 : SELF_HEAL_RETRY_INTERVAL_SECONDS;
  const retryEnabled = retryCount > 0 && shouldRetryGate(evaluation.verdict.failed);
  if (!retryEnabled || evaluation.verdict.gateGrade === "A") {
    return {
      evaluation,
      retryResult: {
        attempted: false,
        reason: evaluation.verdict.gateGrade === "A"
          ? "gate_ready_no_self_heal_needed"
          : (isWatchdogPhase ? "watchdog_fast_check_no_retry" : "no_retryable_failed_checks"),
        watchdog_fast_check: isWatchdogPhase,
        attempts,
        final_gate_grade: evaluation.verdict.gateGrade,
        final_failed_checks: evaluation.verdict.failed,
      },
    };
  }

  for (let i = 1; i <= retryCount; i += 1) {
    const reason = evaluation.verdict.gateReason;
    const action = selfHealAction(evaluation.activeCooldown);
    appendLog(logFile, `SELF_HEAL attempt=${i}/${retryCount} reason=${reason} action=${action}`);
    const dedicatedWriterTaskRun = maybeRunDedicatedWriterTask();
    if (retryIntervalSeconds > 0) {
      await sleep(retryIntervalSeconds * 1000);
    }
    evaluation = await evaluateGate(client, phase, runId, dedicatedWriterTaskRun, prioritySymbols);
    attempts.push({
      attempt: i,
      checked_at: new Date().toISOString(),
      reason,
      action,
      retry_interval_seconds: retryIntervalSeconds,
      dedicated_writer_task_run: dedicatedWriterTaskRun,
      gate_grade: evaluation.verdict.gateGrade,
      gate_status: evaluation.verdict.gateStatus,
      failed_checks: evaluation.verdict.failed,
      priority_fresh_quote_coverage_120s: safeNumber(evaluation.metrics.priority_fresh_quote_coverage_120s),
      quote_age_seconds: safeNumber(evaluation.metrics.quote_age_seconds, 999999),
      today_1m_symbols: safeNumber(evaluation.metrics.today_1m_symbols),
      intraday_1m_stale_seconds: safeNumber(evaluation.metrics.intraday_stale, 999999),
      active_429_cooldown: evaluation.activeCooldown,
      cooldown_until: evaluation.cooldownUntil ? evaluation.cooldownUntil.toISOString() : null,
    });
    if (evaluation.verdict.gateGrade === "A" || !shouldRetryGate(evaluation.verdict.failed)) break;
  }

  return {
    evaluation,
    retryResult: {
      attempted: true,
      max_retries: retryCount,
      retry_interval_seconds: retryIntervalSeconds,
      priority_only_retry: true,
      full_market_retry_disabled: true,
      watchdog_fast_check: isWatchdogPhase,
      attempts,
      final_gate_grade: evaluation.verdict.gateGrade,
      final_gate_status: evaluation.verdict.gateStatus,
      final_failed_checks: evaluation.verdict.failed,
      recovered: evaluation.verdict.gateGrade === "A",
    },
  };
}

function readPhaseArtifact(phase) {
  return readJson(path.join(PROD_OUT_DIR, `daytrade-unattended-gate-${phase}.json`), {
    ok: false,
    phase,
    __read_error: "missing_artifact",
  });
}

function writeBlockedReceipt(verdict) {
  const tradeDate = verdict.trade_date || taipeiTradeDate();
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const receipt = {
    receipt_type: "daytrade_final_verdict_blocked_receipt",
    source_name: SOURCE_NAME,
    trade_date: tradeDate,
    checked_at: verdict.checked_at,
    run_id: verdict.run_id,
    unattended_yes: "NO",
    formal_entry_speed_verdict: "NO",
    latest_update_allowed: false,
    preserve_previous_good: true,
    failed_phase: verdict.failed_phase,
    failed_checks: verdict.failed_checks,
    failure_codes: [...new Set((verdict.failed_checks || []).map(failureCode))],
    ...currentWriterFingerprint(),
    no_empty_latest: true,
    no_latest_pointer_update: true,
  };
  const files = [
    path.join(OUT_DIR, `daytrade-final-verdict-blocked-${tradeDate.replace(/-/g, "")}-${stamp}.json`),
    path.join(PROD_OUT_DIR, `daytrade-final-verdict-blocked-${tradeDate.replace(/-/g, "")}-${stamp}.json`),
  ];
  for (const file of files) writeJson(file, receipt);
  return files;
}

function writeFinalVerdictArtifact(runId, triggerPhase = "0910") {
  const tradeDate = taipeiTradeDate();
  const phases = ["0700", "0845", "0900"];
  const artifacts = Object.fromEntries(phases.map((phase) => [phase, readPhaseArtifact(phase)]));
  const hasAny = (row, names) => names.some((name) => Object.prototype.hasOwnProperty.call(row, name) && row[name] !== null && row[name] !== undefined);
  const valueOf = (row, ...names) => firstDefined(...names.map((name) => row[name]));
  const failedPhase = [];
  const failedChecks = [];
  const phaseResults = {};
  for (const phase of phases) {
    const artifact = artifacts[phase];
    const evidence = toDaytradeWarmupEvidence(artifact);
    const naturalScheduleEvidence = artifact.natural_schedule_evidence === true || artifact.schedule_evidence?.natural_schedule_evidence === true;
    const manualVerificationOnly = artifact.manual_verification_only === true || artifact.schedule_evidence?.manual_verification_only === true;
    const phaseFailures = [];
    if (artifact.__read_error) phaseFailures.push(`task_missed:${phase}`);
    if (artifact.__read_error) phaseFailures.push(`missing_or_invalid_artifact:${artifact.__read_error}`);
    if (evidence.trade_date !== tradeDate) phaseFailures.push(`trade_date:${evidence.trade_date || "missing"}`);
    if (!naturalScheduleEvidence) phaseFailures.push("natural_schedule_evidence_missing_or_false");
    if (manualVerificationOnly) phaseFailures.push("manual_verification_only_true");
    if (!hasAny(artifact, ["daytradeGateGrade", "gate_grade"])) phaseFailures.push("daytradeGateGrade_missing");
    if (evidence.daytradeGateGrade !== "A") phaseFailures.push(`daytradeGateGrade:${evidence.daytradeGateGrade || "missing"}`);
    if (!hasAny(artifact, ["priorityGateGrade", "priority_gate_grade", "gate_grade"])) phaseFailures.push("priorityGateGrade_missing");
    if (evidence.priorityGateGrade !== "A") phaseFailures.push(`priorityGateGrade:${evidence.priorityGateGrade || "missing"}`);
    if (!hasAny(artifact, ["priorityPoolSymbols", "priority_pool_symbols"])) phaseFailures.push("priorityPoolSymbols_missing");
    if (safeNumber(evidence.priorityPoolSymbols, -1) !== FORMAL_DAYTRADE_PRIORITY_LIMIT) phaseFailures.push(`priorityPoolSymbols:${valueOf(artifact, "priorityPoolSymbols", "priority_pool_symbols") ?? "missing"}_not_${FORMAL_DAYTRADE_PRIORITY_LIMIT}`);
    if (!hasAny(artifact, ["priorityFreshQuoteCoverage120s", "priority_fresh_quote_coverage_120s"])) phaseFailures.push("priorityFreshQuoteCoverage120s_missing");
    if (safeNumber(evidence.priorityFreshQuoteCoverage120s, -1) < 0.95) phaseFailures.push(`priorityFreshQuoteCoverage120s:${valueOf(artifact, "priorityFreshQuoteCoverage120s", "priority_fresh_quote_coverage_120s") ?? "missing"}_lt_0.95`);
    if (!hasAny(artifact, ["priorityFreshQuotes120s", "priority_fresh_quotes_120s", "priority_fresh_120s", "fresh_quotes_120s"])) phaseFailures.push("priorityFreshQuotes120s_missing");
    if (!hasAny(artifact, ["quoteAgeSeconds", "quote_age_seconds"])) phaseFailures.push("quoteAgeSeconds_missing");
    if (safeNumber(evidence.quoteAgeSeconds, 999999) > 90) phaseFailures.push("quoteAgeSeconds_gt_90");
    if (!hasAny(artifact, ["scannerCanRunOpening", "scanner_can_run_opening"])) phaseFailures.push("scannerCanRunOpening_missing");
    if (evidence.scannerCanRunOpening !== true) phaseFailures.push("scannerCanRunOpening_false");
    if (!hasAny(artifact, ["formalEntrySpeedVerdict", "formal_entry_speed_verdict"])) phaseFailures.push("formalEntrySpeedVerdict_missing");
    if (evidence.formalEntrySpeedVerdict !== "YES") phaseFailures.push(`formalEntrySpeedVerdict:${evidence.formalEntrySpeedVerdict || "missing"}`);
    if (!hasAny(artifact, ["readyMa20Continuous", "ready_ma20", "ready_ma20_continuous_symbols"])) phaseFailures.push("readyMa20Continuous_missing");
    if (!hasAny(artifact, ["readyMa35Continuous", "ready_ma35", "ready_ma35_continuous_symbols"])) phaseFailures.push("readyMa35Continuous_missing");
    if (!Array.isArray(artifact.issues) && !Array.isArray(artifact.failed_checks)) phaseFailures.push("issues_missing");
    if (evidence.issues.length > 0) phaseFailures.push(`issues:${evidence.issues.join(";")}`);
    if (artifact.active_429_cooldown === true) phaseFailures.push("active_429_cooldown_true");
    if (phase === "0900") {
      if (safeNumber(artifact.intraday_1m_stale_seconds, 999999) > 120) phaseFailures.push("intraday_1m_stale_seconds_gt_120");
      if (safeNumber(artifact.today_1m_symbols) <= 0) phaseFailures.push("today_1m_symbols_lte_0");
      if (artifact.daily_volume_status !== "ready") phaseFailures.push("daily_volume_status_not_ready");
    }
    phaseResults[phase] = {
      pass: phaseFailures.length === 0,
      failures: phaseFailures,
      evidence: {
        ...evidence,
        naturalScheduleEvidence,
        manualVerificationOnly,
        selfHeal: artifact.retry_result?.attempted === true || safeNumber(artifact.self_heal_count) > 0,
        selfHealRecovered: artifact.retry_result?.recovered === true,
        preservePreviousGood: artifact.preserve_previous_good !== false,
      },
      artifact: path.join(PROD_OUT_DIR, `daytrade-unattended-gate-${phase}.json`),
    };
    if (phaseFailures.length > 0) {
      failedPhase.push(phase);
      failedChecks.push(...phaseFailures.map((item) => `${phase}:${item}`));
    }
  }
  const yes = failedChecks.length === 0;
  const previous_unattended_yes = previousUnattendedYes(tradeDate);
  const uniqueFailureCodes = [...new Set(failedChecks.map(failureCode))];
  const selfHealRecovered = Object.values(phaseResults).some((report) => report.evidence.selfHealRecovered);
  const opsPolicy = buildOpsPolicy({ yes, failedPhase, failureCodes: uniqueFailureCodes, previousUnattendedYes: previous_unattended_yes, selfHealRecovered });
  const natural_schedule_evidence_by_phase = Object.fromEntries(Object.entries(phaseResults).map(([phase, report]) => [phase, report.evidence.naturalScheduleEvidence === true]));
  const output = {
    summary_type: "daytrade_warmup_unattended_summary_v1",
    ok: yes,
    unattended_yes: yes ? "YES" : "NO",
    source_name: SOURCE_NAME,
    checked_at: new Date().toISOString(),
    trade_date: tradeDate,
    trigger_phase: triggerPhase,
    run_id: runId,
    phases_required: phases,
    phase_results: phaseResults,
    "0700": phaseResults["0700"].pass ? "PASS" : "FAIL",
    "0845": phaseResults["0845"].pass ? "PASS" : "FAIL",
    "0900": phaseResults["0900"].pass ? "PASS" : "FAIL",
    failed_phase: failedPhase,
    first_failed_phase: failedPhase[0] || null,
    failed_checks: failedChecks,
    failure_reasons: failedChecks,
    failure_codes: uniqueFailureCodes,
    natural_schedule_evidence_by_phase,
    self_heal: Object.values(phaseResults).some((report) => report.evidence.selfHeal),
    self_heal_recovered: selfHealRecovered,
    self_heal_does_not_count_as_natural: true,
    formal_entry_allowed: yes,
    formal_entry_speed_verdict: yes ? "YES" : "NO",
    latest_update_allowed: yes,
    preserve_previous_good: !yes,
    previous_unattended_yes,
    regressed_today: previous_unattended_yes === "YES" && !yes,
    auto_recovered: previous_unattended_yes === "NO" && yes,
    ops_policy: opsPolicy,
    policy_decision: opsPolicy.policy_decision,
    incident_status: opsPolicy.incident_status,
    incident_reason_codes: opsPolicy.incident_reason_codes,
    next_retry_at: opsPolicy.next_retry_at,
    owner_message: opsPolicy.owner_message,
    ...currentWriterFingerprint(),
    fallbackUsed: Object.values(artifacts).some((artifact) => artifact.fallbackUsed === true),
    no_empty_latest: true,
    no_latest_pointer_update_when_blocked: !yes,
    blocked_receipt_required: !yes,
    manual_verification_pass_only: !yes && Object.values(phaseResults).some((report) => report.evidence.manualVerificationOnly),
    rule: "Unattended YES requires natural scheduled 0700/0845/0900 evidence, priorityPoolSymbols=40, priorityFreshQuoteCoverage120s>=0.95, scannerCanRunOpening=true, formalEntrySpeedVerdict=YES, issues=[].",
    excluded_from_daytrade_warmup_gate: ["membership", "terminal_ui", "/88", "desktop", "mobile"],
    artifact_paths: {
      "0700": path.join(PROD_OUT_DIR, "daytrade-unattended-gate-0700.json"),
      "0845": path.join(PROD_OUT_DIR, "daytrade-unattended-gate-0845.json"),
      "0900": path.join(PROD_OUT_DIR, "daytrade-unattended-gate-0900.json"),
      summary_runtime: path.join(OUT_DIR, `daytrade-warmup-unattended-summary-${tradeDate.replace(/-/g, "")}.json`),
      summary_production: path.join(PROD_OUT_DIR, `daytrade-warmup-unattended-summary-${tradeDate.replace(/-/g, "")}.json`),
      final_runtime: path.join(OUT_DIR, "daytrade-unattended-final-verdict.json"),
      final_production: path.join(PROD_OUT_DIR, "daytrade-unattended-final-verdict.json"),
    },
    phases: artifacts,
  };
  if (!yes) output.blocked_receipt_paths = writeBlockedReceipt(output);
  const files = [output.artifact_paths.summary_runtime, output.artifact_paths.summary_production, output.artifact_paths.final_runtime, output.artifact_paths.final_production];
  for (const file of files) writeJson(file, output);
  return { output, files };
}

async function queryOne(client, sql, params = [], label = "queryOne") {
  const result = await withDbRetry(label, () => client.query(sql, params), { attempts: 3, baseDelayMs: 800 });
  return result.rows[0] || {};
}

async function refreshPriorityPool(client) {
  const existing = await withDbRetry("priority_pool_existing", () => client.query(`
    select symbol
    from public.fugle_daytrade_priority_pool
    order by priority_rank asc, symbol asc
    limit 700
  `));
  if (existing.rows.length >= 300) {
    const symbols = existing.rows.map((row) => row.symbol);
    const daytradePrioritySymbols = symbols.slice(0, 450);
    writeJson(PRIORITY_FILE, {
    ...readPriorityBridgeFields(),
      updatedAt: new Date().toISOString(),
      source: "fugle_daytrade_source_priority_pool_existing",
      count: symbols.length,
      daytradePrioritySymbols,
      daytradePriorityCount: daytradePrioritySymbols.length,
      terminalPrioritySymbols: [...new Set([...daytradePrioritySymbols, ...symbols])],
      openingPrioritySymbols: [...new Set([...daytradePrioritySymbols, ...symbols])],
      primaryPrioritySymbols: [...new Set([...daytradePrioritySymbols, ...symbols])],
      symbols: [...new Set([...daytradePrioritySymbols, ...symbols])],
    });
    return symbols;
  }
  await withDbRetry("priority_pool_truncate", () => client.query("truncate table public.fugle_daytrade_priority_pool"));
  await withDbRetry("priority_pool_rebuild", () => client.query(`
    insert into public.fugle_daytrade_priority_pool (
      symbol, name, market, priority_rank, priority_reason, source, updated_at, payload
    )
    with base as (
      select
        t.symbol,
        t.name,
        t.market,
        coalesce(d.avg_volume5, d.volume, 0) as avg5_volume
      from public.stock_tickers t
      left join public.fugle_daytrade_daily_volume_avg d on d.symbol = t.symbol
      where t.symbol ~ '^[0-9]{4}$'
        and t.symbol not like '00%'
        and coalesce(t.is_etf, false) = false
        and coalesce(t.is_suspended, false) = false
        and (
          nullif(t.stock_type, '') is null
          or upper(t.stock_type) in ('COMMONSTOCK', 'COMMON', 'STOCK')
        )
    ),
    dedup as (
      select *
      from (
        select
          base.*,
          row_number() over (partition by symbol order by avg5_volume desc nulls last, name asc, market asc) as symbol_rn
        from base
      ) x
      where symbol_rn = 1
    ),
    ranked as (
      select *, row_number() over (order by avg5_volume desc nulls last, symbol asc) as rn
      from dedup
    )
    select
      symbol,
      name,
      market,
      rn::integer,
      case when avg5_volume > 0 then 'avg5_volume_rank' else 'stock_master_fallback' end,
      'daytrade_unattended_gate_runtime',
      now(),
      jsonb_build_object(
        'avg5_volume', avg5_volume,
        'pool_limit', 700,
        'formal_entry_allowed', false,
        'usage', 'priority_selection_evidence_only',
        'refreshed_at', now()
      )
    from ranked
    where rn <= 700
  `), { attempts: 2, baseDelayMs: 2500 });
  const rows = await withDbRetry("priority_pool_readback", () => client.query(`
    select symbol
    from public.fugle_daytrade_priority_pool
    order by priority_rank asc
  `));
  const symbols = rows.rows.map((row) => row.symbol);
  const daytradePrioritySymbols = symbols.slice(0, 450);
  writeJson(PRIORITY_FILE, {
    ...readPriorityBridgeFields(),
    updatedAt: new Date().toISOString(),
    source: "fugle_daytrade_source_priority_pool",
    count: symbols.length,
    daytradePrioritySymbols,
    daytradePriorityCount: daytradePrioritySymbols.length,
    terminalPrioritySymbols: [...new Set([...daytradePrioritySymbols, ...symbols])],
    openingPrioritySymbols: [...new Set([...daytradePrioritySymbols, ...symbols])],
    primaryPrioritySymbols: [...new Set([...daytradePrioritySymbols, ...symbols])],
    symbols: [...new Set([...daytradePrioritySymbols, ...symbols])],
  });
  return symbols;
}

async function collectSourceSnapshot(client) {
  const sourceStatus = await withDbRetry("source_snapshot_status", () => client.query(`
    select source_name, trade_date, status, updated_at, stale_seconds, message,
           source_kind, is_realtime, is_fallback, is_formal_entry_eligible, payload
    from public.source_status
    where source_name = 'fugle_daytrade_source'
    order by source_name asc
  `), { attempts: 3, baseDelayMs: 800 }).then((result) => result.rows).catch((error) => [{ error: error.message }]);
  const contractHealth = await queryOne(client, `select * from public.v_fugle_daytrade_source_contract_health limit 1`).catch((error) => ({ error: error.message }));
  const latestScorecard = await queryOne(client, `select * from public.v_fugle_daytrade_source_latest_scorecard limit 1`).catch((error) => ({ error: error.message }));
  const futoptHealth = await queryOne(client, `
    select
      count(*)::integer as contract_rows,
      count(*) filter (where updated_at >= now() - interval '180 seconds')::integer as ready_rows,
      count(*) filter (where updated_at < now() - interval '180 seconds')::integer as stale_rows,
      max(updated_at) as latest_futopt_updated_at,
      case
        when count(*) filter (where updated_at >= now() - interval '180 seconds') > 0 then 'ready'
        when count(*) > 0 then 'stale'
        else 'empty'
      end as source_status,
      'dedicated_fugle_daytrade_futopt_quotes_live' as source
    from public.fugle_daytrade_futopt_quotes_live
  `).catch((error) => ({ error: error.message }));
  return {
    source_status: sourceStatus,
    contract_health: contractHealth,
    latest_scorecard: latestScorecard,
    dedicated_futopt_health: futoptHealth,
  };
}
async function collectMetrics(client) {
  const row = await queryOne(client, `
    select trade_date, status, updated_at, payload
    from public.source_status
    where source_name = $1
    order by updated_at desc nulls last
    limit 1
  `, [SOURCE_NAME]);
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const numberFrom = (...names) => {
    for (const name of names) {
      const value = payload[name];
      if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
  };
  const textFrom = (...names) => {
    for (const name of names) {
      const value = payload[name];
      if (value !== null && value !== undefined && String(value) !== "") return String(value);
    }
    return "";
  };
  const boolFrom = (...names) => {
    for (const name of names) {
      const value = payload[name];
      if (value === true || value === false) return value;
      if (typeof value === "string" && /^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
    }
    return null;
  };
  const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
  const sourceAgeSeconds = updatedAt && Number.isFinite(updatedAt.getTime())
    ? Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 1000))
    : 999999;
  // Stale/degraded source is a normal fail-closed state, not a runtime crash.
  // Keep the evidence and let buildChecks/verdict decide A/B/C/D.
  const sourcePayloadFresh = Boolean(
    row.updated_at
    && sourceAgeSeconds <= 180
    && String(row.status || "") === "ok"
  );
  const canonical = await queryOne(client, `
    select
      gate_grade, gate_status, formal_entry_speed_verdict, formal_entry_allowed,
      priority_pool_symbols, priority_fresh_quote_coverage_120s, scanner_can_run_opening,
      quote_age_seconds, daily_volume_status, intraday_1m_stale_seconds,
      futopt_gate_status, futopt_txf_ok, txf_ok, futopt_ready_rows,
      futopt_stale_rows, futopt_contract_rows
    from public.v_fugle_daytrade_canonical_gate
    limit 1
  `);
  const sourceTradeDate = row.trade_date && Number.isFinite(new Date(row.trade_date).getTime())
    ? taipeiTradeDate(new Date(row.trade_date))
    : "";
  const priorityPool = numberFrom("priority_pool_symbols", "priorityPoolSymbols");
  const priorityFresh = numberFrom("priority_fresh_quotes_120s", "priorityFreshQuotes120s", "priority_fresh_120s");
  const stockRows = numberFrom("futopt_stock_quote_universe", "futopt_stock_mapped", "futoptStockQuoteUniverse", "futoptStockMapped");
  const stockReadyRows = numberFrom("futopt_stock_future_ready_rows", "futopt_stock_quotes_this_loop", "futopt_stock_this_loop", "futoptStockQuotesThisLoop");
  const txfReadyRows = numberFrom("futopt_txf_ready_rows", "txf_quotes_this_loop", "futopt_txf_quotes_this_loop", "futoptTxfReadyRows");
  return {
    checked_at: new Date().toISOString(),
    fresh_quotes_120s: numberFrom("fresh_quotes_120s", "freshQuotes120s"),
    quote_age_seconds: numberFrom("quote_age_seconds", "quoteAgeSeconds"),
    source_payload_age_seconds: sourceAgeSeconds,
    source_payload_fresh: sourcePayloadFresh,
    source_status: String(row.status || ""),
    source_trade_date: sourceTradeDate,
    source_daytrade_gate_grade: textFrom("daytrade_gate_grade", "daytradeGateGrade", "gate_grade"),
    source_formal_entry_allowed: textFrom("formal_entry_allowed", "formalEntryAllowed").toLowerCase(),
    source_websocket_connected: boolFrom("websocket_connected", "websocketConnected"),
    source_websocket_authenticated: boolFrom("websocket_authenticated", "websocketAuthenticated"),
    source_websocket_formal_ready: boolFrom("websocket_formal_ready", "websocketFormalReady"),
    source_websocket_mode: textFrom("websocket_mode", "websocketMode"),
    source_websocket_primary_source: textFrom("formal_source_name", "formalSourceName", "primary_source", "primarySource"),
    source_websocket_rest_disabled: boolFrom("websocket_rest_disabled", "websocketRestDisabled"),
    canonical_gate_grade: String(canonical.gate_grade || ""),
    canonical_gate_status: String(canonical.gate_status || ""),
    canonical_formal_entry_speed_verdict: String(canonical.formal_entry_speed_verdict || ""),
    canonical_formal_entry_allowed: Boolean(canonical.formal_entry_allowed),
    canonical_futopt_gate_status: String(canonical.futopt_gate_status || ""),
    canonical_futopt_ready_rows: Number(canonical.futopt_ready_rows || 0),
    canonical_futopt_contract_rows: Number(canonical.futopt_contract_rows || 0),
    priority_pool_symbols: priorityPool,
    priority_fresh_120s: priorityFresh,
    priority_fresh_quote_coverage_120s: numberFrom("priority_fresh_quote_coverage_120s", "priorityFreshQuoteCoverage120s"),
    daily_rows: numberFrom("daily_volume_rows", "dailyRows"),
    daily_volume_status: textFrom("daily_volume_status", "dailyVolumeStatus") || (numberFrom("daily_volume_rows", "dailyRows") >= 300 ? "ready" : "not_ready"),
    today_1m_symbols: numberFrom("today_1m_symbols", "today1mSymbols"),
    today_1m_rows: numberFrom("today_1m_rows", "today1mRows"),
    ready_ma20: numberFrom("ready_ma20_continuous", "readyMa20Continuous", "ready_ma20"),
    ready_ma35: numberFrom("ready_ma35_continuous", "readyMa35Continuous", "ready_ma35"),
    intraday_stale: ["intraday_1m_stale_seconds", "intraday1mStaleSeconds", "intraday_stale_seconds"].some((name) => payload[name] !== null && payload[name] !== undefined && payload[name] !== "") ? numberFrom("intraday_1m_stale_seconds", "intraday1mStaleSeconds", "intraday_stale_seconds") : 999999,
    latest_candle_time: textFrom("latest_candle_time", "latestCandleTime"),
    futopt_live_quotes: numberFrom("futopt_contract_rows", "futopt_live_quotes", "futoptLiveQuotes"),
    futopt_stock_rows: stockRows,
    futopt_stock_ready_rows: stockReadyRows,
    futopt_txf_rows: numberFrom("futopt_txf_rows", "futoptTxfRows", "txf_quotes_this_loop", "futopt_txf_quotes_this_loop"),
    futopt_txf_ready_rows: txfReadyRows,
    futopt_source_status: textFrom("futopt_gate_status", "futopt_source_status", "futoptStatus") || (stockReadyRows > 0 && txfReadyRows > 0 ? "ready" : "not_ready"),
    latest_stock_future_updated_at: textFrom("latest_stock_future_updated_at", "latestStockFutureUpdatedAt"),
    latest_txf_updated_at: textFrom("latest_txf_updated_at", "latestTxfUpdatedAt"),
  };
}

function buildChecks(metrics, status, collectorRunning, watchdogRunning) {
  const active429 = safeBool(status.adaptiveRateLimited) || safeBool(status.cooldown);
  const cooldownUntil = cooldownUntilFromStatus(status, readJson(RATE_STATE_FILE, {}));
  const activeCooldown = active429 || Boolean(cooldownUntil && cooldownUntil.getTime() > Date.now());
  const priorityCoverage = safeNumber(metrics.priority_fresh_quote_coverage_120s);
  const priorityPool = safeNumber(metrics.priority_pool_symbols);
  const freshQuotes = safeNumber(metrics.fresh_quotes_120s);
  const quoteAge = safeNumber(metrics.quote_age_seconds, 999999);
  const readyMa20 = safeNumber(metrics.ready_ma20);
  const readyMa35 = safeNumber(metrics.ready_ma35);
  const intradayStale = safeNumber(metrics.intraday_stale, 999999);
  const today1mSymbols = safeNumber(metrics.today_1m_symbols);
  const after0845 = isAfter0845();
  const sourceTradeDate = String(metrics.source_trade_date || "");
  const sourceToday = taipeiTradeDate();
  const futoptStockRows = safeNumber(metrics.futopt_stock_rows);
  const futoptStockReadyRows = safeNumber(metrics.futopt_stock_ready_rows);
  const futoptTxfReadyRows = safeNumber(metrics.futopt_txf_ready_rows);
  const futoptSourceReady = String(metrics.futopt_source_status || "") === "ready";
  const requiredPriorityPool = FORMAL_DAYTRADE_PRIORITY_LIMIT;
  const wsChannels = Array.isArray(status.streamingChannels) ? status.streamingChannels : [];
  const wsUpdatedMs = Date.parse(status.updatedAt || status.lastMessageAt || "");
  const wsStatusAgeSeconds = Number.isFinite(wsUpdatedMs) ? Math.max(0, Math.round((Date.now() - wsUpdatedMs) / 1000)) : 999999;
  const wsRequiredChannelsReady = ["trades", "aggregates", "candles"].every((channel) => wsChannels.includes(channel));
  const wsConnected = status.websocketConnected !== null && status.websocketConnected !== undefined ? safeBool(status.websocketConnected) : metrics.source_websocket_connected === true;
  const wsAuthenticated = status.websocketAuthenticated !== null && status.websocketAuthenticated !== undefined ? safeBool(status.websocketAuthenticated) : metrics.source_websocket_authenticated === true;
  const wsMode = String(status.mode || metrics.source_websocket_mode || "");
  const wsPrimarySource = String(status.primarySource || metrics.source_websocket_primary_source || "");
  const wsRestDisabled = status.restDisabled !== null && status.restDisabled !== undefined ? safeBool(status.restDisabled) : metrics.source_websocket_rest_disabled === true;
  const wsFormalReady = status.websocketFormalReady !== null && status.websocketFormalReady !== undefined ? safeBool(status.websocketFormalReady) : metrics.source_websocket_formal_ready === true;
  const checks = [
    ["collector_running", collectorRunning, collectorRunning, "true"],
    ["websocket_connected", wsConnected, wsConnected, "true"],
    ["websocket_authenticated", wsAuthenticated, wsAuthenticated, "true"],
    ["websocket_streaming_mode", wsMode === "streaming", wsMode, "streaming"],
    ["websocket_primary_source", wsPrimarySource === "fugle-websocket", wsPrimarySource, "fugle-websocket"],
    ["websocket_rest_disabled", wsRestDisabled, wsRestDisabled, "true"],
    ["websocket_formal_ready", wsFormalReady, wsFormalReady, "true"],
    ["websocket_required_channels", wsRequiredChannelsReady, wsChannels.join(","), "trades,aggregates,candles"],
    ["websocket_status_fresh_seconds", wsStatusAgeSeconds <= 180, wsStatusAgeSeconds, "<=180"],
    ["watchdog_running", watchdogRunning, watchdogRunning, "true"],
    ["source_status_ready", metrics.source_status === "ok", metrics.source_status || "missing", "ok"],
    ["source_payload_fresh", metrics.source_payload_fresh === true && safeNumber(metrics.source_payload_age_seconds, 999999) <= 180, metrics.source_payload_age_seconds, "<=180"],
    ["source_trade_date", sourceTradeDate === sourceToday, sourceTradeDate || "missing", sourceToday],
    ["source_daytrade_gate_grade", String(metrics.source_daytrade_gate_grade || "") === "A", metrics.source_daytrade_gate_grade || "missing", "A"],
    ["source_formal_entry_allowed", metrics.source_formal_entry_allowed === "true", metrics.source_formal_entry_allowed || "missing", "true"],
    ["canonical_gate_grade", metrics.canonical_gate_grade === "A", metrics.canonical_gate_grade || "missing", "A"],
    ["canonical_gate_status", metrics.canonical_gate_status === "ready", metrics.canonical_gate_status || "missing", "ready"],
    ["canonical_formal_entry_speed_verdict", metrics.canonical_formal_entry_speed_verdict === "YES", metrics.canonical_formal_entry_speed_verdict || "missing", "YES"],
    ["canonical_formal_entry_allowed", metrics.canonical_formal_entry_allowed === true, metrics.canonical_formal_entry_allowed, "true"],
    ["canonical_futopt_gate_status_after_0845", !after0845 || metrics.canonical_futopt_gate_status === "ready", metrics.canonical_futopt_gate_status || "missing", "ready after 08:45"],
    ["canonical_futopt_ready_rows_after_0845", !after0845 || safeNumber(metrics.canonical_futopt_ready_rows) > 0, metrics.canonical_futopt_ready_rows, ">0 after 08:45"],
    ["priority_pool_symbols", priorityPool === requiredPriorityPool, priorityPool, `=${requiredPriorityPool}`],
    ["priority_fresh_quote_coverage_120s", priorityCoverage >= 0.95, priorityCoverage, ">=0.95"],
    ["fresh_quotes_120s_or_priority_ready", freshQuotes >= 1500 || (priorityPool === requiredPriorityPool && priorityCoverage >= 0.95), freshQuotes, `>=1500 or top${requiredPriorityPool} priority coverage >=0.95`],
    ["quote_age_seconds", quoteAge <= 90, quoteAge, "<=90"],
    ["active_429_cooldown", !activeCooldown, activeCooldown, "false"],
    ["daily_volume_status", metrics.daily_volume_status === "ready", metrics.daily_volume_status, "ready"],
    ["ready_ma20_continuous", readyMa20 >= requiredPriorityPool, readyMa20, `>=${requiredPriorityPool}`],
    ["ready_ma35_continuous", readyMa35 >= requiredPriorityPool, readyMa35, `>=${requiredPriorityPool}`],
    ["today_1m_symbols_after_0900", !isAfter0900() || today1mSymbols > 0, today1mSymbols, ">0 after 09:00"],
    ["intraday_1m_stale_seconds_after_0900", !isAfter0900() || intradayStale <= 120, intradayStale, "<=120 after 09:00"],
    ["futopt_stock_future_rows_after_0845", !after0845 || futoptStockRows > 0, futoptStockRows, ">0 after 08:45"],
    ["futopt_stock_future_fresh_rows_after_0845", !after0845 || futoptStockReadyRows > 0, futoptStockReadyRows, ">0 after 08:45"],
    ["futopt_txf_fresh_rows_after_0845", !after0845 || futoptTxfReadyRows > 0, futoptTxfReadyRows, ">0 after 08:45"],
    ["futopt_source_status_after_0845", !after0845 || futoptSourceReady, metrics.futopt_source_status || "empty", "ready after 08:45"],
  ];
  return { checks, activeCooldown, cooldownUntil };
}

function verdictFromChecks(checks) {
  const failed = checks.filter((check) => !check[1]).map((check) => check[0]);
  const mustA = failed.length === 0;
  const hasBase = checks.find((c) => c[0] === "priority_pool_symbols")?.[1]
    && checks.find((c) => c[0] === "daily_volume_status")?.[1]
    && checks.find((c) => c[0] === "ready_ma20_continuous")?.[1]
    && checks.find((c) => c[0] === "ready_ma35_continuous")?.[1];
  return {
    failed,
    gateGrade: mustA ? "A" : hasBase ? "B" : failed.length < checks.length ? "C" : "D",
    gateStatus: mustA ? "ready" : hasBase ? "degraded" : "not_ready",
    gateReason: mustA ? "all_required_daytrade_evidence_ready" : failed.join(";"),
  };
}

async function latestGate(client) {
  return queryOne(client, `
    select *
    from public.fugle_daytrade_source_gate
    where source_name = $1
    order by checked_at desc
    limit 1
  `, [SOURCE_NAME]);
}

async function writeGate(client, phase, metrics, status, checks, verdict, processEvidence) {
  const tradeDate = taipeiTradeDate();
  const runId = processEvidence.runId || makeRunId(phase);
  let prior = {};
  try {
    prior = await latestGate(client);
  } catch (error) {
    return gateWriteFailure(error, phase, runId, "latest_gate_read");
  }
  const shouldSelfHeal = verdict.gateGrade !== "A";
  const selfHealCount = safeNumber(prior.self_heal_count) + (shouldSelfHeal ? 1 : 0);
  const selfHealAction = shouldSelfHeal
    ? (processEvidence.activeCooldown ? "cooldown_wait_then_priority_only_retry" : "priority_only_retry_no_full_market")
    : "heartbeat_gate_ready";
  const evidence = {
    source: "daytrade_unattended_gate_runtime",
    source_name: SOURCE_NAME,
    run_id: runId,
    phase,
    checked_at: new Date().toISOString(),
    gate_grade: verdict.gateGrade,
    gate_status: verdict.gateStatus,
    failed_checks: verdict.failed,
    self_heal_count: selfHealCount,
    last_self_heal_reason: shouldSelfHeal ? verdict.gateReason : (prior.last_self_heal_reason || ""),
    formal_entry_rule: "formal entry requires fugle_daytrade_source gate_grade A",
    finmind_usage: "warmup_or_observation_only",
    twse_usage: "disabled_for_daytrade_formal_entry",
    yahoo_usage: "disabled_for_daytrade_formal_entry",
    priority_only_retry: shouldSelfHeal,
    full_market_retry_disabled: true,
    collector_status_file: STATUS_FILE,
    priority_symbols_file: PRIORITY_FILE,
    ...processEvidence,
    checks: checks.map(([name, ok, actual, expected]) => ({ name, ok, actual, expected })),
  };
  const okCount = checks.filter((check) => check[1]).length;
  const formalOpeningReady = isAfter0845() && verdict.gateGrade === "A" && checks.every((check) => check[1] === true);
  try {
    await client.query(`
    insert into public.fugle_daytrade_source_gate (
      source_name, trade_date, checked_at, status, gate_grade, gate_status, gate_reason,
      formal_entry_speed_verdict, daytrade_source_speed_ok, actual_quote_speed,
      selected_symbols_fresh_ok, selected_symbols, selected_symbols_fresh_120s,
      selected_symbols_fresh_coverage_120s, priority_pool_symbols, priority_fresh_quote_coverage_120s,
      fresh_quotes_120s, quote_age_seconds, daily_volume_status, scanner_can_run_opening,
      today_1m_symbols, today_1m_rows, intraday_1m_stale_seconds,
      ready_ma20_continuous_symbols, ready_ma35_continuous_symbols,
      min_ready_ma20_symbols, min_ready_ma35_symbols, latest_candle_time,
      active_429_cooldown, cooldown_until, observation_symbols, formal_entry_symbols,
      scorecard_checked_at, scorecard_required_count, scorecard_required_ok_count,
      scorecard_missing_or_failed_checks, scorecard_evidence, source_status_message, payload,
      source_kind, is_realtime, is_fallback, is_formal_entry_eligible,
      formal_entry_authority, warmup_sources_formal_entry_allowed,
      futopt_global_required, futopt_gate_status, futopt_live_status, futopt_live_quotes,
      self_heal_count, last_self_heal_at, last_self_heal_reason, last_self_heal_action,
      collector_running, watchdog_running, watchdog_checked_at, collector_started_at,
      last_429_at, rate_limit_429_count, priority_only_mode
    ) values (
      $1, $2::date, now(), $3, $4, $5, $6,
      case when $7::boolean then 'YES' else 'NO' end, $7::boolean, $8,
      $9, $10, $11,
      $12, $10, $12,
      $13, $14, $15, $16,
      $17, $18, $19,
      $20, $21,
      300, 300, $22,
      $23, $24, $10, case when $4 = 'A' then $10 else 0 end,
      now(), $25, $26,
      $27, $28::jsonb, $6, $29::jsonb,
      'fugle', true, false, true,
      'fugle_daytrade_source_gate_A', false,
      false, case when $7::boolean then 'ready' else 'not_ready' end, case when $30 > 0 then 'available' else 'empty' end, $30, $31,
      case when $32 then now() else $33 end, case when $32 then $6 else $34 end, $35,
      $36, $37, now(), case when $36 then now() else null end,
      $38, $39, $32
    )
    on conflict (source_name, trade_date) do update set
      checked_at = excluded.checked_at,
      status = excluded.status,
      gate_grade = excluded.gate_grade,
      gate_status = excluded.gate_status,
      gate_reason = excluded.gate_reason,
      formal_entry_speed_verdict = excluded.formal_entry_speed_verdict,
      daytrade_source_speed_ok = excluded.daytrade_source_speed_ok,
      actual_quote_speed = excluded.actual_quote_speed,
      selected_symbols_fresh_ok = excluded.selected_symbols_fresh_ok,
      selected_symbols = excluded.selected_symbols,
      selected_symbols_fresh_120s = excluded.selected_symbols_fresh_120s,
      selected_symbols_fresh_coverage_120s = excluded.selected_symbols_fresh_coverage_120s,
      priority_pool_symbols = excluded.priority_pool_symbols,
      priority_fresh_quote_coverage_120s = excluded.priority_fresh_quote_coverage_120s,
      fresh_quotes_120s = excluded.fresh_quotes_120s,
      quote_age_seconds = excluded.quote_age_seconds,
      daily_volume_status = excluded.daily_volume_status,
      scanner_can_run_opening = excluded.scanner_can_run_opening,
      today_1m_symbols = excluded.today_1m_symbols,
      today_1m_rows = excluded.today_1m_rows,
      intraday_1m_stale_seconds = excluded.intraday_1m_stale_seconds,
      ready_ma20_continuous_symbols = excluded.ready_ma20_continuous_symbols,
      ready_ma35_continuous_symbols = excluded.ready_ma35_continuous_symbols,
      latest_candle_time = excluded.latest_candle_time,
      active_429_cooldown = excluded.active_429_cooldown,
      cooldown_until = excluded.cooldown_until,
      scorecard_checked_at = excluded.scorecard_checked_at,
      scorecard_required_count = excluded.scorecard_required_count,
      scorecard_required_ok_count = excluded.scorecard_required_ok_count,
      scorecard_missing_or_failed_checks = excluded.scorecard_missing_or_failed_checks,
      scorecard_evidence = excluded.scorecard_evidence,
      source_status_message = excluded.source_status_message,
      payload = excluded.payload,
      futopt_gate_status = excluded.futopt_gate_status,
      futopt_live_status = excluded.futopt_live_status,
      futopt_live_quotes = excluded.futopt_live_quotes,
      self_heal_count = excluded.self_heal_count,
      last_self_heal_at = excluded.last_self_heal_at,
      last_self_heal_reason = excluded.last_self_heal_reason,
      last_self_heal_action = excluded.last_self_heal_action,
      collector_running = excluded.collector_running,
      watchdog_running = excluded.watchdog_running,
      watchdog_checked_at = excluded.watchdog_checked_at,
      collector_started_at = coalesce(public.fugle_daytrade_source_gate.collector_started_at, excluded.collector_started_at),
      last_429_at = excluded.last_429_at,
      rate_limit_429_count = excluded.rate_limit_429_count,
      priority_only_mode = excluded.priority_only_mode
  `, [
    SOURCE_NAME,
    tradeDate,
    verdict.gateStatus,
    verdict.gateGrade,
    verdict.gateStatus,
    verdict.gateReason,
    formalOpeningReady,
    1 / Math.max(1, safeNumber(metrics.quote_age_seconds, 999999)),
    checks.find((c) => c[0] === "priority_fresh_quote_coverage_120s")?.[1] || false,
    safeNumber(metrics.priority_pool_symbols),
    safeNumber(metrics.priority_fresh_120s),
    safeNumber(metrics.priority_fresh_quote_coverage_120s),
    safeNumber(metrics.fresh_quotes_120s),
    safeNumber(metrics.quote_age_seconds, 999999),
    metrics.daily_volume_status,
    formalOpeningReady,
    safeNumber(metrics.today_1m_symbols),
    safeNumber(metrics.today_1m_rows),
    safeNumber(metrics.intraday_stale, 999999),
    safeNumber(metrics.ready_ma20),
    safeNumber(metrics.ready_ma35),
    metrics.latest_candle_time || null,
    processEvidence.activeCooldown,
    processEvidence.cooldownUntil ? processEvidence.cooldownUntil.toISOString() : null,
    checks.length,
    okCount,
    verdict.failed,
    JSON.stringify(evidence),
    JSON.stringify({ ...evidence, metrics }),
    safeNumber(metrics.futopt_live_quotes),
    selfHealCount,
    shouldSelfHeal,
    prior.last_self_heal_at || null,
    verdict.gateReason,
    selfHealAction,
    processEvidence.collectorRunning,
    processEvidence.watchdogRunning,
    status.last429At || readJson(RATE_STATE_FILE, {}).last429At || null,
    safeNumber(status.adaptive429WindowCount || readJson(RATE_STATE_FILE, {}).window429Count),
  ]);

  await client.query(`
    insert into public.fugle_daytrade_gate_scorecard (
      source_name, trade_date, checked_at, gate_grade, gate_status, gate_reason,
      formal_entry_speed_verdict, selected_symbols_fresh_ok, scanner_can_run_opening,
      scorecard_required_count, scorecard_required_ok_count, scorecard_missing_or_failed_checks, evidence
    ) values ($1, $2::date, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
  `, [
    SOURCE_NAME,
    tradeDate,
    verdict.gateGrade,
    verdict.gateStatus,
    verdict.gateReason,
    formalOpeningReady,
    checks.find((c) => c[0] === "priority_fresh_quote_coverage_120s")?.[1] || false,
    formalOpeningReady,
    checks.length,
    okCount,
    verdict.failed,
    JSON.stringify(evidence),
  ]);

  for (const [name, ok, actual, expected] of checks) {
    await client.query(`
      insert into public.fugle_daytrade_source_scorecard (
        source_name, trade_date, checked_at, check_name, ok, actual_text, expected_text, actual_numeric, evidence
      ) values ($1, $2::date, now(), $3, $4, $5, $6, $7, $8::jsonb)
    `, [
      SOURCE_NAME,
      tradeDate,
      name,
      ok,
      typeof actual === "object" ? JSON.stringify(actual) : String(actual),
      String(expected),
      Number.isFinite(Number(actual)) ? Number(actual) : null,
      JSON.stringify({
        source: "daytrade_unattended_gate_runtime",
        source_name: SOURCE_NAME,
        run_id: runId,
        phase,
        checked_at: evidence.checked_at,
        check: name,
        ok,
        actual,
        expected,
        gate_grade: verdict.gateGrade,
        gate_status: verdict.gateStatus,
        failed_checks: verdict.failed,
        self_heal_count: selfHealCount,
        last_self_heal_reason: shouldSelfHeal ? verdict.gateReason : (prior.last_self_heal_reason || ""),
      }),
    ]);
  }

  await client.query(`
    insert into public.source_status (
      source_name, trade_date, updated_at, status, message, last_success_at, stale_seconds,
      payload, source_kind, is_realtime, is_fallback, is_formal_entry_eligible
    ) values ($1, $2::date, now(), $3, $4, $5, $6, $7::jsonb, 'fugle', true, false, true)
    on conflict (source_name) do update set
      payload = coalesce(public.source_status.payload, '{}'::jsonb)
        || jsonb_build_object(
          'unattended_gate_evidence', excluded.payload,
          'unattended_gate_grade', excluded.payload->>'gate_grade',
          'unattended_gate_status', excluded.payload->>'gate_status',
          'unattended_gate_reason', excluded.payload->>'gate_reason',
          'unattended_gate_checked_at', excluded.payload->>'checked_at'
        )
  `, [
    SOURCE_NAME,
    tradeDate,
    verdict.gateGrade === "A" ? "ok" : "degraded",
    verdict.gateReason,
    verdict.gateGrade === "A" ? new Date().toISOString() : null,
    safeNumber(metrics.quote_age_seconds, 999999),
    JSON.stringify({ ...evidence, gate_grade: verdict.gateGrade, gate_status: verdict.gateStatus }),
  ]);
  return {
    ok: true,
    status: "persisted",
    reason_code: "",
    run_id: runId,
    phase,
    trade_date: tradeDate,
  };
  } catch (error) {
    return gateWriteFailure(error, phase, runId, "gate_evidence_write");
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(PROD_OUT_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const phase = RUNTIME_CONTEXT.phase;
  const tradeDate = RUNTIME_CONTEXT.tradeDate;
  const runId = makeRunId(phase);
  RUNTIME_CONTEXT.runId = runId;
  const logFile = path.join(LOG_DIR, `daytrade-unattended-gate-${phase}-${tradeDate.replace(/-/g, "")}.log`);
  RUNTIME_CONTEXT.logFile = logFile;
  appendLog(logFile, `START phase=${phase} run_id=${runId}`);
  const dbUrl = process.env.SUPABASE_DB_URL || readSecret("supabase-db-url.txt") || readSecret("postgres-url.txt");
  if (!dbUrl) throw new Error("missing Supabase DB URL");
  const client = await connectDb(dbUrl);
  try {
    const taskRun = maybeRunDedicatedWriterTask();
    const prioritySymbols = await refreshPriorityPool(client);
    const firstEvaluation = await evaluateGate(client, phase, runId, taskRun, prioritySymbols);
    const healed = await runSelfHealLoop(client, phase, runId, taskRun, prioritySymbols, firstEvaluation, logFile);
    const { status, metrics, checks, verdict, processEvidence, activeCooldown, cooldownUntil } = healed.evaluation;
    processEvidence.selfHeal = healed.retryResult;
    const gatePersistence = await writeGate(client, phase, metrics, status, checks, verdict, processEvidence);
    processEvidence.gatePersistence = gatePersistence;
    if (!gatePersistence.ok) {
      const persistenceFailure = gatePersistence.reason_code || "supabase_gate_write_failed";
      verdict.failed = [...new Set([...(verdict.failed || []), persistenceFailure])];
      verdict.gateGrade = "D";
      verdict.gateStatus = "runtime_failure";
      verdict.gateReason = persistenceFailure;
    }
    const sourceSnapshot = await collectSourceSnapshot(client);
    const latestDaytradeGate = await latestGate(client).catch(() => ({}));
    const futoptHealth = sourceSnapshot.dedicated_futopt_health || {};
    const futoptTxfGate = String(metrics.futopt_source_status || "empty") === "ready" ? "A" : (String(metrics.futopt_source_status || "empty") === "stale" ? "D" : "not_ready");
    const formalWindow = isAfter0845();
    const stockFutureReady = safeNumber(metrics.futopt_stock_rows) > 0
      && safeNumber(metrics.futopt_stock_ready_rows) > 0
      && safeNumber(metrics.futopt_txf_ready_rows) > 0
      && String(metrics.futopt_source_status || "") === "ready";
    const scannerCanRunOpening = formalWindow
      && verdict.gateGrade === "A"
      && verdict.failed.length === 0
      && safeNumber(metrics.priority_pool_symbols) === FORMAL_DAYTRADE_PRIORITY_LIMIT
      && safeNumber(metrics.priority_fresh_quote_coverage_120s) >= 0.95
      && stockFutureReady;
    const formalOpeningReady = scannerCanRunOpening;
    const latestFutoptMs = Date.parse(futoptHealth.latest_futopt_updated_at || "");
    const txfReady = Number.isFinite(latestFutoptMs) && (Date.now() - latestFutoptMs) <= 180000;
    const lastSelfHealReason = verdict.gateGrade === "A" ? "" : verdict.gateReason;
    const output = {
      ok: formalOpeningReady,
      unattended_yes: false,
      unattended_yes_scope: "daily_summary_only",
      checked_at: new Date().toISOString(),
      trade_date: tradeDate,
      phase,
      run_id: runId,
      gate_grade: verdict.gateGrade,
      gate_status: verdict.gateStatus,
      gate_reason: verdict.gateReason,
      formal_entry_speed_verdict: formalOpeningReady ? "YES" : "NO",
      formal_entry_allowed: formalOpeningReady,
      formal_entry_stopped: !formalOpeningReady,
      priority_pool_symbols: safeNumber(metrics.priority_pool_symbols),
      priority_fresh_quote_coverage_120s: safeNumber(metrics.priority_fresh_quote_coverage_120s),
      priority_fresh_quotes_120s: safeNumber(metrics.priority_fresh_120s),
      fresh_quotes_120s: safeNumber(metrics.fresh_quotes_120s),
      quote_age_seconds: safeNumber(metrics.quote_age_seconds, 999999),
      scanner_can_run_opening: scannerCanRunOpening,
      intraday_1m_stale_seconds: safeNumber(metrics.intraday_stale, 999999),
      today_1m_symbols: safeNumber(metrics.today_1m_symbols),
      ready_ma20: safeNumber(metrics.ready_ma20),
      ready_ma35: safeNumber(metrics.ready_ma35),
      daily_volume_status: metrics.daily_volume_status || "not_ready",
      futopt_txf_gate: futoptTxfGate,
      futopt_source_status: metrics.futopt_source_status || "unknown",
      futopt_contract_rows: safeNumber(metrics.futopt_live_quotes),
      futopt_ready_rows: safeNumber(metrics.futopt_stock_ready_rows) + safeNumber(metrics.futopt_txf_ready_rows),
      futopt_stale_rows: Math.max(0, safeNumber(metrics.futopt_live_quotes) - safeNumber(metrics.futopt_stock_ready_rows) - safeNumber(metrics.futopt_txf_ready_rows)),
      futopt_stock_mapped: safeNumber(metrics.futopt_stock_rows),
      futopt_stock_quote_universe: safeNumber(metrics.futopt_stock_rows),
      futopt_stock_quotes_this_loop: safeNumber(metrics.futopt_stock_ready_rows),
      futopt_stock_future_ready_rows: safeNumber(metrics.futopt_stock_ready_rows),
      futopt_txf_ready_rows: safeNumber(metrics.futopt_txf_ready_rows),
      txf_ready: safeNumber(metrics.futopt_txf_ready_rows) > 0,
      latest_futopt_updated_at: futoptHealth.latest_futopt_updated_at || null,
      latest_stock_future_updated_at: metrics.latest_stock_future_updated_at || null,
      latest_txf_updated_at: metrics.latest_txf_updated_at || null,
      active_429_cooldown: activeCooldown,
      cooldown_until: cooldownUntil ? cooldownUntil.toISOString() : null,
      failed_checks: verdict.failed,
      self_heal_count: safeNumber(latestDaytradeGate.self_heal_count),
      last_self_heal_reason: latestDaytradeGate.last_self_heal_reason || lastSelfHealReason,
      last_self_heal_at: latestDaytradeGate.last_self_heal_at || (verdict.gateGrade === "A" ? null : new Date().toISOString()),
      last_self_heal_action: latestDaytradeGate.last_self_heal_action || (verdict.gateGrade === "A" ? "heartbeat_gate_ready" : selfHealAction(activeCooldown)),
      cooldown_until: cooldownUntil ? cooldownUntil.toISOString() : null,
      retry_result: healed.retryResult,
      stdout_stderr_log_file: logFile,
      stdout_log: process.env.DAYTRADE_UNATTENDED_STDOUT_LOG || "",
      stderr_log: process.env.DAYTRADE_UNATTENDED_STDERR_LOG || "",
      preserve_previous_good: true,
      latest_update_allowed: formalOpeningReady,
      no_empty_latest: true,
      no_latest_pointer_update_when_blocked: !formalOpeningReady,
      blocked_receipt_required: !formalOpeningReady,
      metrics,
      checks: checks.map(([name, ok, actual, expected]) => ({ name, ok, actual, expected })),
      source_snapshot: sourceSnapshot,
      processEvidence,
    };
    const artifactFiles = writePhaseArtifacts(phase, output);
    appendLog(logFile, `ARTIFACT ${artifactFiles.join(";")}`);
    if (!output.ok) {
      const alertFiles = writeAlertArtifact(phase, output);
      appendLog(logFile, `ALERT ${alertFiles.join(";")}`);
    }
    console.log(JSON.stringify({
      ok: output.ok,
      phase,
      gate_grade: verdict.gateGrade,
      gate_status: verdict.gateStatus,
      priority_pool_symbols: metrics.priority_pool_symbols,
      priority_fresh_quote_coverage_120s: metrics.priority_fresh_quote_coverage_120s,
      quote_age_seconds: metrics.quote_age_seconds,
      active_429_cooldown: activeCooldown,
      failed: verdict.failed,
      outFile: artifactFiles[0],
      productionOutFile: artifactFiles[1],
    }, null, 2));
    appendLog(logFile, `DONE ok=${output.ok} gate=${verdict.gateGrade}/${verdict.gateStatus} failed=${verdict.failed.join(",")}`);
    if (phase === "0910") {
      const finalVerdict = writeFinalVerdictArtifact(runId, phase);
      appendLog(logFile, `FINAL_VERDICT ${finalVerdict.files.join(";")} unattended_yes=${finalVerdict.output.unattended_yes}`);
    }
    process.exitCode = 0;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  try {
    writeFailureArtifact(error);
  } catch (artifactError) {
    const fallbackMessage = artifactError && (artifactError.stack || artifactError.message)
      ? (artifactError.stack || artifactError.message)
      : String(artifactError);
    console.error(`failed to write failure artifact: ${fallbackMessage}`);
  }
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
