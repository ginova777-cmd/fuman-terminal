"use strict";

const fs = require("fs");
const path = require("path");
const { classifyReason } = require("./terminal-reason-code-classifier");

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
  protectedReadbackCredential: path.join(ROOT, "outputs", "protected-readback-credential", "protected-readback-credential.json"),
  finalAudit: path.join(ROOT, "outputs", "terminal-autonomous-completion-audit", "terminal-autonomous-completion-audit.json"),
  readinessReport: path.join(ROOT, "outputs", "production-unattended-readiness", "production-unattended-readiness-report.json"),
};

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}


function compactReasonClassification(input = {}) {
  const pendingReasonText = typeof input === "object"
    ? String(input.issue || input.blocker || input.reason || "")
    : String(input || "");
  if ((input && typeof input === "object" && input.pendingNotDue === true) || /pending_not_due|PENDING_NOT_DUE/i.test(pendingReasonText)) {
    return {
      reasonCodes: ["SCHEDULE_PENDING_NOT_DUE"],
      primaryReasonCode: "SCHEDULE_PENDING_NOT_DUE",
      reasonActions: ["wait_until_due_time"],
      reasonLayers: ["schedule"],
      reasonSeverity: "info",
      reasonUnknown: false,
    };
  }
  if (input && typeof input === "object" && input.ok === true) {
    const hasIssue = Boolean(input.issue || input.blocker || input.reason || input.error)
      || (Array.isArray(input.issues) && input.issues.length > 0)
      || (Array.isArray(input.failures) && input.failures.length > 0);
    if (!hasIssue) {
      return {
        reasonCodes: ["CLOSURE_GREEN"],
        primaryReasonCode: "CLOSURE_GREEN",
        reasonActions: ["continue_autonomous_monitoring"],
        reasonLayers: ["closure"],
        reasonSeverity: "info",
        reasonUnknown: false,
      };
    }
  }
  const classification = classifyReason(input);
  const codes = Array.isArray(classification.codes) ? classification.codes : [];
  return {
    reasonCodes: codes.map((row) => row.code).filter(Boolean),
    primaryReasonCode: classification.primaryCode || codes[0]?.code || "",
    reasonActions: [...new Set(codes.map((row) => row.action).filter(Boolean))],
    reasonLayers: [...new Set(codes.map((row) => row.layer).filter(Boolean))],
    reasonSeverity: codes.some((row) => row.severity === "critical") ? "critical" : codes[0]?.severity || "",
    reasonUnknown: classification.unknown === true,
  };
}

function enrichReasonClassification(row = {}) {
  return {
    ...row,
    ...compactReasonClassification(row),
  };
}

function enrichGate(value = {}) {
  return enrichReasonClassification(gate(value));
}

function buildReasonCodeSummary({ blockers = [], gates = {}, modules = [], jobQueue = [] } = {}) {
  const entries = [];
  for (const blocker of blockers) entries.push({ source: "blocker", ...compactReasonClassification(blocker) });
  for (const [key, row] of Object.entries(gates || {})) entries.push({ source: `gate:${key}`, ...compactReasonClassification(row) });
  for (const row of Array.isArray(modules) ? modules : []) entries.push({ source: `module:${row.key || "unknown"}`, ...compactReasonClassification(row) });
  for (const row of Array.isArray(jobQueue) ? jobQueue : []) entries.push({ source: `job:${row.key || "unknown"}`, ...compactReasonClassification(row) });
  const codes = [...new Set(entries.flatMap((row) => row.reasonCodes || []))].sort();
  return {
    contract: "terminal-reason-code-summary-v1",
    ok: entries.every((row) => row.reasonUnknown !== true),
    entries: entries.length,
    unknownEntries: entries.filter((row) => row.reasonUnknown === true).length,
    criticalEntries: entries.filter((row) => row.reasonSeverity === "critical").length,
    codes,
    primaryCode: entries.find((row) => row.reasonSeverity === "critical")?.primaryReasonCode || entries[0]?.primaryReasonCode || "",
    actions: [...new Set(entries.flatMap((row) => row.reasonActions || []))].sort(),
  };
}

function compactRootCauseSummary(value = {}) {
  const categories = Array.isArray(value.categories) ? value.categories : [];
  return {
    contract: value.contract || "",
    ok: value.ok === true,
    totalBlockers: Number(value.totalBlockers || 0),
    rootCauseCount: Number(value.rootCauseCount || categories.length || 0),
    criticalRootCauseCount: Number(value.criticalRootCauseCount || categories.filter((row) => row?.severity === "critical").length || 0),
    unknownBlockers: Number(value.unknownBlockers || 0),
    categories: categories.map((row) => ({
      category: row?.category || "unknown",
      severity: row?.severity || "unknown",
      count: Number(row?.count || 0),
      action: row?.action || "",
      blockers: Array.isArray(row?.blockers) ? row.blockers.map(String).slice(0, 8) : [],
    })),
  };
}

function greenRootCauseSummary() {
  return {
    contract: "production-readiness-root-cause-summary-v1",
    ok: true,
    totalBlockers: 0,
    rootCauseCount: 1,
    criticalRootCauseCount: 0,
    unknownBlockers: 0,
    categories: [{
      category: "closure",
      severity: "info",
      count: 0,
      action: "continue_autonomous_monitoring",
      blockers: [],
    }],
  };
}

function greenRootCauseRecoveryPlan() {
  return {
    contract: "production-readiness-root-cause-recovery-plan-v1",
    ok: true,
    stepCount: 1,
    autoExecutableSteps: 0,
    autoExecutableNow: 0,
    blockedAutoExecutableSteps: 0,
    manualSteps: 0,
    firstManualStep: "",
    firstExecutableStep: "",
    firstBlockedStep: "",
    steps: [{
      category: "closure",
      order: 1,
      severity: "info",
      blockerCount: 0,
      canAutoExecute: false,
      canExecuteNow: false,
      blockedBy: [],
      automation: "monitor",
      requires: ["manifest_green", "runid_closure_green"],
      commands: [],
      reason: "current terminal ops status is green",
      stopMode: "continue_monitoring",
    }],
  };
}
function compactRootCauseRecoveryPlan(value = {}) {
  const steps = Array.isArray(value.steps) ? value.steps : [];
  return {
    contract: value.contract || "",
    ok: value.ok === true,
    stepCount: Number(value.stepCount || steps.length || 0),
    autoExecutableSteps: Number(value.autoExecutableSteps || 0),
    autoExecutableNow: Number(value.autoExecutableNow || 0),
    blockedAutoExecutableSteps: Number(value.blockedAutoExecutableSteps || 0),
    manualSteps: Number(value.manualSteps || 0),
    firstManualStep: value.firstManualStep || "",
    firstExecutableStep: value.firstExecutableStep || "",
    firstBlockedStep: value.firstBlockedStep || "",
    steps: steps.map((row) => ({
      category: row?.category || "unknown",
      order: Number(row?.order || 999),
      severity: row?.severity || "unknown",
      blockerCount: Number(row?.blockerCount || 0),
      canAutoExecute: row?.canAutoExecute === true,
      canExecuteNow: row?.canExecuteNow === true,
      blockedBy: Array.isArray(row?.blockedBy) ? row.blockedBy.map(String) : [],
      automation: row?.automation || "",
      requires: Array.isArray(row?.requires) ? row.requires.map(String) : [],
      commands: Array.isArray(row?.commands) ? row.commands.map((cmd) => ({ command: cmd?.command || String(cmd || "") })) : [],
      reason: row?.reason || "",
      stopMode: row?.stopMode || "",
    })),
  };
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readinessPendingNotDueSignal(readinessReport = {}) {
  const blockers = Array.isArray(readinessReport.blockers)
    ? readinessReport.blockers.map((row) => (typeof row === "string" ? row : (row?.blocker || row?.issue || row?.code || row?.reason || "")))
    : [];
  const text = [
    readinessReport.status,
    readinessReport.reason,
    readinessReport.waterRootStatus,
    readinessReport.waterRoot?.status,
    readinessReport.waterRoot?.reason,
    readinessReport.dailyManifest?.status,
    readinessReport.dailyManifest?.reason,
    ...blockers,
  ].filter(Boolean).join(" ").toLowerCase();
  return readinessReport.status === "PENDING_NOT_DUE"
    || blockers.some((row) => String(row || "").startsWith("pending_not_due"))
    || /pending_not_due|previous_good_hold|previous_good|wait_source_window|waiting_source_window|trading_day_wait_source_window|formal_scan_skipped|before_formal_source_window|outside_formal_source_window/.test(text);
}
function moduleRows(manifest = {}, controlPlane = {}, readinessReport = {}) {
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
  for (const row of Array.isArray(readinessReport.resourceChain?.rows) ? readinessReport.resourceChain.rows : []) {
    if (!row?.key) continue;
    const current = byKey.get(row.key) || {};
    const closureOk = row.ok === true && Array.isArray(row.issues) && row.issues.length === 0;
    byKey.set(row.key, {
      ...current,
      key: row.key,
      label: current.label || row.label || row.key,
      runId: current.runId || row.scorecardRunId || row.liveRunId || row.desktopRunId || row.mobileRunId || row.supabaseRunId || row.receiptRunId || "",
      runIdClosureOk: closureOk,
      runIdClosureIssue: closureOk ? "" : (Array.isArray(row.issues) ? row.issues[0] : row.issue || ""),
      issues: closureOk ? (Array.isArray(current.issues) ? current.issues.filter((issue) => !/runId_mismatch|scorecard .*runId|manifest_runId_mismatch|live API != desktop artifact/i.test(String(issue))) : []) : current.issues,
    });
  }
  return [...byKey.values()].map((row) => {
    const issues = Array.isArray(row.issues) ? row.issues.filter(Boolean).map(String) : [];
    if (row.runIdClosureIssue && !issues.includes(row.runIdClosureIssue)) issues.unshift(row.runIdClosureIssue);
    const closedByEvidence = row.pendingNotDue !== true
      && Boolean(row.runId || "")
      && String(row.evidenceStatus || "") === "complete"
      && row.publishAllowed === true
      && row.fallback !== true
      && row.rawFallback !== true
      && row.runIdClosureOk === true
      && issues.length === 0;
    const complete = row.complete === true || closedByEvidence;
    const ok = row.ok === true || closedByEvidence;
    return {
      key: row.key,
      label: row.label || row.key,
      ok,
      complete,
      fallback: row.fallback === true,
      rawFallback: row.rawFallback === true,
      evidenceStatus: row.evidenceStatus || "",
      publishAllowed: row.publishAllowed === true,
      runId: row.runId || "",
      tradeDate: compactDate(row.tradeDate || row.runDate),
      sourceDate: compactDate(row.sourceDate || row.tradeDate || row.runDate),
      resultCount: Number(row.resultCount || 0),
      pendingNotDue: row.pendingNotDue === true,
      runIdClosureOk: row.runIdClosureOk === true,
      issue: issues[0] || "",
      issues,
    };
  });
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
  const protectedReadbackCredential = artifacts.protectedReadbackCredential || {
    contract: "protected-readback-credential-v1",
    ok: false,
    armed: false,
    source: "missing",
    failures: ["protected_readback_credential_artifact_missing"],
  };
  const finalAudit = artifacts.finalAudit || {};
  const readinessReport = artifacts.readinessReport || {};
  const readinessPendingNotDue = readinessPendingNotDueSignal(readinessReport);
  const readinessPendingReason = readinessPendingNotDue
    ? (readinessReport.waterRoot?.reason || readinessReport.waterRootStatus || readinessReport.status || "pending_not_due")
    : "";
  let rootCauseSummary = compactRootCauseSummary(readinessReport.rootCauseSummary || {});
  let rootCauseRecoveryPlan = compactRootCauseRecoveryPlan(readinessReport.rootCauseRecoveryPlan || {});
  const notification = notificationPlan.notification || {};
  const decision = controlPlane.decision || policy.decision || {};
  const actionMatrix = controlPlane.autonomousOpsPolicy?.actionMatrix || policy.actionMatrix || {};
  const stateMachineContract = orchestrator.stateMachineContract || {};
  const tradeDate = compactDate(readinessReport.tradeDate || readinessReport.dailyManifest?.tradeDate || readinessReport.waterRoot?.expectedDate || controlPlane.tradeDate || manifest.tradeDate || policy.tradeDate || orchestrator.tradeDate);
  const modules = moduleRows(manifest, controlPlane, readinessReport).map(enrichReasonClassification);
  const jobQueue = Array.isArray(orchestrator.jobQueue) ? orchestrator.jobQueue : [];
  const previousGoodHold = String(decision.state || decision.opsState || "").includes("MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD")
    || String(decision.unattendedStatus || "").includes("PREVIOUS_GOOD_HOLD");
  const protectedReadbackCredentialGate = gate(protectedReadbackCredential);
  const readinessReportBlockers = Array.isArray(readinessReport.blockers)
    ? readinessReport.blockers.map((row) => (typeof row === "string" ? row : (row?.blocker || row?.issue || row?.code || ""))).filter(Boolean)
    : [];
  const pendingReason = readinessPendingReason || "pending_not_due";
  const blockers = readinessPendingNotDue
    ? []
    : compactComputeBlockers(compactBlockers({
      decision,
      manifest,
      controlPlane,
      finalAudit,
      protectedReadbackCredential,
      protectedReadbackCredentialGate,
      rollForward,
    }));
  const protectedReadbackDisplayBlockers = protectedReadbackCredential.ok === true ? [] : compactProtectedReadbackFailures(protectedReadbackCredential, protectedReadbackCredentialGate);
  const gates = {
    predictivePreflight: enrichGate(controlPlane.predictivePreflight || predictivePreflight),
    waterRoot: enrichGate(controlPlane.waterRoot || manifest.waterRoot),
    stateMachine: enrichGate(controlPlane.stateMachine),
    dailyManifest: enrichGate(readinessPendingNotDue ? { ok: true, status: "PENDING_NOT_DUE", reason: pendingReason, pendingNotDue: true } : (controlPlane.dailyManifest || { ok: manifest.ok, status: manifest.ok ? "GREEN" : "BLOCKED", reason: manifest.blocker })),
    canaryPublish: enrichGate(controlPlane.canaryPublish || canary),
    notificationPolicy: enrichGate(notificationPlan),
    protectedReadbackCredential: enrichGate(protectedReadbackCredentialGate),
    runIdClosure: enrichGate(readinessPendingNotDue ? { ok: true, status: "PENDING_NOT_DUE", reason: pendingReason, pendingNotDue: true } : controlPlane.runIdClosure),
    autoRollForward: enrichGate(rollForward.decision || controlPlane.autoRollForward),
    autonomousOpsPolicy: enrichGate(controlPlane.autonomousOpsPolicy || policy.decision),
    finalAudit: enrichGate(finalAudit),
  };
  const jobQueueRows = jobQueue.map((job) => enrichReasonClassification({
    key: job.key || "",
    label: job.label || job.key || "",
    state: job.state || "",
    priority: Number(job.priority || 0),
    retryable: job.retryable === true,
    blocker: job.blocker || "",
    nextAction: job.nextAction || "",
    command: job.command || "",
  }));
  const reasonCodeSummary = buildReasonCodeSummary({ blockers, gates, modules, jobQueue: jobQueueRows });
  const rollForwardDecision = rollForward.decision || {};
  const rollForwardAuthBlocked = rollForwardDecision.state === "BLOCKED_AUTH_MANUAL_REPAIR_REQUIRED" && !protectedReadbackOnlyReason(rollForwardDecision.reason);
  const effectiveState = readinessPendingNotDue
    ? "PENDING_NOT_DUE"
    : (rollForwardAuthBlocked ? rollForwardDecision.state : (decision.state || decision.opsState || controlPlane.stateMachine?.overallState || orchestrator.overallState || ""));
  const effectiveReason = readinessPendingNotDue
    ? pendingReason
    : (rollForwardAuthBlocked ? (rollForwardDecision.reason || "backend_service_token_auth_blocked") : (decision.reason || policy.decision?.reason || manifest.blocker || blockers[0] || ""));
  const ok = readinessPendingNotDue ? false : ((decision.unattendedStatus === "YES" || previousGoodHold)
    && manifest.ok === true
    && controlPlane.runIdClosure?.ok !== false
    && modules.every((row) => row.ok && row.runIdClosureOk !== false));
  if (ok && reasonCodeSummary.ok === true && Number(reasonCodeSummary.unknownEntries || 0) === 0) {
    rootCauseSummary = greenRootCauseSummary();
    rootCauseRecoveryPlan = greenRootCauseRecoveryPlan();
  }

  const outputActionMatrix = compactActionMatrix(actionMatrix);
  if (readinessPendingNotDue) {
    outputActionMatrix.opsState = "PENDING_NOT_DUE";
    outputActionMatrix.severity = "info";
    outputActionMatrix.stopMode = "wait_schedule";
    outputActionMatrix.formalScan = { ...(outputActionMatrix.formalScan || {}), allowed: false, mode: "wait_schedule", reason: pendingReason };
    outputActionMatrix.publish = { ...(outputActionMatrix.publish || {}), allowed: false, mode: "preserve_previous_good", reason: pendingReason };
    outputActionMatrix.terminalDisplay = { ...(outputActionMatrix.terminalDisplay || {}), allowed: true, mode: "previous_good_hold", reason: pendingReason };
    outputActionMatrix.operatorAction = "wait_until_due_time";
    outputActionMatrix.automationAction = "continue_monitoring";
  }

  return {
    ok,
    contract: "terminal-ops-status-v1",
    source,
    generatedAt: new Date().toISOString(),
    checkedAt: controlPlane.checkedAt || policy.checkedAt || manifest.checkedAt || "",
    tradeDate,
    state: effectiveState,
    unattendedStatus: readinessPendingNotDue ? "PREVIOUS_GOOD_HOLD" : (decision.unattendedStatus || manifest.unattendedStatus || policy.decision?.unattendedStatus || "NO"),
    action: decision.action || policy.decision?.action || "",
    reason: effectiveReason,
    blockers,
    protectedReadbackDisplayBlockers,
    gates,
    modules,
    jobQueue: jobQueueRows,
    reasonCodeSummary,
    rootCauseSummary,
    rootCauseRecoveryPlan,
    readinessReport: {
      contract: readinessReport.contract || "",
      status: readinessReport.status || "",
      ok: readinessReport.ok === true,
      checkedAt: readinessReport.checkedAt || "",
    },
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
    actionMatrix: outputActionMatrix,
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
      safeRecoveryPreview: {
        contract: rollForward.safeRecoveryPreview?.contract || "",
        ok: rollForward.safeRecoveryPreview?.ok === true,
        state: rollForward.safeRecoveryPreview?.state || "",
        reason: rollForward.safeRecoveryPreview?.reason || "",
        executableJobs: Number(rollForward.safeRecoveryPreview?.executableJobs || 0),
        blockedJobs: Number(rollForward.safeRecoveryPreview?.blockedJobs || 0),
        executableKeys: Array.isArray(rollForward.safeRecoveryPreview?.executableKeys) ? rollForward.safeRecoveryPreview.executableKeys : [],
        blockedKeys: Array.isArray(rollForward.safeRecoveryPreview?.blockedKeys) ? rollForward.safeRecoveryPreview.blockedKeys : [],
        commandHint: rollForward.safeRecoveryPreview?.commandHint || "",
      },
    },
    protectedReadbackCredential: compactProtectedReadbackCredential(protectedReadbackCredential),
    finalAudit: {
      contract: finalAudit.contract || "",
      ok: finalAudit.ok === true,
      tradeDate: compactDate(finalAudit.summary?.tradeDate || tradeDate),
      marketClosedMode: finalAudit.summary?.closed === true,
      layers: Array.isArray(finalAudit.layers) ? finalAudit.layers.length : 0,
      issues: Array.isArray(finalAudit.issues) ? finalAudit.issues.map((row) => row.issue || row.code || String(row)) : [],
    },
  };
}


function normalizeSourceReportKey(report = {}) {
  const raw = String(report.key || report.strategyKey || report.strategy || report.endpoint || "").toLowerCase();
  if (raw.includes("institution") || raw.includes("buy-sell")) return "institution";
  if (raw.includes("cb-detect") || raw === "cb") return "cb";
  if (raw.includes("warrant-flow") || raw === "warrant") return "warrant";
  if (raw.includes("strategy2")) return "strategy2";
  if (raw.includes("strategy3")) return "strategy3";
  if (raw.includes("strategy4")) return "strategy4";
  if (raw.includes("strategy5")) return "strategy5";
  return raw.replace(/[^a-z0-9_-]/g, "");
}

function sourceReportRows(sourceReports = []) {
  const rows = [];
  for (const report of Array.isArray(sourceReports) ? sourceReports : []) {
    const key = normalizeSourceReportKey(report);
    if (!key) continue;
    const runId = report.runId || report.latestRunId || report.sourceRunId || "";
    const status = String(report.status || report.qualityStatus || report.evidenceStatus || "").toLowerCase();
    const complete = report.complete === true
      || report.ok === true
      || status === "complete"
      || status === "ready";
    rows.push({
      key,
      label: report.label || report.strategyLabel || key,
      ok: report.ok !== false && complete,
      complete,
      fallback: report.fallback === true || report.fallbackUsed === true,
      runId,
      tradeDate: compactDate(report.tradeDate || report.marketDate || report.runDate),
      sourceDate: compactDate(report.sourceDate || report.tradeDate || report.marketDate || report.runDate),
      resultCount: Number(report.resultCount ?? report.count ?? report.emittedRows ?? report.rows ?? 0),
      runIdClosureOk: Boolean(runId),
      issue: report.issue || report.reason || report.blocker || "",
    });
  }
  return rows;
}

function mergeLiveSourceReports(status = {}, scorecardPayload = {}) {
  const liveRows = sourceReportRows(scorecardPayload.sourceReports || scorecardPayload.source_reports || []);
  const baseModules = Array.isArray(status.modules) ? status.modules : [];
  if (!liveRows.length) {
    const enrichedModules = baseModules.map(enrichReasonClassification);
    return {
      ...status,
      modules: enrichedModules,
      reasonCodeSummary: buildReasonCodeSummary({ blockers: status.blockers || [], gates: status.gates || {}, modules: enrichedModules, jobQueue: status.jobQueue || [] }),
      liveOverlay: {
        ok: false,
        source: "scorecard-sourceReports",
        reason: "sourceReports_empty_or_missing",
        checkedAt: new Date().toISOString(),
      },
    };
  }
  const modulesByKey = new Map(baseModules.map((row) => [row.key, { ...row }]));
  for (const liveRow of liveRows) {
    const current = modulesByKey.get(liveRow.key) || {};
    modulesByKey.set(liveRow.key, {
      ...current,
      ...liveRow,
      label: current.label || liveRow.label || liveRow.key,
      issue: liveRow.issue || current.issue || "",
    });
  }
  const modules = [...modulesByKey.values()];
  const enrichedModules = modules.map(enrichReasonClassification);
  const moduleKeys = liveRows.map((row) => row.key);
  const liveOk = liveRows.every((row) => row.ok && row.complete && !row.fallback && row.runId);
  return {
    ...status,
    modules: enrichedModules,
    source: String(status.source || "unknown") + "+live-scorecard-sourceReports",
    reasonCodeSummary: buildReasonCodeSummary({ blockers: status.blockers || [], gates: status.gates || {}, modules: enrichedModules, jobQueue: status.jobQueue || [] }),
    liveOverlay: {
      ok: liveOk,
      source: "scorecard-sourceReports",
      checkedAt: new Date().toISOString(),
      moduleKeys,
      runIds: Object.fromEntries(liveRows.map((row) => [row.key, row.runId])),
      reason: liveOk ? "" : "live_sourceReports_not_all_complete",
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
  const failures = Array.isArray(value?.failures) ? value.failures.filter(Boolean).map(String) : [];
  const issues = Array.isArray(value?.issues) ? value.issues.map((row) => row.issue || row.code || String(row)).filter(Boolean) : [];
  return {
    ok: value?.ok === true,
    status: value?.status || value?.overallState || value?.opsState || value?.state || "",
    reason: value?.reason || value?.blocker || value?.issue || failures[0] || issues[0] || "",
  };
}

function compactProtectedReadbackCredential(value = {}) {
  const failures = Array.isArray(value.failures) ? value.failures.filter(Boolean).map(String) : [];
  return {
    contract: value.contract || "",
    ok: value.ok === true,
    armed: value.armed === true,
    source: value.source || "",
    reason: value.reason || value.auth?.reason || failures[0] || "",
    failures,
    endpoints: Array.isArray(value.endpoints) ? value.endpoints.map((row) => ({
      name: row.name || row.url || "",
      ok: row.ok === true,
      status: Number(row.status || 0),
      reason: row.reason || row.issue || "",
    })) : [],
    nextActions: Array.isArray(value.nextActions) ? value.nextActions.map((row) => ({
      code: row?.code || "",
      command: row?.command || "",
      expected: row?.expected || "",
      expectedFile: row?.expectedFile || "",
      note: row?.note || "",
    })) : [],
  };
}


function protectedReadbackOnlyReason(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  return text.includes("protected_readback") || text.includes("protected_surface") || text.includes("membership_required");
}

function compactProtectedReadbackFailures(protectedReadbackCredential = {}, protectedReadbackCredentialGate = {}) {
  const failures = Array.isArray(protectedReadbackCredential.failures) ? protectedReadbackCredential.failures.map(String).filter(Boolean) : [];
  const reason = protectedReadbackCredentialGate.reason || failures[0] || "protected_readback_credential_not_ok";
  return [...new Set([reason, ...failures])].filter(Boolean);
}

function compactComputeBlockers(blockers = []) {
  return (Array.isArray(blockers) ? blockers : [])
    .map(String)
    .filter((blocker) => !protectedReadbackOnlyReason(blocker));
}
function compactBlockers({ decision = {}, manifest = {}, controlPlane = {}, finalAudit = {}, protectedReadbackCredential = {}, protectedReadbackCredentialGate = {}, rollForward = {} } = {}) {
  const blockers = [];
  const push = (value) => {
    const text = String(value || "").trim();
    if (text && !blockers.includes(text)) blockers.push(text);
  };
  push(decision.reason);
  push(manifest.blocker);
  push(controlPlane.decision?.reason);
  if (rollForward.decision?.ok === false) push(rollForward.decision.reason || rollForward.decision.state || "auto_roll_forward_not_ok");
  if (manifest.ok === false) push("daily_manifest_not_ok");
  if (controlPlane.runIdClosure?.ok === false) push(controlPlane.runIdClosure.reason || "runid_closure_not_ok");
  if (finalAudit.ok === false) {
    const issues = Array.isArray(finalAudit.issues) ? finalAudit.issues.map((row) => row.issue || row.code || String(row)).filter(Boolean) : [];
    push(issues.find((issue) => issue.includes("protected_readback")) || issues[0] || "final_audit_not_ok");
  }
  if (protectedReadbackCredential.ok !== true) {
    push(protectedReadbackCredentialGate.reason || "protected_readback_credential_not_ok");
  }
  return blockers;
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
  if (clone.readinessReport) delete clone.readinessReport.checkedAt;
  clone.source = "";
  return clone;
}

module.exports = {
  DATA_FILE,
  buildLatestOpsStatus,
  mergeLiveSourceReports,
  writeOpsStatusSnapshot,
  _private: { buildStatusFromArtifacts, moduleRows, readOutputArtifacts, stableStatus, sameSemanticStatus, compactActionMatrix, compactStateMachineContract, normalizeSourceReportKey, sourceReportRows, compactRootCauseRecoveryPlan, compactReasonClassification, buildReasonCodeSummary, compactRootCauseSummary },
};
