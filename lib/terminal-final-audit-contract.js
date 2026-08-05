"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const CONTRACT = "terminal-final-audit-contract-v1";
const STAGES = Object.freeze([
  {
    key: "market_calendar",
    label: "Market Calendar",
    verifier: "scripts/check-market-calendar-action.js",
    allowedAction: "allow_formal_scan_or_skip_formal_scan_preserving_previous_good",
  },
  {
    key: "preflight",
    label: "Predictive Preflight",
    verifier: "scripts/verify-terminal-predictive-preflight.js",
    allowedAction: "wait_or_fix_date_market_calendar_then_rerun_preflight",
  },
  {
    key: "power_recovery",
    label: "Power Recovery",
    verifier: "scripts/verify-terminal-power-recovery.js",
    allowedAction: "restart_or_reinstall_autonomous_root_task_then_rerun_final_audit",
  },
  {
    key: "websocket",
    label: "WebSocket Source",
    verifier: "scripts/verify-fugle-websocket-sources.js",
    allowedAction: "reconnect_or_repair_fugle_websocket_then_rerun_source_verifier",
  },
  {
    key: "water_root",
    label: "Water Root",
    verifier: "scripts/verify-terminal-water-root.js",
    allowedAction: "repair_source_water_root_then_rerun_affected_gate",
  },
  {
    key: "formal_gate",
    label: "Formal Gate",
    verifier: "scripts/verify-strategy-scan-formal-gate.js",
    allowedAction: "wait_or_fix_water_root_then_rerun_formal_gate",
  },
  {
    key: "display_closure",
    label: "Scorecard / Desktop / Mobile / 88 Closure",
    verifier: "scripts/verify-terminal-runid-closure-contract.js",
    allowedAction: "repair_terminal_resource_chain_or_runid_closure_then_rerun_final_audit",
  },
]);

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function compactDate(value, fallback = taipeiDateKey()) {
  const date = String(value || "").replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(date) ? date : fallback;
}

function safeName(value, fallback = "value") {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || fallback;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createDailyRunId(tradeDate = taipeiDateKey(), now = new Date()) {
  const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const entropy = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return `terminal-daily-${compactDate(tradeDate)}-${stamp}-${entropy}`;
}

function resolveDailyRunId({ auditRoot, tradeDate, requested = "" } = {}) {
  const normalizedDate = compactDate(tradeDate);
  const pointer = path.join(auditRoot, normalizedDate, "daily-run-id.json");
  const stored = readJson(pointer, null);
  return String(requested || stored?.daily_run_id || createDailyRunId(normalizedDate));
}

function defaultRuntimeDir() {
  return process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
}

function defaultAuditRoot(root) {
  return path.join(root, "outputs", "terminal-final-audit");
}

function lockPath(runtimeDir = defaultRuntimeDir()) {
  return path.join(runtimeDir, "state", "terminal-daily-orchestrator.lock");
}

function acquireOrchestratorLock({ dailyRunId, tradeDate, runtimeDir = defaultRuntimeDir(), ttlMs = 30 * 60 * 1000 } = {}) {
  const file = lockPath(runtimeDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = Date.now();
  const payload = {
    contract: "terminal-single-daily-orchestrator-lock-v1",
    daily_run_id: String(dailyRunId || ""),
    trade_date: compactDate(tradeDate),
    pid: process.pid,
    host: os.hostname(),
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + Math.max(1000, Number(ttlMs) || 0)).toISOString(),
  };
  try {
    const fd = fs.openSync(file, "wx");
    fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.closeSync(fd);
    return { ok: true, file, payload };
  } catch (error) {
    if (error.code !== "EEXIST") return { ok: false, file, reasonCode: "orchestrator_lock_create_failed", error: String(error.message || error) };
    const existing = readJson(file, {});
    const expiresAt = Date.parse(existing.expires_at || "");
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      const stale = `${file}.stale-${now}`;
      try {
        fs.renameSync(file, stale);
        return acquireOrchestratorLock({ dailyRunId, tradeDate, runtimeDir, ttlMs });
      } catch (staleError) {
        return { ok: false, file, reasonCode: "orchestrator_lock_stale_but_not_reclaimable", holder: existing, error: String(staleError.message || staleError) };
      }
    }
    return { ok: false, file, reasonCode: "orchestrator_lock_held", holder: existing };
  }
}

function releaseOrchestratorLock(lock) {
  if (!lock?.ok || !lock.file) return { ok: true, released: false };
  const current = readJson(lock.file, null);
  if (!current || current.daily_run_id !== lock.payload?.daily_run_id) {
    return { ok: false, released: false, reasonCode: "orchestrator_lock_owner_mismatch" };
  }
  try {
    fs.unlinkSync(lock.file);
    return { ok: true, released: true, file: lock.file };
  } catch (error) {
    return { ok: false, released: false, reasonCode: "orchestrator_lock_release_failed", error: String(error.message || error) };
  }
}

function parseLastJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    const whole = JSON.parse(raw);
    if (whole && typeof whole === "object") return whole;
  } catch {}
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === "object") return value;
    } catch {}
  }
  for (let index = raw.indexOf("{"); index >= 0; index = raw.indexOf("{", index + 1)) {
    try {
      const value = JSON.parse(raw.slice(index));
      if (value && typeof value === "object") return value;
    } catch {}
  }
  return null;
}

function reasonCodeFor(stage, parsed, output = "", fallback = "stage_not_ready") {
  if (parsed?.reasonCode) return String(parsed.reasonCode);
  const issueCodes = Array.isArray(parsed?.issues)
    ? parsed.issues.map((issue) => String(issue?.code || "")).filter(Boolean)
    : [];
  if (stage === "websocket" && issueCodes.length) {
    if (issueCodes.includes("stock_websocket_status_stale")) return "stock_websocket_status_stale";
    if (issueCodes.includes("stock_websocket_not_connected")) return "stock_websocket_not_connected";
    if (issueCodes.includes("stock_websocket_not_authenticated")) return "stock_websocket_not_authenticated";
    if (issueCodes.includes("stock_websocket_not_streaming")) return "stock_websocket_not_streaming";
    if (issueCodes.includes("futopt_websocket_status_stale")) return "futopt_websocket_status_stale";
    if (issueCodes.includes("futopt_websocket_not_connected")) return "futopt_websocket_not_connected";
    if (issueCodes.includes("futopt_websocket_not_authenticated")) return "futopt_websocket_not_authenticated";
    if (issueCodes.includes("futopt_websocket_not_streaming")) return "futopt_websocket_not_streaming";
    return issueCodes[0];
  }
  const text = `${JSON.stringify(parsed || {})} ${output}`.toLowerCase();
  const stageDefaults = {
    market_calendar: "market_calendar_not_ready",
    preflight: "date_preflight_not_ready",
    power_recovery: "power_recovery_not_ready",
    websocket: "websocket_source_not_ready",
    water_root: "water_root_not_ready",
    formal_gate: "formal_gate_not_ready",
    display_closure: "display_closure_not_ready",
  };
  if (text.includes("market_closed")) return "market_closed_previous_good";
  if (text.includes("boot") || text.includes("power") || text.includes("task_not_enabled") || text.includes("orchestrator_lock_before_last_boot")) return "power_recovery_not_ready";
  if (text.includes("trade_date_mismatch") || text.includes("trade_date_not_current") || text.includes("source_date_mismatch")) return "water_root_source_date_mismatch";
  if (text.includes("runid") || text.includes("resource_chain") || text.includes("scorecard") || text.includes("desktop") || text.includes("mobile") || text.includes("source_reports")) return "display_closure_not_ready";
  if (text.includes("pending_not_due") || text.includes("wait_source_window")) return "stage_not_due_or_source_window_not_open";
  if (text.includes("stale") || text.includes("not_ready") || text.includes("missing")) return stageDefaults[stage] || fallback;
  return stageDefaults[stage] || fallback;
}
function allowedActionFor(stage, reasonCode) {
  if (reasonCode === "market_closed_previous_good") return "preserve_previous_good_without_latest_writes";
  const actions = {
    stock_websocket_status_stale: "restart_stock_fugle_websocket_collector_then_rerun_websocket_verifier",
    stock_websocket_not_connected: "restart_stock_fugle_websocket_collector_then_rerun_websocket_verifier",
    stock_websocket_not_authenticated: "refresh_fugle_stock_credentials_then_restart_collector",
    stock_websocket_not_streaming: "restart_stock_fugle_websocket_collector_then_rerun_websocket_verifier",
    futopt_websocket_status_stale: "restart_futopt_fugle_websocket_collector_then_rerun_websocket_verifier",
    futopt_websocket_not_connected: "restart_futopt_fugle_websocket_collector_then_rerun_websocket_verifier",
    futopt_websocket_not_authenticated: "refresh_fugle_futopt_credentials_then_restart_collector",
    futopt_websocket_not_streaming: "restart_futopt_fugle_websocket_collector_then_rerun_websocket_verifier",
    water_root_source_date_mismatch: "rebuild_today_mother_pool_and_priority_top40_then_rerun_water_root",
  };
  if (actions[reasonCode]) return actions[reasonCode];
  return STAGES.find((item) => item.key === stage)?.allowedAction || "inspect_receipt_reason_code_then_rerun_only_affected_stage";
}

function stageByKey(key) {
  return STAGES.find((stage) => stage.key === key) || null;
}

function receiptDir(auditRoot, tradeDate, dailyRunId) {
  return path.join(auditRoot, compactDate(tradeDate), safeName(dailyRunId, "daily-run"), "receipts");
}

function writeStageReceipt({ auditRoot, tradeDate, dailyRunId, stage, status, exitCode = 0, command = "", artifact = "", parsed = null, stdout = "", stderr = "", reasonCode = "", allowedAction = "" } = {}) {
  if (!stageByKey(stage)) throw new Error(`unknown final-audit stage: ${stage}`);
  const normalizedStatus = String(status || (exitCode === 0 ? "PASS" : "BLOCKED")).toUpperCase();
  const reason = reasonCode || (normalizedStatus === "PASS" || normalizedStatus === "SKIPPED" ? "ok" : reasonCodeFor(stage, parsed, `${stdout}\n${stderr}`));
  const payload = {
    contract: "terminal-stage-receipt-v1",
    stage,
    label: stageByKey(stage).label,
    daily_run_id: String(dailyRunId || ""),
    trade_date: compactDate(tradeDate),
    status: normalizedStatus,
    complete: normalizedStatus === "PASS" || normalizedStatus === "SKIPPED",
    receipt_present: true,
    exit_code: Number.isFinite(Number(exitCode)) ? Number(exitCode) : 1,
    command,
    artifact,
    checked_at: new Date().toISOString(),
    reason_code: reason,
    allowed_action: allowedAction || allowedActionFor(stage, reason),
    evidence: parsed,
    stdout_tail: String(stdout || "").slice(-4000),
    stderr_tail: String(stderr || "").slice(-4000),
  };
  const file = path.join(receiptDir(auditRoot, tradeDate, dailyRunId), `${safeName(stage)}.json`);
  writeJson(file, payload);
  return { file, payload };
}

module.exports = {
  CONTRACT,
  STAGES,
  taipeiDateKey,
  compactDate,
  safeName,
  readJson,
  writeJson,
  createDailyRunId,
  resolveDailyRunId,
  defaultRuntimeDir,
  defaultAuditRoot,
  lockPath,
  acquireOrchestratorLock,
  releaseOrchestratorLock,
  parseLastJson,
  reasonCodeFor,
  allowedActionFor,
  stageByKey,
  receiptDir,
  writeStageReceipt,
};

