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
    test: ({ text, input }) => Boolean(
      input?.unattendedStatus === "YES"
      || input?.unattended_yes === "YES"
      || input?.state === "UNATTENDED_YES"
      || input?.state === "CLOSED"
      || input?.status === "CLOSED"
      || /all_closure_gates_green|all_layers_green|unattended_yes|closure_green|state:closed|status:closed|status:green/.test(text)
    ),
  },
  {
    code: "MARKET_CLOSED",
    layer: "market_calendar",
    action: "preserve_previous_good_and_wait_next_trading_day",
    severity: "info",
    retryable: false,
    priority: 2,
    test: ({ text, input }) => input?.marketClosed === true || /market_closed|market_calendar|market closed|weekend|holiday/.test(text),
  },
  {
    code: "AUTO_ROLL_FORWARD_IDLE",
    layer: "auto_roll_forward",
    action: "continue_autonomous_monitoring",
    severity: "info",
    retryable: false,
    priority: 3,
    test: ({ text, input }) => input?.status === "IDLE_NO_RETRY_NEEDED" || /job_queue_empty|idle_no_retry_needed/.test(text),
  },
  {
    code: "READBACK_STATUS_OK",
    layer: "production_live_readback",
    action: "continue_autonomous_monitoring",
    severity: "info",
    retryable: false,
    priority: 3.5,
    test: ({ text }) => /(^|\|)\s*(?:live|terminal) api 200\s*(\||$)/i.test(text),
  },
  {
    code: "PUBLISH_DEFERRED_MANIFEST_PENDING",
    layer: "publish",
    action: "wait_until_daily_manifest_green_then_publish_scorecard",
    severity: "info",
    retryable: true,
    priority: 49.5,
    test: ({ text }) => /scorecard:manifest_pending_publish_deferred|manifest_pending_publish_deferred|publish_deferred_manifest_pending/i.test(text),
  },
  {
    code: "GATE_READY_INFO",
    layer: "status_info",
    action: "continue_autonomous_monitoring",
    severity: "info",
    retryable: false,
    priority: 4,
    test: ({ text, input }) => input?.ok === true || /date_preflight_ready|terminal_water_root_ready|status:ready|status:READY|status:green/.test(text),
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
    test: ({ text }) => /protectedreadbackcredential_not_ok|protected_readback_credential_not_ok|protected_readback_login_failed|protected_readback_login_error|protected_readback_unauthorized|protected_readback_membership_required|protected_readback_credential_next_actions_missing|protected_readback_timeout|protected_readback_request_error/.test(text),
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
    code: "PROTECTED_READBACK_TIMEOUT",
    layer: "production_live_readback",
    action: "retry_protected_readback_without_marking_scanner_failed",
    severity: "warning",
    retryable: true,
    priority: 13,
    test: ({ text }) => /protected_readback_timeout|protected readback timeout|scorecard:protected_readback_timeout|source_reports:protected_readback_timeout/.test(text),
  },
  {
    code: "PRODUCTION_RELEASE_SHA_MISMATCH",
    layer: "deploy",
    action: "deploy_or_align_production_release",
    severity: "critical",
    retryable: false,
    priority: 20,
    test: ({ text }) => /production_release_sha_mismatch|release_manifest_sha_mismatch|release sha.*production.*mismatch|production.*release.*mismatch/.test(text),
  },
  {
    code: "LOCAL_WIP_NOT_DEPLOYED",
    layer: "deploy",
    action: "finish_validation_commit_deploy_and_rerun_production_readback",
    severity: "warning",
    retryable: false,
    priority: 20.5,
    test: ({ text }) => /local_worktree_not_production_release|local_wip_not_deployed|release_sha_not_current_head|headSha.*releaseSha|localHeadMatchesProduction.*false|worktreeClean.*false/.test(text),
  },
  {
    code: "POWER_RECOVERY_NOT_OK",
    layer: "power_recovery",
    action: "verify_post_boot_autonomous_root_monitor_and_recovery_receipts",
    severity: "critical",
    retryable: true,
    priority: 21,
    test: ({ text }) => /powerrecoveryaudit_not_ok|power_recovery_not_ok|power-recovery-not-ok|post_boot_recovery_not_verified|autonomous_root_monitor_has_not_run_after_last_boot/.test(text),
  },
  {
    code: "WEBSOCKET_SOURCE_NOT_READY",
    layer: "websocket_source",
    action: "reconnect_or_repair_fugle_websocket_then_rerun_source_verifier",
    severity: "critical",
    retryable: true,
    priority: 28,
    test: ({ text, input }) => input?.firstBlocker === "websocket"
      || input?.first_blocker === "websocket"
      || input?.reasonCode === "websocket"
      || input?.reason_code === "websocket"
      || /^websocket$|reason:websocket\b|blocker:websocket\b/.test(text),
  },
  {
    code: "NATURAL_WARMUP_RECOVERED_AFTER_FAILED_CHECKPOINT",
    layer: "warmup_recovery",
    action: "run_rewater_verification_then_roll_forward_without_counting_natural_unattended_yes",
    severity: "critical",
    retryable: true,
    priority: 29.05,
    test: ({ text, input }) => input?.reasonCode === "natural_warmup_recovered_after_failed_checkpoint"
      || input?.reason_code === "natural_warmup_recovered_after_failed_checkpoint"
      || input?.allowedAction === "run_rewater_verification_then_roll_forward_without_counting_natural_unattended_yes"
      || input?.allowed_action === "run_rewater_verification_then_roll_forward_without_counting_natural_unattended_yes"
      || /natural_warmup_recovered_after_failed_checkpoint|run_rewater_verification_then_roll_forward_without_counting_natural_unattended_yes/.test(text),
  },
  {
    code: "NATURAL_WARMUP_WEBSOCKET_NOT_READY",
    layer: "warmup_websocket",
    action: "restart_fugle_websocket_source_then_run_rewater_verification",
    severity: "critical",
    retryable: true,
    priority: 29.1,
    test: ({ text, input }) => input?.reasonCode === "natural_warmup_websocket_not_ready"
      || input?.reason_code === "natural_warmup_websocket_not_ready"
      || input?.allowedAction === "restart_fugle_websocket_source_then_run_rewater_verification"
      || input?.allowed_action === "restart_fugle_websocket_source_then_run_rewater_verification"
      || /natural_warmup_websocket_not_ready|restart_fugle_websocket_source_then_run_rewater_verification|websocket_formal_ready|websocket_status_fresh_seconds/.test(text),
  },
  {
    code: "NATURAL_WARMUP_DAYTRADE_SOURCE_NOT_READY",
    layer: "warmup_source",
    action: "restart_daytrade_source_writer_then_run_rewater_verification",
    severity: "critical",
    retryable: true,
    priority: 29.2,
    test: ({ text, input }) => input?.reasonCode === "natural_warmup_daytrade_source_not_ready"
      || input?.reason_code === "natural_warmup_daytrade_source_not_ready"
      || input?.allowedAction === "restart_daytrade_source_writer_then_run_rewater_verification"
      || input?.allowed_action === "restart_daytrade_source_writer_then_run_rewater_verification"
      || /natural_warmup_daytrade_source_not_ready|restart_daytrade_source_writer_then_run_rewater_verification|source_payload_fresh|source_daytrade_gate_grade|source_formal_entry_allowed/.test(text),
  },
  {
    code: "NATURAL_WARMUP_CANONICAL_GATE_NOT_READY",
    layer: "warmup_canonical_gate",
    action: "refresh_daytrade_canonical_gate_then_run_rewater_verification",
    severity: "critical",
    retryable: true,
    priority: 29.3,
    test: ({ text, input }) => input?.reasonCode === "natural_warmup_canonical_gate_not_ready"
      || input?.reason_code === "natural_warmup_canonical_gate_not_ready"
      || input?.allowedAction === "refresh_daytrade_canonical_gate_then_run_rewater_verification"
      || input?.allowed_action === "refresh_daytrade_canonical_gate_then_run_rewater_verification"
      || /natural_warmup_canonical_gate_not_ready|refresh_daytrade_canonical_gate_then_run_rewater_verification|canonical_formal_entry_speed_verdict|canonical_formal_entry_allowed/.test(text),
  },
  {
    code: "NATURAL_WARMUP_FUTOPT_TXF_NOT_READY",
    layer: "warmup_futopt_txf",
    action: "restart_futopt_websocket_and_refresh_contract_health_then_reverify",
    severity: "critical",
    retryable: true,
    priority: 29.4,
    test: ({ text, input }) => input?.reasonCode === "natural_warmup_futopt_txf_not_ready"
      || input?.reason_code === "natural_warmup_futopt_txf_not_ready"
      || input?.allowedAction === "restart_futopt_websocket_and_refresh_contract_health_then_reverify"
      || input?.allowed_action === "restart_futopt_websocket_and_refresh_contract_health_then_reverify"
      || /natural_warmup_futopt_txf_not_ready|restart_futopt_websocket_and_refresh_contract_health_then_reverify|futopt_|txf/.test(text),
  },
  {
    code: "SOURCE_WATER_ROOT_NOT_READY",
    layer: "source",
    action: "recheck_water_root_or_rewater",
    severity: "critical",
    retryable: true,
    priority: 30,
    test: ({ text, input }) => input?.waterRoot?.ok === false || input?.canonicalGate?.canonicalGateStatus === "not_ready" || /blocked_source|waterroot_not_ok|water_root_not_ok|canonical_gate_not_a|source_root_not_ready|source_status_not_ok|source_status=degraded|source_status_not_connected|source_not_ready|source_quality_fail|latest_candle_time|ready_ge_\d+|ready_ma\d+|fresh_quote_coverage|coverage|stale|priority.*0|not connected/.test(text),
  },
  { code: "DAILY_OHLC_INCOMPLETE", layer: "daily_ohlcv", action: "backfill_daily_ohlcv_on_source_writer_then_reverify", severity: "critical", retryable: true, priority: 30.5, test: ({ text }) => /daily_ohlc_incomplete|daily_ohlc_latest_coverage_low|daily_ohlc_recent_day_coverage_low|daily_ohlc_contract_missing|daily ohlc.*incomplete|ohlc_symbols.*<\s*1500/.test(text) },
  {
    code: "FORMAL_ENTRY_GATE_NOT_A",
    layer: "formal_entry_gate",
    action: "hold_formal_entry_until_gate_a",
    severity: "critical",
    retryable: true,
    priority: 31,
    test: ({ text, input }) => input?.canonicalGate?.canonicalGateGrade && input.canonicalGate.canonicalGateGrade !== "A" || /canonical_gate_not_a|gate_grade=[bcdf]|sourcegate":"[bcdf]"|formal_entry_allowed=false|formal_entry_not_allowed_by_water_root|formal_entry_not_allowed/.test(text),
  },
  {
    code: "NATURAL_WARMUP_EVIDENCE_NOT_OK",
    layer: "warmup",
    action: "wait_or_rewater_then_reverify_natural_warmup",
    severity: "critical",
    retryable: true,
    priority: 32,
    test: ({ text }) => /warmup_\d{4}_not_green|natural_(?:0700|0845|0900)_not_green|natural_warmup_not_ok|natural_warmup_gate_not_a|natural_evidence/.test(text),
  },
  {
    code: "SCANNER_APPLY_REQUIRED",
    layer: "auto_roll_forward",
    action: "wait_for_policy_allowed_scanner_apply",
    severity: "info",
    retryable: true,
    priority: 111,
    test: ({ text }) => /scanner_apply_enabled|apply_scanners_required|scanner_requires_apply_scanners/.test(text),
  },
  {
    code: "NEXT_TRADING_DAY_MODULE_REPAIR",
    layer: "strategy_scan_state",
    action: "queue_module_for_next_trading_day_repair",
    severity: "high",
    retryable: true,
    priority: 39,
    test: ({ text, input }) => input?.reasonCode === "next_trading_day_module_repair"
      || input?.reason_code === "next_trading_day_module_repair"
      || /next_trading_day_module_repair_required|next_trading_day_module_repair/.test(text),
  },
  {
    code: "SCANNER_RAW_FALLBACK",
    layer: "scanner",
    action: "rerun_scanner_after_water_ok",
    severity: "critical",
    retryable: true,
    priority: 40,
    test: ({ text, input }) => input?.rawFallback === true || /manifest_raw_fallback_true|manifest_fallback_true|manifest_module_fallback:|rawfallback":true|raw_fallback/.test(text),
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
    test: ({ text, input }) => input?.runIdClosureOk === false || /failed_display|blocked_runid_closure|runid_closure_not_ok|runid.*mismatch|runid\s*!=|live api\s*!=|desktop artifact runid|mobile fragment runid|scorecard.*latest pointer|latest pointer.*runid|missing.*runid|productionapi":""|mobile":""|scorecard88":""/.test(text),
  },
  {
    code: "TRADE_DATE_MISMATCH",
    layer: "date_contract",
    action: "rerun_with_expected_trade_date",
    severity: "critical",
    retryable: true,
    priority: 71,
    test: ({ text }) => /tradedate_mismatch|sourcedate_mismatch|rundate_mismatch|date_hard_gate_mismatch|date mismatch|latestdate_mismatch|scorecard_latestdate_mismatch|latest date\s+\d{8}\s*!=\s*expected\s+\d{8}/.test(text),
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
    code: "RECOVERY_QUEUE_NOT_OK",
    layer: "recovery_queue",
    action: "verify_recovery_queue_receipts",
    severity: "critical",
    retryable: true,
    priority: 81.5,
    test: ({ text }) => /refresh_failed:recovery_queue|recovery_queue_not_ok|recovery_queue_failed_receipts|recovery_queue_invalid_deferred_receipts/.test(text),
  },
  {
    code: "RESOURCE_CHAIN_NOT_OK",
    layer: "resource_chain",
    action: "verify_terminal_resource_chain_unattended",
    severity: "critical",
    retryable: true,
    priority: 82,
    test: ({ text }) => /resourcechain_not_ok|resource_chain_not_ok|terminal_resource_chain_unattended_failed|resource_chain_readback|resource-chain-readback|terminal-resource-chain:unattended_exit_1/.test(text),
  },
  {
    code: "PRODUCTION_LIVE_READBACK_NOT_OK",
    layer: "production_live_readback",
    action: "run_production_live_readback_after_auth_and_deploy",
    severity: "critical",
    retryable: true,
    priority: 83,
    test: ({ text }) => /productionliveopsreadback_not_ok|production_live_not_ok|production_live_issue|refresh_failed:production_live_readback|production_live_authenticated_readback_required_for_ready/.test(text),
  },
  {
    code: "OPS_STATUS_SNAPSHOT_NOT_READY",
    layer: "ops_status",
    action: "rerun_ops_status_export_after_current_blocker_is_classified",
    severity: "warning",
    retryable: true,
    priority: 83.5,
    test: ({ text }) => /refresh_failed:ops_status_snapshot|ops_status_snapshot_not_ready|ops_status_export_failed/.test(text),
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
    code: "AUTO_ROLL_FORWARD_WAITING_FORMAL_WINDOW",
    layer: "auto_roll_forward",
    action: "wait_for_next_formal_window",
    severity: "info",
    retryable: true,
    priority: 85,
    test: ({ text }) => /waiting_formal_window|resume_window_due|safe_jobs_ready_waiting_formal_window/.test(text),
  },
  {
    code: "AUTO_ROLL_FORWARD_QUEUE_ARMED",
    layer: "auto_roll_forward",
    action: "run_retry_queue_when_policy_allows",
    severity: "info",
    retryable: true,
    priority: 112,
    test: ({ text }) => /roll_forward_queue_armed/.test(text),
  },
  {
    code: "SOURCE_WARMUP_PENDING",
    layer: "source_warmup",
    action: "wait_until_0700_then_collect_natural_evidence",
    severity: "info",
    retryable: true,
    priority: 109,
    test: ({ text, input }) => input?.reasonCode === "module_not_due"
      || input?.reason_code === "module_not_due"
      || /source_warmup|stock_universe_1m|mother_pool|module_not_due|wait_until_07\d{2}|wait_until_07:00|wait_until_08:00|wait_until_0800/.test(text),
  },
  {
    code: "PREDICTIVE_PREFLIGHT_WAIT_SOURCE_WINDOW",
    layer: "predictive_preflight",
    action: "wait_or_recheck_source_window",
    severity: "info",
    retryable: true,
    priority: 110,
    test: ({ text }) => /trading_day_after_formal_source_window|trading_day_wait_source_window/.test(text),
  },
  {
    code: "FINAL_AUDIT_NOT_OK",
    layer: "final_audit",
    action: "run_final_audit_after_blockers_clear",
    severity: "critical",
    retryable: true,
    priority: 81,
    test: ({ text }) => /finalaudit_not_ok|final_audit_not_ok|final_audit_issue|final_audit_layers_not_21|terminal_autonomous_completion_audit|completion_audit/.test(text),
  },
  {
    code: "SCHEDULE_PENDING_NOT_DUE",
    layer: "schedule",
    action: "wait_until_due_time",
    severity: "info",
    retryable: true,
    priority: 120,
    test: ({ text, input }) => input?.pendingNotDue === true || /pending_not_due|PENDING_NOT_DUE|module_not_due|wait_until_\d{2}:\d{2}/i.test(text),
  },
  {
    code: "AUTONOMOUS_SCHEDULE_NOT_READY",
    layer: "schedule",
    action: "repair_or_verify_autonomous_schedule",
    severity: "critical",
    retryable: true,
    priority: 83,
    test: ({ text }) => /live_schedule_gate_failed|live_task_missing|autonomous_schedule.*not_ready|schedule_gate_failed/.test(text),
  },];

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






