"use strict";

const DEFAULT_CODE = {
  code: "UNKNOWN_BLOCKER",
  layer: "unknown",
  action: "inspect",
  severity: "warning",
  retryable: false,
  priority: 900,
};

const DEFINITIONS = [
  {
    code: "CLOSURE_GREEN",
    layer: "closure",
    action: "continue_autonomous_monitoring",
    severity: "info",
    retryable: false,
    priority: 1,
    test: ({ text, input }) => input?.ok === true || /all_closure_gates_green|all_layers_green|unattended_yes|closure_green|state:closed|status:closed|status:green/.test(text),
  },
  {
    code: "AUTH_PROTECTED_READBACK_NOT_ARMED",
    layer: "auth_readback",
    action: "arm_protected_readback_credential",
    severity: "critical",
    retryable: false,
    priority: 10,
    test: ({ text }) => /protected_readback_credential_not_armed|authenticated_protected_readback_not_armed|authenticated readback required|protected_surface_needs_authenticated_readback_token|token not armed|missing_bearer_token/.test(text),
  },
  {
    code: "AUTH_PROTECTED_READBACK_NOT_OK",
    layer: "auth_readback",
    action: "verify_protected_readback_credential",
    severity: "critical",
    retryable: false,
    priority: 11,
    test: ({ text }) => /protectedreadbackcredential_not_ok|protected_readback_credential_not_ok|protected_readback_login_failed|protected_readback_login_error|protected_readback_unauthorized|protected_readback_membership_required|protected_readback_credential_next_actions_missing/.test(text),
  },
  {
    code: "AUTH_BACKEND_SERVICE_TOKEN_INVALID",
    layer: "backend_auth",
    action: "repair_backend_service_token",
    severity: "critical",
    retryable: false,
    priority: 12,
    test: ({ text }) => /blocked_auth|backend_service_token|service token|401|unauthorized/.test(text) && !/scorecardstatus":401|scorecardstatus:401|membership-protected|authenticated readback/.test(text),
  },
  {
    code: "PRODUCTION_RELEASE_SHA_MISMATCH",
    layer: "deploy",
    action: "deploy_or_align_production_release",
    severity: "critical",
    retryable: false,
    priority: 20,
    test: ({ text }) => /production_release_sha_mismatch|release_manifest_sha_mismatch|release_sha_not_current_head|release sha.*mismatch|release_mismatch/.test(text),
  },
  {
    code: "SOURCE_WATER_ROOT_NOT_READY",
    layer: "source",
    action: "recheck_water_root_or_rewater",
    severity: "critical",
    retryable: true,
    priority: 30,
    test: ({ text, input }) => input?.waterRoot?.ok === false || input?.canonicalGate?.canonicalGateStatus === "not_ready" || /blocked_source|waterroot_not_ok|water_root_not_ok|canonical_gate_not_a|source_root_not_ready|source_status_not_ok|source_status=degraded|source_status_not_connected|source_not_ready|coverage|stale|priority.*0|not connected/.test(text),
  },
  {
    code: "FORMAL_ENTRY_GATE_NOT_A",
    layer: "formal_entry_gate",
    action: "hold_formal_entry_until_gate_a",
    severity: "critical",
    retryable: true,
    priority: 31,
    test: ({ text, input }) => input?.canonicalGate?.canonicalGateGrade && input.canonicalGate.canonicalGateGrade !== "A" || /canonical_gate_not_a|gate_grade=[bcdf]|sourcegate":"[bcdf]"|formal_entry_allowed=false/.test(text),
  },
  {
    code: "SCANNER_RAW_FALLBACK",
    layer: "scanner",
    action: "rerun_scanner_after_water_ok",
    severity: "critical",
    retryable: true,
    priority: 40,
    test: ({ text, input }) => input?.rawFallback === true || /manifest_raw_fallback_true|rawfallback":true|raw_fallback/.test(text),
  },
  {
    code: "SCANNER_EVIDENCE_INSUFFICIENT",
    layer: "scanner_evidence",
    action: "rerun_scanner_and_collect_evidence",
    severity: "critical",
    retryable: true,
    priority: 41,
    test: ({ text, input }) => input?.evidenceStatus && input.evidenceStatus !== "complete" || /failed_scan|manifest_scanner_not_complete|manifest_module_evidence|manifest_evidence_not_complete|evidence_not_complete|evidencestatus":"insufficient|evidenceStatus=insufficient/.test(text),
  },
  {
    code: "PUBLISH_NOT_ALLOWED",
    layer: "publish",
    action: "hold_publish_until_manifest_green",
    severity: "critical",
    retryable: true,
    priority: 50,
    test: ({ text, input }) => input?.publishAllowed === false || /manifest_publish_not_allowed|publish_not_allowed|publishallowed":false|publish_allowed=false/.test(text),
  },
  {
    code: "PREVIOUS_GOOD_PRESERVED",
    layer: "previous_good",
    action: "preserve_previous_good_and_mark_degraded",
    severity: "warning",
    retryable: true,
    priority: 60,
    test: ({ text, input }) => input?.fallback === true || input?.preservePreviousGood === true || input?.previousGoodHold === true || /manifest_preserve_previous_good_true|preserve_previous_good|previous_good|previous good/.test(text),
  },
  {
    code: "RUNID_CLOSURE_NOT_OK",
    layer: "runid_closure",
    action: "verify_api_desktop_mobile_88_same_runid",
    severity: "critical",
    retryable: true,
    priority: 70,
    test: ({ text, input }) => input?.runIdClosureOk === false || /failed_display|blocked_runid_closure|runid_closure_not_ok|runid.*mismatch|runId.*mismatch|missing.*runid|productionapi":""|mobile":""|scorecard88":""/.test(text),
  },
  {
    code: "TRADE_DATE_MISMATCH",
    layer: "date_contract",
    action: "rerun_with_expected_trade_date",
    severity: "critical",
    retryable: true,
    priority: 71,
    test: ({ text }) => /tradedate_mismatch|sourcedate_mismatch|date mismatch|latestdate_mismatch|scorecard_latestdate_mismatch/.test(text),
  },
  {
    code: "SCORECARD_DATE_MISMATCH",
    layer: "scorecard",
    action: "republish_scorecard_after_manifest_green",
    severity: "critical",
    retryable: true,
    priority: 72,
    test: ({ text }) => /failed_publish|publish_deferred_manifest_pending|scorecard_latestdate_mismatch|scorecard.*date.*mismatch/.test(text),
  },
  {
    code: "DAILY_MANIFEST_NOT_OK",
    layer: "daily_manifest",
    action: "inspect_daily_manifest_modules",
    severity: "critical",
    retryable: true,
    priority: 80,
    test: ({ text, input }) => input?.contract === "daily-terminal-run-manifest-v1" && input?.ok === false || /dailymanifest_not_ok|daily_manifest_not_ok|manifest_module_blocked|manifest_not_ok|manifest_not_green/.test(text),
  },
  {
    code: "RESOURCE_CHAIN_NOT_OK",
    layer: "resource_chain",
    action: "verify_terminal_resource_chain_unattended",
    severity: "critical",
    retryable: true,
    priority: 82,
    test: ({ text }) => /resourcechain_not_ok|resource_chain_not_ok|terminal_resource_chain_unattended_failed/.test(text),
  },
  {
    code: "PRODUCTION_LIVE_READBACK_NOT_OK",
    layer: "production_live_readback",
    action: "run_production_live_readback_after_auth_and_deploy",
    severity: "critical",
    retryable: true,
    priority: 83,
    test: ({ text }) => /productionliveopsreadback_not_ok|production_live_not_ok|production_live_issue|production_live_authenticated_readback_required_for_ready/.test(text),
  },
  {
    code: "REASON_CODE_CLASSIFIER_NOT_OK",
    layer: "reason_code_classifier",
    action: "fix_reason_code_mapping",
    severity: "critical",
    retryable: true,
    priority: 85,
    test: ({ text }) => /reasoncodeclassifier_not_ok|reason_code_classifier_not_ok|reason_code_classifier_unknown_entries|ops_status_reason_code_summary_not_ok/.test(text),
  },
  {
    code: "SAFE_RECOVERY_PREVIEW_NOT_READY",
    layer: "auto_roll_forward",
    action: "verify_safe_recovery_preview",
    severity: "critical",
    retryable: true,
    priority: 174,
    test: ({ text }) => /safe_recovery_preview_contract_missing|safe_recovery_preview.*not_ok|safeRecoveryPreview.*missing/.test(text),
  },
  {
    code: "AUTO_ROLL_FORWARD_NOT_OK",
    layer: "auto_roll_forward",
    action: "inspect_auto_roll_forward_queue",
    severity: "critical",
    retryable: true,
    priority: 84,
    test: ({ text }) => /autorollforward_not_ok|auto_roll_forward_not_ok|auto_roll_forward_idempotency_invariant_missing/.test(text),
  },
  {
    code: "AUTO_ROLL_FORWARD_QUEUE_ARMED",
    layer: "auto_roll_forward",
    action: "run_retry_queue_when_policy_allows",
    severity: "info",
    retryable: true,
    priority: 112,
    test: ({ text }) => /roll_forward_queue_armed/.test(text),
  },  {
    code: "PREDICTIVE_PREFLIGHT_WAIT_SOURCE_WINDOW",
    layer: "predictive_preflight",
    action: "wait_or_recheck_source_window",
    severity: "info",
    retryable: true,
    priority: 110,
    test: ({ text }) => /trading_day_after_formal_source_window|trading_day_wait_source_window/.test(text),
  },  {
    code: "FINAL_AUDIT_NOT_OK",
    layer: "final_audit",
    action: "run_final_audit_after_blockers_clear",
    severity: "critical",
    retryable: true,
    priority: 81,
    test: ({ text }) => /finalaudit_not_ok|final_audit_not_ok|final_audit_issue|terminal_autonomous_completion_audit|completion_audit/.test(text),
  },
  {
    code: "SCHEDULE_PENDING_NOT_DUE",
    layer: "schedule",
    action: "wait_until_due_time",
    severity: "info",
    retryable: true,
    priority: 120,
    test: ({ text, input }) => input?.pendingNotDue === true || /pending_not_due|PENDING_NOT_DUE/i.test(text),
  },
];

function compactText(input) {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") return input;
  if (typeof input !== "object") return String(input);
  const parts = [];
  for (const key of ["blocker", "issue", "code", "reason", "status", "state", "message", "error", "key", "label", "sourceMessage", "sourceStatus", "sourceGate"]) {
    if (input[key] !== undefined && input[key] !== null) parts.push(`${key}:${input[key]}`);
  }
  if (Array.isArray(input.issues)) parts.push(`issues:${input.issues.join(" | ")}`);
  if (Array.isArray(input.failures)) parts.push(`failures:${input.failures.join(" | ")}`);
  if (input.gates && typeof input.gates === "object") parts.push(`gates:${JSON.stringify(input.gates)}`);
  if (input.runIds && typeof input.runIds === "object") parts.push(`runIds:${JSON.stringify(input.runIds)}`);
  if (input.canonicalGate && typeof input.canonicalGate === "object") parts.push(`canonicalGate:${JSON.stringify(input.canonicalGate)}`);
  return parts.join(" | ");
}

function normalizeText(input) {
  return compactText(input).toLowerCase().replace(/\s+/g, " ");
}

function uniqueByCode(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows.sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code))) {
    if (seen.has(row.code)) continue;
    seen.add(row.code);
    out.push(row);
  }
  return out;
}

function classifyReason(input, context = {}) {
  const text = normalizeText(input);
  const matches = [];
  const probe = { input, text, context };
  for (const def of DEFINITIONS) {
    let ok = false;
    try {
      ok = def.test(probe) === true;
    } catch {
      ok = false;
    }
    if (ok) {
      const { test, ...rest } = def;
      matches.push(rest);
    }
  }
  if (!matches.length && context.allowUnknown !== false) matches.push(DEFAULT_CODE);
  return {
    contract: "terminal-reason-code-classification-v1",
    sourceText: compactText(input),
    codes: uniqueByCode(matches),
    primaryCode: matches.length ? uniqueByCode(matches)[0].code : "",
    unknown: matches.some((row) => row.code === "UNKNOWN_BLOCKER"),
  };
}

function classifyMany(rows, context = {}) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => ({
    index,
    input: row,
    classification: classifyReason(row, context),
  }));
}

function hasCode(classification, code) {
  return (classification?.codes || []).some((row) => row.code === code);
}

module.exports = {
  DEFINITIONS: DEFINITIONS.map(({ test, ...rest }) => rest),
  classifyReason,
  classifyMany,
  hasCode,
  _private: { normalizeText, compactText, DEFAULT_CODE },
};








