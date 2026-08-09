"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { STAGES, readJson } = require("../lib/terminal-final-audit-contract");
const { moduleReceiptFile } = require("../lib/terminal-full-module-contract");

const ROOT = path.resolve(__dirname, "..");
const AUDIT_ROOT = path.resolve(process.argv.find((arg) => arg.startsWith("--root="))?.slice("--root=".length) || "outputs/terminal-final-audit");
const AUDIT_FILE = path.resolve(process.argv.find((arg) => arg.startsWith("--file="))?.slice("--file=".length) || path.join(AUDIT_ROOT, "terminal-unattended-final-audit.json"));
const CANONICAL_RUNNER_PATH = path.join(ROOT, "scripts", "run-terminal-unattended-final-audit.js");
const REQUIRE_YES = process.argv.includes("--require-yes");
const REQUIREMENTS_FILE = path.join(ROOT, "docs", "terminal-unattended-requirements.json");
const REQUIRED_TRACKED_FILES = [
  "lib/terminal-final-audit-contract.js",
  "lib/terminal-full-module-contract.js",
  "scripts/run-terminal-unattended-final-audit.js",
  "scripts/verify-terminal-final-audit-contract.js",
  "scripts/verify-terminal-recovery-queue.js",
  "scripts/verify-terminal-power-recovery.js",
  "scripts/run-terminal-auto-roll-forward.js",
  "scripts/write-terminal-orchestrator-state.js",
  "scripts/write-terminal-stage-receipt.js",
  "scripts/write-terminal-daily-manifest.js",
];

function issue(issues, code, details = {}) { issues.push({ code, ...details }); }
function isGitTracked(relativePath) {
  const result = spawnSync("git", ["-C", ROOT, "ls-files", "--error-unmatch", relativePath], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  return result.status === 0;
}

function verifyTrackedReleaseFiles(issues) {
  for (const relativePath of REQUIRED_TRACKED_FILES) {
    const file = path.join(ROOT, relativePath);
    if (!fs.existsSync(file)) {
      issue(issues, "required_final_audit_file_missing", { file: relativePath });
      continue;
    }
    if (!isGitTracked(relativePath)) {
      issue(issues, "required_final_audit_file_untracked", { file: relativePath });
    }
  }
}

function isLockHeldAudit(audit) {
  return audit?.decision === "NO"
    && audit?.first_blocker === "orchestrator_lock"
    && audit?.reason_code === "orchestrator_lock_held"
    && audit?.orchestrator_lock?.acquired !== true
    && audit?.orchestrator_lock?.released !== true;
}

function isLegacyOrchestratorConflictAudit(audit) {
  return audit?.decision === "NO"
    && audit?.first_blocker === "legacy_orchestrator_conflict"
    && audit?.reason_code === "legacy_orchestrator_conflict"
    && audit?.orchestrator_lock?.acquired === true
    && audit?.orchestrator_lock?.released === true;
}

function isExecutionAbortedAudit(audit) {
  return audit?.decision === "NO"
    && audit?.execution_aborted === true
    && audit?.first_blocker === "final_audit_exception"
    && audit?.orchestrator_lock?.acquired === true;
}

function isReceiptFreeAudit(audit) {
  return isLockHeldAudit(audit) || isExecutionAbortedAudit(audit) || isLegacyOrchestratorConflictAudit(audit);
}

function verifyCore(issues, audit) {
  if (isReceiptFreeAudit(audit)) return;
  const rows = Array.isArray(audit?.receipts) ? audit.receipts : [];
  const seen = new Set(rows.map((row) => row.stage));
  for (const stage of STAGES) {
    if (!seen.has(stage.key)) issue(issues, "receipt_missing_from_final_audit", { stage: stage.key });
    const row = rows.find((item) => item.stage === stage.key);
    if (row) {
      if (row.receipt_present !== true) issue(issues, "final_audit_receipt_summary_not_present", { stage: stage.key });
      if (row.receipt_exists !== true) issue(issues, "final_audit_receipt_summary_file_not_confirmed", { stage: stage.key, file: row.file || "" });
      if (row.daily_run_id !== audit.daily_run_id) issue(issues, "final_audit_receipt_summary_daily_run_id_mismatch", { stage: stage.key, expected: audit.daily_run_id, actual: row.daily_run_id || "" });
      if (row.trade_date !== audit.trade_date) issue(issues, "final_audit_receipt_summary_trade_date_mismatch", { stage: stage.key, expected: audit.trade_date, actual: row.trade_date || "" });
    }
    if (!row?.file || !fs.existsSync(row.file)) { issue(issues, "receipt_file_missing", { stage: stage.key, file: row?.file || "" }); continue; }    const receipt = readJson(row.file, null);
    if (!receipt || receipt.receipt_present !== true) issue(issues, "receipt_contract_invalid", { stage: stage.key });
    if (receipt && (receipt.daily_run_id !== audit.daily_run_id || receipt.trade_date !== audit.trade_date)) issue(issues, "receipt_identity_mismatch", { stage: stage.key });
  }
}

function verifyModules(issues, audit, registry, auditRoot) {
  if (isReceiptFreeAudit(audit)) return;
  const coreKeys = new Set(STAGES.map((stage) => stage.key));
  const requiredModules = (registry.modules || []).filter((module) => !coreKeys.has(module.key) && module.required !== false && module.receipt_required !== false);
  const auditRows = new Map((audit?.module_receipts || []).map((row) => [row.key, row]));
  for (const module of requiredModules) {
    const file = moduleReceiptFile(auditRoot, audit?.trade_date || "", audit?.daily_run_id || "", module.key);
    const row = auditRows.get(module.key);
    if (!row) issue(issues, "module_receipt_missing_from_final_audit", { module: module.key });
    if (!fs.existsSync(file)) { issue(issues, "module_receipt_file_missing", { module: module.key, file }); continue; }
    const receipt = readJson(file, null);
    if (!receipt || receipt.receipt_present !== true) issue(issues, "module_receipt_contract_invalid", { module: module.key });
    if (receipt && (receipt.daily_run_id !== audit.daily_run_id || receipt.trade_date !== audit.trade_date)) issue(issues, "module_receipt_identity_mismatch", { module: module.key });
    if (audit?.decision === "YES" && (!receipt || receipt.status !== "PASS" || receipt.complete !== true)) issue(issues, "non_pass_module_in_yes_audit", { module: module.key, status: receipt?.status || "missing" });
  }
}

function normalizedReceiptRefs(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function verifyRequirements(issues, audit, registry) {
  const requirements = readJson(REQUIREMENTS_FILE, null);
  if (!requirements) { issue(issues, "requirements_matrix_missing", { file: REQUIREMENTS_FILE }); return; }
  if (requirements.contract !== "terminal-unattended-requirements-v1" || requirements.generated_for !== "full_unattended_final_audit" || !Array.isArray(requirements.requirements)) {
    issue(issues, "requirements_matrix_contract_invalid", { file: REQUIREMENTS_FILE }); return;
  }
  const keys = new Set();
  const ordered = [];
  for (const requirement of requirements.requirements) {
    if (!requirement?.key || keys.has(requirement.key)) issue(issues, "requirements_matrix_duplicate_or_missing_key", { key: requirement?.key || "" });
    keys.add(requirement?.key);
    ordered.push(Number(requirement?.order || 0));
    if (requirement.required !== true) continue
    if (isReceiptFreeAudit(audit)) continue;
    for (const ref of normalizedReceiptRefs(requirement.receipt)) {
      if (ref === "active-module-registry.json") {
        if (!registry) issue(issues, "required_receipt_registry_missing", { requirement: requirement.key });
        continue;
      }
      if (ref === "orchestrator_lock") {
        if (audit?.orchestrator_lock?.acquired !== true || audit?.orchestrator_lock?.released !== true) issue(issues, "required_receipt_lock_missing", { requirement: requirement.key });
        continue;
      }
      if (ref === "terminal-daily-manifest.json") {
        if (!audit?.manifest?.file || !fs.existsSync(audit.manifest.file)) issue(issues, "required_receipt_manifest_missing", { requirement: requirement.key });
        continue;
      }
      if (ref === "terminal-unattended-final-audit.json") continue;
      if (ref === "recovery_queue") {
        if (!audit?.recovery_queue?.file || !fs.existsSync(audit.recovery_queue.file)) issue(issues, "required_receipt_recovery_queue_missing", { requirement: requirement.key });
        continue;
      }
      const core = STAGES.find((stage) => stage.key === ref);
      if (core) {
        if (!(audit?.receipts || []).some((row) => row.stage === core.key)) issue(issues, "required_receipt_core_missing", { requirement: requirement.key, receipt: ref });
        continue;
      }
      const moduleRows = new Set((audit?.module_receipts || []).map((row) => row.key));
      if (!moduleRows.has(ref)) issue(issues, "required_receipt_module_missing", { requirement: requirement.key, receipt: ref });
    }
  }
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) issue(issues, "requirements_matrix_order_invalid");
}

function verifyRecoverySelfHealPlan(issues, audit) {
  if (isReceiptFreeAudit(audit)) return;
  if (audit?.decision !== "NO") return;
  const reason = String(audit?.reason_code || "");
  const firstBlocker = String(audit?.first_blocker || "");
  const needsSelfHeal = firstBlocker === "natural_evidence" || firstBlocker === "water_root" || firstBlocker === "websocket" || firstBlocker === "formal_gate" || reason.startsWith("natural_warmup_");
  if (!needsSelfHeal) return;
  const queueFile = audit?.recovery_queue?.file || "";
  const queue = readJson(queueFile, null);
  if (!queue) { issue(issues, "recovery_queue_readback_missing", { file: queueFile }); return; }
  const planEvidence = queue.self_heal_plan;
  if (!planEvidence) { issue(issues, "self_heal_plan_missing_for_recoverable_blocker", { first_blocker: firstBlocker, reason_code: reason }); return; }
  if (planEvidence.contract !== "terminal-recovery-self-heal-plan-evidence-v1") issue(issues, "self_heal_plan_evidence_contract_invalid");
  if (planEvidence.exit_code !== 0 || planEvidence.ok !== true) issue(issues, "self_heal_plan_evidence_not_ok", { exit_code: planEvidence.exit_code, ok: planEvidence.ok });
  if (planEvidence.dry_run !== true) issue(issues, "self_heal_plan_must_be_dry_run_in_final_audit");
  if (planEvidence.self_heal_counts_as_unattended_yes !== false) issue(issues, "self_heal_plan_must_not_count_as_unattended_yes");
  if (planEvidence.rewater_verification_required !== true) issue(issues, "self_heal_plan_rewater_verification_not_required");
  if (!planEvidence.plan_file || !fs.existsSync(planEvidence.plan_file)) issue(issues, "self_heal_plan_file_missing", { file: planEvidence.plan_file || "" });
  const plan = planEvidence.plan || readJson(planEvidence.plan_file || "", null);
  if (!plan) { issue(issues, "self_heal_plan_readback_missing", { file: planEvidence.plan_file || "" }); return; }
  if (plan.contract !== "daytrade-warmup-self-heal-runner-v1") issue(issues, "self_heal_plan_contract_invalid", { contract: plan.contract || "" });
  const invariants = new Set(Array.isArray(plan.invariants) ? plan.invariants : []);
  for (const required of [
    "task_missed_never_backfills_natural_evidence",
    "membership_ui_88_desktop_mobile_are_excluded_from_warmup_gate",
    "rewater_must_be_followed_by_verification",
    "success_requires_rewater_verification_not_action_exit_only",
    "self_heal_apply_failure_keeps_unattended_no"
  ]) {
    if (!invariants.has(required)) issue(issues, "self_heal_plan_invariant_missing", { invariant: required });
  }
  if (plan.mode !== "dry-run") issue(issues, "self_heal_plan_mode_not_dry_run", { mode: plan.mode || "" });
  const decision = plan.decision || {};
  const allowedStates = new Set(["SELF_HEAL_PLANNED", "WAITING_FOR_NATURAL_PHASE", "WAITING_RETRY_OR_DEAD_LETTER", "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD", "OUTSIDE_FORMAL_SOURCE_WINDOW_PRESERVE_PREVIOUS_GOOD", "NO_REWATER_NEEDED"]);
  if (!allowedStates.has(String(decision.state || ""))) issue(issues, "self_heal_plan_decision_state_invalid", { state: decision.state || "" });
  if (decision.self_heal_counts_as_unattended_yes !== false) issue(issues, "self_heal_plan_decision_counts_as_yes");
  if (decision.rewater_verification_required !== true) issue(issues, "self_heal_plan_decision_rewater_not_required");
  const jobs = Array.isArray(plan.jobs) ? plan.jobs : [];
  if (String(decision.state || "") === "SELF_HEAL_PLANNED" && jobs.filter((job) => job.executable === true).length < 1) issue(issues, "self_heal_plan_no_executable_jobs");
  for (const job of jobs) {
    if (!job.jobId || !job.idempotencyKey || !job.reasonCode || !job.receiptFile) issue(issues, "self_heal_job_identity_missing", { code: job.code || "" });
    if (!Array.isArray(job.actions) || job.actions.length < 1) issue(issues, "self_heal_job_actions_missing", { code: job.code || "" });
    if (job.natural_evidence_backfill_allowed !== false) issue(issues, "self_heal_job_backfills_natural_evidence", { code: job.code || "" });
    if (job.self_heal_counts_as_unattended_yes !== false) issue(issues, "self_heal_job_counts_as_unattended_yes", { code: job.code || "" });
    if (!Number.isFinite(Number(job.timeoutMs || job.timeout)) || Number(job.timeoutMs || job.timeout) <= 0) issue(issues, "self_heal_job_timeout_invalid", { code: job.code || "" });
  }
  const verifyLabels = new Set((Array.isArray(plan.rewaterVerification) ? plan.rewaterVerification : []).map((item) => item.label));
  if (!verifyLabels.has("npm:verify:daytrade-source-contract-alignment")) issue(issues, "self_heal_rewater_contract_verify_missing");
  if (!verifyLabels.has("npm:verify:fugle-websocket-sources")) issue(issues, "self_heal_rewater_websocket_verify_missing");
}
function main() {
  const issues = [];
  const file = AUDIT_FILE;
  const audit = readJson(file, null);
  verifyTrackedReleaseFiles(issues);
  if (!audit) issue(issues, "final_audit_missing", { file });
  if (!audit || !["terminal-unattended-final-audit-v1", "terminal-unattended-final-audit-v2"].includes(audit.contract)) issue(issues, "final_audit_contract_mismatch");
  if (!audit?.daily_run_id || !audit?.trade_date) issue(issues, "final_audit_identity_missing");
  const receiptFreeAudit = isReceiptFreeAudit(audit);
  if (!receiptFreeAudit && audit?.contract === "terminal-unattended-final-audit-v2" && audit?.receipt_summary_contract !== "terminal-final-audit-receipt-summary-v1") issue(issues, "receipt_summary_contract_missing_or_invalid", { actual: audit?.receipt_summary_contract || "" });
  if (!receiptFreeAudit && audit?.contract === "terminal-unattended-final-audit-v2") {
    if (path.resolve(String(audit.runner_path || "")) !== path.resolve(CANONICAL_RUNNER_PATH)) issue(issues, "final_audit_runner_not_canonical", { expected: CANONICAL_RUNNER_PATH, actual: audit.runner_path || "" });
    if (path.resolve(String(audit.source_root || "")) !== path.resolve(ROOT)) issue(issues, "final_audit_source_root_not_canonical", { expected: ROOT, actual: audit.source_root || "" });
    if (audit.runner_identity?.canonical !== true || path.resolve(String(audit.runner_identity?.path || "")) !== path.resolve(CANONICAL_RUNNER_PATH) || path.resolve(String(audit.runner_identity?.source_root || "")) !== path.resolve(ROOT)) issue(issues, "final_audit_runner_identity_invalid");
  }
  const registry = readJson(audit?.registry?.file || "", null);
  if (!receiptFreeAudit && !registry) issue(issues, "active_module_registry_missing", { file: audit?.registry?.file || "" });
  if (!receiptFreeAudit && registry && (registry.daily_run_id !== audit.daily_run_id || registry.trade_date !== audit.trade_date)) issue(issues, "active_module_registry_identity_mismatch");
  if (!receiptFreeAudit && registry?.scope === "full_unattended_final_audit") {
    const expectedNotConnected = (registry.modules || []).filter((module) => module.required !== false && module.receipt_required !== false && module.connected !== true).map((module) => module.key).sort();
    const actualNotConnected = [...(registry.not_connected_yet || [])].sort();
    if (expectedNotConnected.join(",") !== actualNotConnected.join(",")) issue(issues, "registry_not_connected_list_invalid", { expected: expectedNotConnected, actual: actualNotConnected });
    const expectedDeferred = (registry.modules || []).filter((module) => module.required === false && module.connected !== true).map((module) => module.key).sort();
    const actualDeferred = [...(registry.deferred_not_yet_wired || [])].sort();
    if (expectedDeferred.join(",") !== actualDeferred.join(",")) issue(issues, "registry_deferred_list_invalid", { expected: expectedDeferred, actual: actualDeferred });
    verifyModules(issues, audit, registry, AUDIT_ROOT);
  }
  verifyRequirements(issues, audit, registry);
  const pointer = audit?.trade_date ? path.join(AUDIT_ROOT, audit.trade_date, "daily-run-id.json") : "";
  const pointerRecord = receiptFreeAudit ? null : readJson(pointer, null);
  if (!receiptFreeAudit && !pointerRecord) issue(issues, "daily_run_id_pointer_missing", { file: pointer });
  if (!receiptFreeAudit && pointerRecord && pointerRecord.daily_run_id !== audit.daily_run_id) issue(issues, "daily_run_id_pointer_mismatch");
  verifyCore(issues, audit);
  verifyRecoverySelfHealPlan(issues, audit);
  if (!receiptFreeAudit && (!audit?.manifest?.file || !fs.existsSync(audit.manifest.file))) issue(issues, "daily_manifest_missing");
  if (!receiptFreeAudit && audit?.manifest?.runtime_file) {
    const runtimeManifest = readJson(audit.manifest.runtime_file, null);
    if (!runtimeManifest) issue(issues, "runtime_daily_manifest_missing", { file: audit.manifest.runtime_file });
    else if (runtimeManifest.contract !== "terminal-daily-manifest-v2" || runtimeManifest.daily_run_id !== audit.daily_run_id || runtimeManifest.trade_date !== audit.trade_date || runtimeManifest.runtime_file !== audit.manifest.runtime_file || runtimeManifest.ok !== (audit.manifest.ok === true)) issue(issues, "runtime_daily_manifest_identity_mismatch", { file: audit.manifest.runtime_file });
  }
  if (!receiptFreeAudit && audit?.contract === "terminal-unattended-final-audit-v2" && (!audit?.module_collection?.file || !fs.existsSync(audit.module_collection.file))) issue(issues, "module_collection_missing");
  if (!receiptFreeAudit && audit?.orchestrator_lock?.released !== true) issue(issues, "orchestrator_lock_not_released");
  if (isExecutionAbortedAudit(audit) && audit?.orchestrator_lock?.released !== true) issue(issues, "aborted_audit_lock_not_released");
  if (audit?.decision === "NO" && (!audit?.first_blocker || !audit?.reason_code || !audit?.allowed_action)) issue(issues, "no_decision_explanation_missing");
  if (isLockHeldAudit(audit) && !audit?.orchestrator_lock?.file) issue(issues, "lock_held_file_missing");
  if (REQUIRE_YES && audit?.decision !== "YES") issue(issues, "final_audit_not_yes", { decision: audit?.decision || "missing" });
  const payload = { contract: "terminal-final-audit-contract-verifier-v3", checked_at: new Date().toISOString(), audit_file: file, audit_ok: audit?.ok === true, decision: audit?.decision || "NO", daily_run_id: audit?.daily_run_id || "", trade_date: audit?.trade_date || "", ok: issues.length === 0, issues };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();








