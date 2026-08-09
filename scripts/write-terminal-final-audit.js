"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const OUT_ARG = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-final-audit";
const OUT_DIR = path.isAbsolute(OUT_ARG) ? OUT_ARG : path.join(ROOT, OUT_ARG);
const EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
const VERIFY_ONLY = process.argv.includes("--verify-only");
const DAILY_RUN_ID = "fuman-terminal-" + EXPECTED_DATE;
const LOCK_FILE = path.join(RUNTIME_DIR, "state", "terminal-orchestrator.lock");
const REGISTRY_FILE = path.join(ROOT, "scripts", "terminal-active-module-registry.json");

const FILES = {
  predictivePreflight: path.join(ROOT, "outputs", "terminal-predictive-preflight", "terminal-predictive-preflight.json"),
  waterRoot: path.join(ROOT, "outputs", "terminal-water-root", "terminal-water-root.json"),
  websocket: path.join(RUNTIME_DIR, "reports", "fugle-websocket-source-readiness.json"),
};

const REASON_ACTIONS = {
  missing_receipt: "run_stage_verifier_and_write_receipt",
  market_calendar_not_ready: "refresh_market_calendar_then_reverify",
  scanner_target_date_mismatch: "refresh_date_preflight_then_reverify",
  websocket_not_ready: "reconnect_websocket_with_exponential_backoff_then_reverify",
  water_root_not_ready: "run_idempotent_rewater_then_reverify",
  formal_gate_not_ready: "wait_for_formal_gate_inputs_then_reverify",
  orchestrator_lock: "do_not_start_duplicate_run; wait_for_current_or_stale-lock-recovery",
};

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value) !== "") ?? null;
}

function summary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function loadRegistry() {
  const registry = readJson(REGISTRY_FILE);
  const issues = [];
  if (!registry || registry.contract !== "terminal-active-module-registry-v1") issues.push("registry_contract_missing");
  if (!Array.isArray(registry?.active) || registry.active.length === 0) issues.push("active_module_registry_missing");
  if (registry?.active?.some((row) => row.requiredForUnattended !== true)) issues.push("active_module_required_flag_missing");
  return { registry: registry || {}, issues };
}

function makeReceipt(stage, file, ok, status, reasonCode, allowedAction, details = {}) {
  return {
    receiptId: DAILY_RUN_ID + ":" + stage,
    dailyRunId: DAILY_RUN_ID,
    stage,
    receiptExists: Boolean(file && fs.existsSync(file)),
    checkedAt: new Date().toISOString(),
    ok: ok === true,
    status,
    reasonCode: reasonCode || "",
    allowedAction: allowedAction || "",
    artifact: file || "",
    details,
  };
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  try {
    const fd = fs.openSync(LOCK_FILE, "wx");
    fs.writeFileSync(fd, JSON.stringify({ contract: "terminal-orchestrator-lock-v1", dailyRunId: DAILY_RUN_ID, pid: process.pid, acquiredAt: new Date().toISOString() }));
    return fd;
  } catch {
    return null;
  }
}

function releaseLock(fd) {
  if (fd !== null) {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}

function buildAudit() {
  const registryState = loadRegistry();
  const preflight = readJson(FILES.predictivePreflight);
  const water = readJson(FILES.waterRoot);
  const websocket = readJson(FILES.websocket);
  const calendar = water?.marketCalendar?.row || water?.marketCalendar || {};
  const source = summary(water?.sourceStatus);
  const gate = summary(water?.canonicalGate);
  const preflightDate = compactDate(first(preflight?.scannerTargetDate, preflight?.expectedDate));
  const waterDate = compactDate(first(water?.expectedDate, water?.tradeDate, calendar?.marketDate));
  const marketOk = calendar?.marketOpen === true && calendar?.tradingDayOpen !== false && compactDate(calendar?.marketDate) === EXPECTED_DATE;
  const preflightOk = preflight?.ok === true && preflightDate === EXPECTED_DATE;
  const websocketOk = websocket?.ok === true
    && (websocket?.status === "ready" || websocket?.status === "ok")
    && websocket?.stock?.connected !== false
    && websocket?.stock?.authenticated !== false;
  const waterOk = water?.ok === true && waterDate === EXPECTED_DATE;
  const formalGrade = String(first(gate?.canonicalGateGrade, gate?.gateGrade, source?.daytradeGateGrade, source?.gateGrade, "") || "").toUpperCase();
  const formalStatus = String(first(gate?.canonicalGateStatus, gate?.gateStatus, source?.status, "") || "").toLowerCase();
  const formalVerdict = String(first(gate?.formalEntrySpeedVerdict, source?.formalEntrySpeedVerdict, source?.payload?.formal_entry_speed_verdict, "") || "").toUpperCase();
  const formalAllowed = first(gate?.formalEntryAllowed, source?.formalEntryAllowed, source?.payload?.formal_entry_allowed);
  const formalOk = formalGrade === "A" && ["ready", "ok"].includes(formalStatus) && formalVerdict === "YES" && formalAllowed === true;
  const stageFailures = [];
  const stageReceipts = [
    makeReceipt("market_calendar", FILES.waterRoot, marketOk, marketOk ? "PASS" : "BLOCKED", marketOk ? "" : "market_calendar_not_ready", marketOk ? "" : REASON_ACTIONS.market_calendar_not_ready, { marketDate: calendar?.marketDate || "", marketOpen: calendar?.marketOpen, tradingDayOpen: calendar?.tradingDayOpen }),
    makeReceipt("predictive_preflight", FILES.predictivePreflight, preflightOk, preflightOk ? "PASS" : "BLOCKED", preflightOk ? "" : (preflightDate && preflightDate !== EXPECTED_DATE ? "scanner_target_date_mismatch" : "missing_receipt"), preflightOk ? "" : REASON_ACTIONS[preflightDate && preflightDate !== EXPECTED_DATE ? "scanner_target_date_mismatch" : "missing_receipt"], { scannerTargetDate: preflightDate, expectedDate: EXPECTED_DATE }),
    makeReceipt("fugle_websocket_source", FILES.websocket, websocketOk, websocketOk ? "PASS" : "BLOCKED", websocketOk ? "" : (websocket ? "websocket_not_ready" : "missing_receipt"), websocketOk ? "" : REASON_ACTIONS[websocket ? "websocket_not_ready" : "missing_receipt"], { status: websocket?.status || "", stock: websocket?.stock || {}, futopt: websocket?.futopt || {} }),
    makeReceipt("water_root", FILES.waterRoot, waterOk, waterOk ? "PASS" : "BLOCKED", waterOk ? "" : (water ? "water_root_not_ready" : "missing_receipt"), waterOk ? "" : REASON_ACTIONS[water ? "water_root_not_ready" : "missing_receipt"], { status: water?.status || "", reason: water?.reason || "", expectedDate: waterDate }),
    makeReceipt("formal_entry_gate", FILES.waterRoot, formalOk, formalOk ? "PASS" : "BLOCKED", formalOk ? "" : (water ? "formal_gate_not_ready" : "missing_receipt"), formalOk ? "" : REASON_ACTIONS[water ? "formal_gate_not_ready" : "missing_receipt"], { grade: formalGrade, status: formalStatus, verdict: formalVerdict, allowed: formalAllowed }),
  ];
  for (const receipt of stageReceipts) if (!receipt.ok) stageFailures.push(receipt);
  const blocker = stageFailures[0] || null;
  const audit = {
    contract: "terminal-unattended-final-audit-v1",
    checkedAt: new Date().toISOString(),
    dailyRunId: DAILY_RUN_ID,
    expectedDate: EXPECTED_DATE,
    scope: "root_preflight_formal_gate_only",
    completionRule: "no receipt means stage incomplete; no downstream success is inferred",
    activeModuleRegistry: {
      file: REGISTRY_FILE,
      contract: registryState.registry.contract || "",
      version: registryState.registry.version || null,
      active: registryState.registry.active || [],
      retired: registryState.registry.retired || [],
      issues: registryState.issues,
    },
    stageReceipts,
    firstBlocker: blocker ? {
      stage: blocker.stage,
      reasonCode: blocker.reasonCode,
      allowedAction: blocker.allowedAction,
    } : null,
    rootFormalGateReady: stageFailures.length === 0 && registryState.issues.length === 0,
    downstreamClosure: {
      status: "NOT_CONNECTED",
      reasonCode: "final_audit_scope_root_only",
      allowedAction: "connect_strategy_scan_manifest_publish_runid_and_surface_receipts_in_next_stage",
    },
    unattendedYes: false,
    unattendedStatus: stageFailures.length ? "NO" : "NOT_YET_CONNECTED",
    finalDecision: stageFailures.length ? "FAIL_CLOSED" : "READY_FOR_STRATEGY_SCAN",
    allowedAction: blocker?.allowedAction || "connect_downstream_receipts_before_unattended_yes",
    lock: {
      contract: "terminal-orchestrator-lock-v1",
      path: LOCK_FILE,
      enforced: true,
    },
    ok: stageFailures.length === 0 && registryState.issues.length === 0,
  };
  return audit;
}

function main() {
  const fd = acquireLock();
  if (fd === null) {
    const audit = {
      contract: "terminal-unattended-final-audit-v1",
      checkedAt: new Date().toISOString(),
      dailyRunId: DAILY_RUN_ID,
      expectedDate: EXPECTED_DATE,
      scope: "root_preflight_formal_gate_only",
      ok: false,
      unattendedYes: false,
      unattendedStatus: "NO",
      finalDecision: "FAIL_CLOSED",
      firstBlocker: { stage: "orchestrator_lock", reasonCode: "orchestrator_lock", allowedAction: REASON_ACTIONS.orchestrator_lock },
      allowedAction: REASON_ACTIONS.orchestrator_lock,
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "terminal-final-audit-latest.json"), JSON.stringify(audit, null, 2));
    console.log(JSON.stringify(audit, null, 2));
    process.exitCode = 1;
    return;
  }
  try {
    const audit = buildAudit();
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dateFile = path.join(OUT_DIR, "terminal-final-audit-" + EXPECTED_DATE + ".json");
    const latestFile = path.join(OUT_DIR, "terminal-final-audit-latest.json");
    fs.writeFileSync(dateFile, JSON.stringify(audit, null, 2));
    fs.writeFileSync(latestFile, JSON.stringify(audit, null, 2));
    console.log(JSON.stringify({ ok: audit.ok, dailyRunId: audit.dailyRunId, unattendedStatus: audit.unattendedStatus, finalDecision: audit.finalDecision, firstBlocker: audit.firstBlocker, output: latestFile }, null, 2));
    if (VERIFY_ONLY && audit.ok !== true) process.exitCode = 1;
  } finally {
    releaseLock(fd);
  }
}

if (require.main === module) main();