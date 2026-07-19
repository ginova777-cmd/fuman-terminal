"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "terminal-ops-status-latest.json");
const OUTPUT_FILES = {
  predictivePreflight: path.join(ROOT, "outputs", "terminal-predictive-preflight", "terminal-predictive-preflight.json"),
  controlPlane: path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json"),
  manifest: path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"),
  orchestrator: path.join(ROOT, "outputs", "terminal-orchestrator", "terminal-orchestrator-state.json"),
  rollForward: path.join(ROOT, "outputs", "terminal-roll-forward", "terminal-auto-roll-forward.json"),
  canary: path.join(ROOT, "outputs", "terminal-canary-publish", "terminal-canary-publish.json"),
  policy: path.join(ROOT, "outputs", "autonomous-ops-policy", "autonomous-ops-policy.json"),
  notificationPlan: path.join(ROOT, "outputs", "autonomous-ops-notification", "autonomous-ops-notification-plan.json"),
};

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function moduleRows(manifest = {}, controlPlane = {}) {
  const byKey = new Map();
  for (const row of Array.isArray(manifest.modules) ? manifest.modules : []) {
    if (row?.key) byKey.set(row.key, { ...row });
  }
  for (const row of Array.isArray(controlPlane.runIdClosure?.modules) ? controlPlane.runIdClosure.modules : []) {
    if (!row?.key) continue;
    const current = byKey.get(row.key) || {};
    byKey.set(row.key, {
      ...current,
      key: row.key,
      label: current.label || row.label || row.key,
      runId: current.runId || row.runId || "",
      runDate: compactDate(row.runDate || current.tradeDate || current.sourceDate),
      runIdClosureOk: row.ok === true,
      runIdClosureIssue: row.issue || "",
    });
  }
  return [...byKey.values()].map((row) => ({
    key: row.key,
    label: row.label || row.key,
    ok: row.ok === true,
    complete: row.complete === true,
    fallback: row.fallback === true,
    runId: row.runId || "",
    tradeDate: compactDate(row.tradeDate || row.runDate),
    sourceDate: compactDate(row.sourceDate || row.tradeDate || row.runDate),
    resultCount: Number(row.resultCount || 0),
    runIdClosureOk: row.runIdClosureOk === true,
    issue: row.runIdClosureIssue || (Array.isArray(row.issues) ? row.issues.join("; ") : ""),
  }));
}

function buildStatusFromArtifacts(artifacts, source) {
  const predictivePreflight = artifacts.predictivePreflight || {};
  const controlPlane = artifacts.controlPlane || {};
  const manifest = artifacts.manifest || {};
  const orchestrator = artifacts.orchestrator || {};
  const rollForward = artifacts.rollForward || {};
  const policy = artifacts.policy || {};
  const canary = artifacts.canary || {};
  const notificationPlan = artifacts.notificationPlan || {};
  const notification = notificationPlan.notification || {};
  const decision = controlPlane.decision || policy.decision || {};
  const actionMatrix = controlPlane.autonomousOpsPolicy?.actionMatrix || policy.actionMatrix || {};
  const stateMachineContract = orchestrator.stateMachineContract || {};
  const tradeDate = compactDate(controlPlane.tradeDate || manifest.tradeDate || policy.tradeDate || orchestrator.tradeDate);
  const modules = moduleRows(manifest, controlPlane);
  const jobQueue = Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue : [];
  const ok = decision.unattendedStatus === "YES"
    && manifest.ok === true
    && controlPlane.runIdClosure?.ok !== false
    && modules.every((row) => row.ok && row.runIdClosureOk !== false);

  return {
    ok,
    contract: "terminal-ops-status-v1",
    source,
    generatedAt: new Date().toISOString(),
    checkedAt: controlPlane.checkedAt || policy.checkedAt || manifest.checkedAt || "",
    tradeDate,
    state: decision.state || decision.opsState || controlPlane.stateMachine?.overallState || orchestrator.overallState || "",
    unattendedStatus: decision.unattendedStatus || manifest.unattendedStatus || policy.decision?.unattendedStatus || "NO",
    action: decision.action || policy.decision?.action || "",
    reason: decision.reason || policy.decision?.reason || manifest.blocker || "",
    gates: {
      predictivePreflight: gate(controlPlane.predictivePreflight || predictivePreflight),
      waterRoot: gate(controlPlane.waterRoot || manifest.waterRoot),
      stateMachine: gate(controlPlane.stateMachine),
      dailyManifest: gate(controlPlane.dailyManifest || { ok: manifest.ok, status: manifest.ok ? "GREEN" : "BLOCKED", reason: manifest.blocker }),
      canaryPublish: gate(controlPlane.canaryPublish || canary),
      notificationPolicy: gate(notificationPlan),
      runIdClosure: gate(controlPlane.runIdClosure),
      autoRollForward: gate(controlPlane.autoRollForward || rollForward.decision),
      autonomousOpsPolicy: gate(controlPlane.autonomousOpsPolicy || policy.decision),
    },
    modules,
    jobQueue: jobQueue.map((job) => ({
      key: job.key || "",
      label: job.label || job.key || "",
      state: job.state || "",
      priority: Number(job.priority || 0),
      retryable: job.retryable === true,
      blocker: job.blocker || "",
      nextAction: job.nextAction || "",
      command: job.command || "",
    })),
    predictivePreflight: {
      contract: predictivePreflight.contract || "",
      ok: predictivePreflight.ok === true,
      state: predictivePreflight.state || "",
      action: predictivePreflight.action || "",
      reason: predictivePreflight.reason || "",
      scannerTargetDate: compactDate(predictivePreflight.scannerTargetDate),
      displayTradeDate: compactDate(predictivePreflight.displayTradeDate),
      formalScanAllowed: predictivePreflight.formalScanAllowed === true,
      preservePreviousGood: predictivePreflight.preservePreviousGood === true,
      publishAllowed: predictivePreflight.publishAllowed === true,
      issues: Array.isArray(predictivePreflight.issues) ? predictivePreflight.issues : [],
    },
    stateMachineContract: compactStateMachineContract(stateMachineContract),
    actionMatrix: compactActionMatrix(actionMatrix),
    canaryPublish: {
      contract: canary.contract || "",
      ok: canary.ok === true,
      status: canary.status || "",
      scorecardPublishAllowed: canary.scorecardPublishAllowed === true,
      reason: canary.reason || "",
      tradeDate: compactDate(canary.tradeDate),
    },
    notificationPlan: {
      contract: notificationPlan.contract || "",
      ok: notificationPlan.ok === true,
      required: notification.required === true,
      sendAllowed: notification.sendAllowed === true,
      dryRun: notification.dryRun !== false,
      kind: notification.kind || "",
      dedupeKey: notification.dedupeKey || "",
      reason: notification.reason || "",
      opsState: notificationPlan.opsState || "",
      tradeDate: compactDate(notificationPlan.tradeDate),
    },
    rollForward: {
      mode: rollForward.mode || "",
      state: rollForward.decision?.state || "",
      jobs: Number(rollForward.jobs || 0),
      executableJobs: Number(rollForward.executableJobs || 0),
      blockedJobs: Number(rollForward.blockedJobs || 0),
    },
  };
}

function compactStateMachineContract(value = {}) {
  return {
    contract: value.contract || "",
    lifecycle: Array.isArray(value.lifecycle) ? value.lifecycle : [],
    failureStates: Array.isArray(value.failureStates) ? value.failureStates : [],
    terminalStates: Array.isArray(value.terminalStates) ? value.terminalStates : [],
    invariants: Array.isArray(value.invariants) ? value.invariants : [],
  };
}
function compactActionMatrix(value = {}) {
  return {
    contract: value.contract || "",
    opsState: value.opsState || "",
    severity: value.severity || "",
    stopMode: value.stopMode || "",
    formalScan: value.formalScan || {},
    publish: value.publish || {},
    terminalDisplay: value.terminalDisplay || {},
    rollForward: value.rollForward || {},
    notify: value.notify || {},
    operatorAction: value.operatorAction || "",
    automationAction: value.automationAction || "",
    protectedInvariants: Array.isArray(value.protectedInvariants) ? value.protectedInvariants : [],
  };
}
function gate(value = {}) {
  return {
    ok: value?.ok === true,
    status: value?.status || value?.overallState || value?.opsState || value?.state || "",
    reason: value?.reason || value?.blocker || "",
  };
}

function readOutputArtifacts() {
  const artifacts = {};
  for (const [key, file] of Object.entries(OUTPUT_FILES)) {
    artifacts[key] = readJson(file, null);
  }
  return artifacts;
}

function buildLatestOpsStatus(options = {}) {
  const artifacts = readOutputArtifacts();
  if (artifacts.controlPlane && artifacts.manifest) {
    return buildStatusFromArtifacts(artifacts, "runtime-output-artifacts");
  }
  const snapshot = readJson(options.dataFile || DATA_FILE, null);
  if (snapshot && snapshot.contract === "terminal-ops-status-v1") {
    return { ...snapshot, source: "data:terminal-ops-status-latest" };
  }
  return {
    ok: false,
    contract: "terminal-ops-status-v1",
    source: "missing",
    generatedAt: new Date().toISOString(),
    state: "ARTIFACT_MISSING",
    unattendedStatus: "NO",
    reason: "terminal_ops_status_artifact_missing",
    gates: {},
    modules: [],
    jobQueue: [],
    rollForward: { mode: "", state: "", jobs: 0, executableJobs: 0, blockedJobs: 0 },
  };
}

function writeOpsStatusSnapshot(file = DATA_FILE) {
  const status = buildStatusFromArtifacts(readOutputArtifacts(), "runtime-output-artifacts");
  const existing = readJson(file, null);
  if (existing && sameSemanticStatus(existing, status)) return existing;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  return status;
}

function sameSemanticStatus(a, b) {
  return JSON.stringify(stableStatus(a)) === JSON.stringify(stableStatus(b));
}

function stableStatus(value = {}) {
  const clone = JSON.parse(JSON.stringify(value || {}));
  delete clone.generatedAt;
  delete clone.checkedAt;
  clone.source = "";
  return clone;
}

module.exports = {
  DATA_FILE,
  buildLatestOpsStatus,
  writeOpsStatusSnapshot,
  _private: { buildStatusFromArtifacts, moduleRows, readOutputArtifacts, stableStatus, sameSemanticStatus, compactActionMatrix, compactStateMachineContract },
};
