"use strict";

const path = require("path");
const { STAGES, compactDate } = require("./terminal-final-audit-contract");

const DOWNSTREAM_MODULES = Object.freeze([  { key: "power_recovery", label: "Power Outage Recovery", dueTime: "00:00", class: "recovery", source: "state/power-recovery.json", adapter: "power_recovery", command: { cwd: ".", executable: "node", args: ["scripts/verify-terminal-power-recovery.js"] }, verifier: "scripts/verify-terminal-power-recovery.js", allowedAction: "repair_or_register_start_when_available_final_audit_task_then_rerun" },
  { key: "source_warmup", label: "Full-Day Source Warmup", dueTime: "07:00", class: "source", source: "state/daytrade-unattended-gate-watchdog.json", adapter: "watchdog_source", verifier: "scripts/verify-fugle-websocket-sources.js", allowedAction: "repair_or_reconnect_source_then_rerun_warmup" },
  { key: "stock_universe_1m", label: "Stock Universe and 1m K", dueTime: "08:00", class: "data", source: "state/daytrade-unattended-gate-watchdog.json", adapter: "watchdog_universe", verifier: "scripts/verify-terminal-water-root.js", allowedAction: "restore_full_stock_universe_and_1m_candles_then_rerun" },
  { key: "indicators_volume", label: "MA3/5/10/20/30/35/58, KD/MACD/RSI and Volume", dueTime: "08:00", class: "data", source: "state/daytrade-unattended-gate-watchdog.json", adapter: "watchdog_indicators", verifier: "scripts/verify-terminal-water-root.js", allowedAction: "restore_indicator_and_volume_chain_then_rerun" },
  { key: "mother_pool", label: "Mother Pool 300-600", dueTime: "09:00", class: "pool", source: "state/daytrade-unattended-gate-watchdog.json", adapter: "watchdog_mother_pool", command: { cwd: ".", executable: "node", args: ["--use-system-ca", "scripts/verify-daytrade-mother-pool-contract.js"] }, verifier: "scripts/verify-daytrade-mother-pool-contract.js", allowedAction: "restore_300_to_600_symbol_mother_pool_then_rerun" },
  { key: "top40", label: "TOP40 Priority Pool", dueTime: "09:00", class: "pool", source: "state/daytrade-unattended-gate-watchdog.json", adapter: "watchdog_top40", command: { cwd: ".", executable: "node", args: ["--use-system-ca", "scripts/verify-daytrade-mother-pool-contract.js"] }, verifier: "scripts/verify-daytrade-mother-pool-contract.js", allowedAction: "restore_top40_priority_pool_and_fresh_quote_coverage_then_rerun" },
  { key: "natural_evidence", label: "0700/0845/0900 Natural Evidence", dueTime: "09:00", class: "evidence", source: "state/daytrade-unattended-gate-watchdog.json", adapter: "watchdog_natural_evidence", verifier: "scripts/verify-terminal-water-root.js", allowedAction: "wait_for_natural_checkpoint_or_record_blocked_recovery_evidence" },
  { key: "daily_ohlcv", label: "Daily OHLCV Completeness", dueTime: "16:00", class: "data", source: "state/terminal-daily-ohlcv-verification.json", adapter: "verification_command", command: { cwd: "C:/fuman-terminal", executable: "node", args: ["scripts/verify-terminal-daily-ohlcv.js"] }, verifier: "scripts/verify-terminal-daily-ohlcv.js", allowedAction: "run_read_only_daily_ohlcv_verifier_after_backfill_done" },
  { key: "strategy2", label: "Strategy2", dueTime: "09:00", class: "strategy", source: "data/scan-receipts/strategy2.json", adapter: "scan_receipt", verifier: "scripts/verify-strategy2-terminal-visible-readback.js", allowedAction: "rerun_strategy2_for_current_trade_date_then_reverify" },
  { key: "strategy3", label: "Strategy3", dueTime: "13:05", class: "strategy", source: "data/scan-receipts/strategy3.json", adapter: "scan_receipt", verifier: "scripts/verify-strategy3-live-readback.js", allowedAction: "rerun_strategy3_for_current_trade_date_then_reverify" },
  { key: "strategy4", label: "Strategy4", dueTime: "16:00", class: "strategy", source: "data/scan-receipts/strategy4.json", adapter: "contract_verification_command", command: { cwd: ".", executable: "node", args: ["--use-system-ca", "scripts/verify-strategy4-88-data-chain.js"] }, verifier: "scripts/verify-strategy4-88-data-chain.js", allowedAction: "rerun_strategy4_for_current_trade_date_then_reverify" },
  { key: "strategy5", label: "Strategy5", dueTime: "21:00", class: "strategy", source: "data/scan-receipts/strategy5.json", adapter: "scan_receipt", verifier: "scripts/verify-terminal-resource-chain.js", allowedAction: "repair_strategy5_terminal_and_source_reports_then_rerun" },
  { key: "institution", label: "Institution / 法人", dueTime: "21:00", class: "chip", source: "data/scan-receipts/institution.json", adapter: "scan_receipt", verifier: "scripts/verify-terminal-resource-chain.js", allowedAction: "rerun_institution_for_current_trade_date_then_reverify" },
  { key: "canary", label: "Canary Publish", dueTime: "21:30", class: "closure", source: "state/terminal-canary-publish.json", adapter: "contract_verification_command", command: { cwd: ".", executable: "node", args: ["scripts/verify-terminal-canary-publish.js"] }, verifier: "scripts/verify-terminal-canary-publish.js", allowedAction: "run_canary_publish_verifier_and_record_current_receipt" },
  { key: "runid_closure", label: "RunId Closure", dueTime: "21:30", class: "closure", source: "state/terminal-runid-closure.json", adapter: "contract_verification_command", command: { cwd: ".", executable: "node", args: ["scripts/verify-terminal-runid-closure-contract.js"] }, verifier: "scripts/verify-terminal-runid-closure-contract.js", allowedAction: "repair_daily_run_id_closure_then_reverify" },
  { key: "api", label: "API", dueTime: "22:00", class: "surface", source: "", adapter: "resource_chain", resourceKey: "terminalApi", verifier: "scripts/verify-api-unattended-scorecard.js", allowedAction: "run_read_only_api_scorecard_and_record_current_receipt" },
  { key: "desktop", label: "Desktop", dueTime: "22:00", class: "surface", source: "", adapter: "resource_chain", resourceKey: "desktopSnapshot", verifier: "scripts/verify-terminal-ui-state-acceptance.js", allowedAction: "refresh_and_verify_current_desktop_route_snapshot" },
  { key: "mobile", label: "Mobile", dueTime: "22:00", class: "surface", source: "", adapter: "resource_chain", resourceKey: "mobileFragment", verifier: "scripts/verify-terminal-ui-e2e.js", allowedAction: "refresh_and_verify_current_mobile_states" },
  { key: "route_88", label: "/88", dueTime: "22:00", class: "surface", source: "data/route-88-latest.json", adapter: "contract_verification_command", command: { cwd: ".", executable: "node", args: ["scripts/verify-terminal-ui-receipt.js"] }, verifier: "scripts/verify-terminal-ui-state-acceptance.js", allowedAction: "verify_current_88_route_states" },
  { key: "scorecard", label: "Scorecard", dueTime: "22:00", class: "surface", source: "", adapter: "resource_chain", resourceKey: "scorecard", verifier: "scripts/verify-api-unattended-scorecard.js", allowedAction: "run_read_only_scorecard_verifier_for_current_trade_date" },
  { key: "source_reports", label: "sourceReports", dueTime: "22:00", class: "surface", source: "", adapter: "resource_chain", resourceKey: "chain", verifier: "scripts/verify-terminal-resource-chain.js", allowedAction: "produce_current_source_reports_and_reverify" },
  { key: "watchdog", label: "Watchdog", dueTime: "22:00", class: "control", source: "state/daytrade-unattended-gate-watchdog.json", adapter: "contract_verification_command", command: { cwd: ".", executable: "node", args: ["scripts/verify-terminal-autonomous-root-runner.js"] }, verifier: "scripts/verify-terminal-autonomous-root-runner.js", allowedAction: "repair_watchdog_and_record_current_recovery_evidence" },
  { key: "auto_roll_forward", label: "Auto Roll Forward", dueTime: "22:30", class: "control", source: "state/terminal-auto-roll-forward.json", adapter: "contract_verification_command", command: { cwd: ".", executable: "node", args: ["scripts/verify-terminal-auto-roll-forward.js"] }, verifier: "scripts/verify-terminal-auto-roll-forward.js", allowedAction: "run_auto_roll_forward_verifier_and_recover_only_affected_stage" },
  { key: "control_plane", label: "Control Plane", dueTime: "22:30", class: "control", source: "state/terminal-control-plane.json", adapter: "contract_verification_command", command: { cwd: ".", executable: "node", args: ["scripts/verify-terminal-control-plane.js"] }, verifier: "scripts/verify-terminal-control-plane.js", allowedAction: "repair_control_plane_then_rerun_read_only_verifier" },
  { key: "recovery_queue", label: "Recovery Queue", dueTime: "22:30", class: "control", source: "state/terminal-recovery-queue.json", adapter: "contract_verification_command", command: { cwd: ".", executable: "node", args: ["scripts/verify-terminal-recovery-queue.js", "--trade-date={tradeDate}", "--daily-run-id={dailyRunId}", "--state={runtimeDir}/state/terminal-orchestrator-state.json", "--queue={auditRoot}/{tradeDate}/{dailyRunId}/recovery-queue.json"] }, verifier: "scripts/verify-terminal-recovery-queue.js", allowedAction: "process_recovery_queue_then_rerun_read_only_verifier" },
]);

// The convergence scope expands only when a real receipt adapter is available.
// Required modules still fail closed on stale, missing, or blocked evidence.
const REQUIRED_DOWNSTREAM_MODULE_KEYS = Object.freeze([
  "power_recovery",
  "source_warmup",
  "stock_universe_1m",
  "indicators_volume",
  "mother_pool",
  "top40",
  "natural_evidence",
  "daily_ohlcv",
  "strategy2",
  "strategy3",
  "strategy4",
  "strategy5",
  "institution",
  "cb",
  "api",
  "desktop",
  "mobile",
  "scorecard",
  "source_reports",
  "canary",
  "runid_closure",
  "route_88",
  "watchdog",
  "auto_roll_forward",
  "control_plane",
  "recovery_queue",
]);
const STAGE_KEYS = new Set(STAGES.map((stage) => stage.key));
const FULL_MODULES = Object.freeze([
  ...STAGES.map((stage) => ({ ...stage, class: "gate", dueTime: "07:00", required: true, connected: true, receipt_required: true })),
  ...DOWNSTREAM_MODULES
    .filter((module) => !STAGE_KEYS.has(module.key))
    .map((module) => ({ ...module, required: REQUIRED_DOWNSTREAM_MODULE_KEYS.includes(module.key), connected: REQUIRED_DOWNSTREAM_MODULE_KEYS.includes(module.key), requirementState: REQUIRED_DOWNSTREAM_MODULE_KEYS.includes(module.key) ? "required" : "deferred", receipt_required: REQUIRED_DOWNSTREAM_MODULE_KEYS.includes(module.key) })),
]);

function moduleReceiptDir(auditRoot, tradeDate, dailyRunId) {
  return path.join(auditRoot, compactDate(tradeDate), String(dailyRunId), "module-receipts");
}

function moduleReceiptFile(auditRoot, tradeDate, dailyRunId, key) {
  return path.join(moduleReceiptDir(auditRoot, tradeDate, dailyRunId), `${String(key).replace(/[^a-zA-Z0-9_-]+/g, "-")}.json`);
}

function moduleSourceFile({ module, runtimeDir, auditRoot, tradeDate, dailyRunId }) {
  const relative = String(module.source || "").replace("{tradeDate}", compactDate(tradeDate));
  if (!relative) return "";
  if (relative.startsWith("outputs/terminal-final-audit/")) return path.join(auditRoot, compactDate(tradeDate), String(dailyRunId), relative.replace(/^outputs\/terminal-final-audit\/[0-9]{8}\//, ""));
  return path.join(runtimeDir, relative);
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const result = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { hour: Number(result.hour), minute: Number(result.minute) };
}

function isModuleDue(module, date = new Date()) {
  const [hour, minute] = String(module.dueTime || "00:00").split(":").map(Number);
  const now = taipeiParts(date);
  return now.hour * 60 + now.minute >= hour * 60 + minute;
}

function firstValue(source, paths) {
  for (const dotted of paths) {
    let value = source;
    for (const segment of dotted.split(".")) value = value?.[segment];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function compactTaipeiDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{8}$/.test(raw.replace(/\D/g, ""))) return compactDate(raw, "");
  if (/[tT].*(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed).replace(/\D/g, "");
    }
  }
  return compactDate(raw, "");
}

function sourceTradeDate(source) {
  const direct = firstValue(source, ["trade_date", "tradeDate", "marketDate", "source_trade_date", "expectedDate", "sourceSnapshot.trade_date", "sourceSnapshot.tradeDate"]);
  const fromDirect = compactTaipeiDate(direct);
  if (fromDirect) return fromDirect;
  const nested = firstValue(source, ["metrics.source_trade_date", "source_snapshot.source_status.0.trade_date", "source_snapshot.source_status.0.payload.source_trade_date", "source_snapshot.source_status.0.payload.trade_date"]);
  const fromNested = compactTaipeiDate(nested);
  if (fromNested) return fromNested;
  const fromRunId = String(firstValue(source, ["run_id", "runId", "daily_run_id", "processEvidence.runId"]) || "").match(/20\d{6}/)?.[0] || "";
  return fromRunId;
}

function sourceRunId(source) {
  return String(firstValue(source, ["run_id", "runId", "daily_run_id", "processEvidence.runId", "runQuality.runId"]) || "");
}

function sourceWarnings(source) {
  const value = firstValue(source, ["warnings", "diagnosticWarnings"]);
  return Array.isArray(value) ? value : [];
}

function sourceQuality(source) {
  return String(firstValue(source, ["qualityStatus", "quality_status", "evidenceStatus", "status"]) || "").toLowerCase();
}

function sourceHasCompletion(source) {
  return source?.complete === true || (source?.ok === true && ["complete", "ready", "ok", "pass", "yes"].includes(sourceQuality(source)));
}

function validateModule(module, source, tradeDate) {
  const issues = [];
  const expectedDate = compactDate(tradeDate, "");
  const actualDate = sourceTradeDate(source);
  const runId = sourceRunId(source);
  const warnings = sourceWarnings(source);
  const dateOptional = ["verification_command", "daily_ohlcv", "power_recovery", "contract_verification_command"].includes(module.adapter);
  if (actualDate && actualDate !== expectedDate) issues.push("module_receipt_stale_trade_date");
  else if (!actualDate && !dateOptional) issues.push("module_receipt_trade_date_missing");
  if (!["verification_command", "daily_ohlcv", "power_recovery", "contract_verification_command"].includes(module.adapter) && !runId) issues.push("module_receipt_run_id_missing");
  if (source?.status === "failed" || (source?.exitCode !== undefined && Number(source.exitCode) !== 0)) issues.push("module_receipt_failed_status");
  if (source?.complete !== true && module.adapter === "scan_receipt") issues.push("module_receipt_incomplete");
  if (source?.fallback === true || source?.fallbackUsed === true || source?.preservePreviousGood === true) issues.push("module_receipt_fallback_or_preserved");
  if (warnings.length) issues.push("module_receipt_warnings_present");
  if (source?.blockingReason || source?.blockedReason || source?.scanner_block_reason) issues.push("module_receipt_blocking_reason_present");
  if (module.adapter === "watchdog_source") {
    const offSessionPreviousGood = source?.metrics?.source_status === "stopped"
      && (source?.preserve_previous_good === true
        || source?.source_snapshot?.source_status?.some((row) => row?.payload?.off_session === true));
    if (offSessionPreviousGood) issues.push("source_warmup_off_session_previous_good");
    else {
      const prioritySymbols = Number(source?.priority_pool_symbols ?? source?.metrics?.priority_pool_symbols ?? source?.source_snapshot?.source_status?.[0]?.payload?.priority_symbols ?? 0);
      const priorityCoverage = Number(source?.priority_fresh_quote_coverage_120s ?? source?.metrics?.priority_fresh_quote_coverage_120s ?? source?.source_snapshot?.source_status?.[0]?.payload?.priority_fresh_quote_coverage_120s ?? 0);
      const quoteAge = Number(source?.quote_age_seconds ?? source?.metrics?.quote_age_seconds ?? source?.source_snapshot?.source_status?.[0]?.payload?.quote_age_seconds ?? 999999);
      const dailyReady = String(source?.daily_volume_status ?? source?.metrics?.daily_volume_status ?? source?.source_snapshot?.source_status?.[0]?.payload?.daily_volume_status ?? "").toLowerCase() === "ready";
      const collectorRunning = source?.processEvidence?.collectorRunning === true;
      const websocketReady = source?.metrics?.source_websocket_formal_ready === true
        || (source?.metrics?.source_websocket_connected === true && source?.metrics?.source_websocket_authenticated === true)
        || source?.source_snapshot?.source_status?.some((row) => row?.payload?.websocket_mode === "streaming" && row?.payload?.quote_transport === "websocket_trades_aggregates_candles");
      if (!collectorRunning || !websocketReady || prioritySymbols < 40 || priorityCoverage < 0.95 || quoteAge > 90 || !dailyReady) issues.push("source_warmup_not_ready");
    }
  } else if (module.adapter === "watchdog_universe") {
    if (!(Number(source?.today_1m_symbols) > 0) || Number(source?.intraday_1m_stale_seconds) > 120) issues.push("stock_universe_1m_not_ready");
  } else if (module.adapter === "watchdog_indicators") {
    if (!(Number(source?.ready_ma20) >= 40) || !(Number(source?.ready_ma35) >= 40) || source?.daily_volume_status !== "ready") issues.push("indicator_volume_not_ready");
  } else if (module.adapter === "watchdog_mother_pool") {
    const motherPoolSize = Number(source?.mother_pool_symbols ?? source?.processEvidence?.prioritySymbolsWritten ?? 0); if (!(motherPoolSize >= 300 && motherPoolSize <= 600)) issues.push("mother_pool_size_out_of_range");
    const motherPoolMinPrice = Number(source?.mother_pool_min_price ?? 50);
    const hotPoolSize = Number(source?.hot_pool_symbols ?? 0);
    if (!Number.isFinite(motherPoolMinPrice) || motherPoolMinPrice < 50) issues.push("mother_pool_price_floor_below_50");
    if (!(hotPoolSize >= 40 && hotPoolSize <= 80)) issues.push("hot_pool_size_out_of_range");
  } else if (module.adapter === "watchdog_top40") {
    if (Number(source?.priority_pool_symbols) !== 40 || Number(source?.priority_fresh_quote_coverage_120s) < 0.95) issues.push("top40_priority_pool_not_ready");
  } else if (module.adapter === "watchdog_natural_evidence") {
    const naturalMetrics = source?.metrics || source?.watchdog?.metrics || {};
    const currentWebsocketReady = naturalMetrics.source_websocket_formal_ready === true
      || (naturalMetrics.source_websocket_connected === true && naturalMetrics.source_websocket_authenticated === true)
      || source?.source_snapshot?.source_status?.some((row) => row?.payload?.websocket_formal_ready === true
        || (row?.payload?.websocket_connected === true && row?.payload?.websocket_authenticated === true));
    const currentDaytradeReady = String(naturalMetrics.source_status || source?.source_snapshot?.source_status?.[0]?.status || "").toLowerCase() === "ok"
      && String(naturalMetrics.source_daytrade_gate_grade || source?.source_snapshot?.source_status?.[0]?.payload?.daytrade_gate_grade || "").toUpperCase() === "A"
      && Number(naturalMetrics.priority_fresh_quote_coverage_120s ?? source?.source_snapshot?.source_status?.[0]?.payload?.priority_fresh_quote_coverage_120s ?? 0) >= 0.95
      && Number(naturalMetrics.quote_age_seconds ?? source?.source_snapshot?.source_status?.[0]?.payload?.quote_age_seconds ?? 999999) <= 90;
    const currentFormalReady = naturalMetrics.source_formal_entry_allowed === true
      || naturalMetrics.canonical_formal_entry_allowed === true
      || source?.source_snapshot?.source_status?.some((row) => row?.payload?.formal_entry_allowed === true);
    const recoveredAfterNaturalFailure = currentWebsocketReady && currentDaytradeReady && currentFormalReady;
    const missingNaturalEvidence = source?.manual_verification_only === true
      || !source
      || !source.checkpoints
      || (Array.isArray(source.missing_checkpoints) && source.missing_checkpoints.length)
      || source?.natural_schedule_evidence !== true;
    if (missingNaturalEvidence) issues.push("natural_evidence_missing");
    if (Array.isArray(source?.failures)) {
      const joined = source.failures.join(" ").toLowerCase();
      if (recoveredAfterNaturalFailure) issues.push("natural_warmup_recovered_after_failed_checkpoint");
      if (!currentWebsocketReady && (joined.includes("websocket_formal_ready") || joined.includes("websocket_status_fresh_seconds"))) issues.push("natural_warmup_websocket_not_ready");
      if (!currentDaytradeReady && (joined.includes("source_status_ready") || joined.includes("source_payload_fresh") || joined.includes("source_daytrade_gate_grade") || joined.includes("source_formal_entry_allowed"))) issues.push("natural_warmup_daytrade_source_not_ready");
      if (!currentFormalReady && (joined.includes("canonical_gate_grade") || joined.includes("canonical_gate_status") || joined.includes("canonical_formal_entry_speed_verdict") || joined.includes("canonical_formal_entry_allowed"))) issues.push("natural_warmup_canonical_gate_not_ready");
      if (joined.includes("futopt_") || joined.includes("txf")) issues.push("natural_warmup_futopt_txf_not_ready");
      if (!currentFormalReady && joined.includes("scanner_can_run_opening_false")) issues.push("natural_warmup_scanner_opening_false");
      if (!currentFormalReady && (joined.includes("formal_entry_speed_verdict_not_yes") || joined.includes("formal_verdict_no"))) issues.push("natural_warmup_formal_verdict_no");
      if (!currentDaytradeReady && joined.includes("gate_not_a")) issues.push("natural_warmup_gate_not_a");
    }
    if (!missingNaturalEvidence && (source?.natural_warmup_ok !== true || source?.formal_warmup_pass !== true)) issues.push("natural_warmup_checkpoint_failed");
  } else if (module.adapter === "watchdog") {
    if (source?.ok !== true || source?.unattended_yes !== true || (Array.isArray(source?.failed_checks) && source.failed_checks.length)) issues.push("watchdog_not_healthy");
  } else if (["daily_ohlcv", "verification_command"].includes(module.adapter)) {
    if (source?.ok !== true || source?.publishAllowed !== true || !Array.isArray(source?.failures) || source.failures.length || Number(source?.recentTradingDaysChecked) < Number(source?.requiredTradingDays || 20) || Number(source?.latestValidOhlcSymbols) < Number(source?.requiredMinValidSymbols)) issues.push("daily_ohlcv_completeness_not_ready");
  } else if (module.adapter === "power_recovery") {
    if (source?.ok !== true || source?.power_checked !== true || source?.taskRegistered !== true || source?.startWhenAvailableReady !== true || source?.postBootRecoveryVerified !== true || source?.lockSafe !== true || source?.staleLockHandled !== true) issues.push("power_recovery_not_ready");
  } else if (module.adapter === "contract_verification_command") {
    if (source?.ok !== true || Number(source?.verifier_exit_code ?? 1) !== 0) issues.push("verifier_contract_not_ready");
  } else if (module.adapter === "orchestrator_state") {
    if (source?.ok !== true || source?.unattended_status === "NO") issues.push("recovery_queue_not_healthy");
  } else if (module.adapter === "resource_chain") {
    const rows = Array.isArray(source?.results) ? source.results.filter((row) => row?.key && row.key !== "market") : [];
    if (source?.ok !== true || rows.length === 0) issues.push("resource_chain_not_ready");
    const resourceKey = String(module.resourceKey || "");
    if (resourceKey === "terminalApi" && rows.some((row) => row?.terminalApi?.ok !== true || Number(row.terminalApi?.status || 0) >= 400 || !row.terminalApi?.runId)) issues.push("api_readback_not_ready");
    if (resourceKey === "desktopSnapshot" && rows.some((row) => row?.desktopSnapshot?.ok !== true || !row.desktopSnapshot?.runId)) issues.push("desktop_snapshot_not_ready");
    if (resourceKey === "mobileFragment" && rows.some((row) => !row?.mobileFragment || row.mobileFragment.empty === true || !row.mobileFragment.runId)) issues.push("mobile_fragment_not_ready");
    if (resourceKey === "scorecard" && rows.some((row) => row?.scorecard?.status !== 200 || row.scorecard?.ok !== true || !row.scorecard?.runId)) issues.push("scorecard_not_ready");
    if (resourceKey === "chain" && rows.some((row) => row?.ok !== true)) issues.push("source_reports_not_ready");
  } else if (module.adapter === "generic_runtime" && !sourceHasCompletion(source)) {
    issues.push("module_receipt_incomplete");
  }
  if (module.adapter === "scan_receipt" && source?.exitCode !== 0) issues.push("module_receipt_nonzero_exit");
  const issueAllowedActions = {
    source_warmup_off_session_previous_good: "wait_until_next_source_window_then_rerun_warmup",
    natural_evidence_missing: "inspect_warmup_task_history_then_record_missing_natural_evidence",
    natural_warmup_websocket_not_ready: "restart_fugle_websocket_source_then_run_rewater_verification",
    natural_warmup_daytrade_source_not_ready: "restart_daytrade_source_writer_then_run_rewater_verification",
    natural_warmup_canonical_gate_not_ready: "refresh_daytrade_canonical_gate_then_run_rewater_verification",
    natural_warmup_futopt_txf_not_ready: "restart_futopt_websocket_and_refresh_contract_health_then_reverify",
    natural_warmup_gate_not_a: "reconnect_daytrade_source_then_run_rewater_verification",
    natural_warmup_scanner_opening_false: "start_daytrade_writer_and_rebuild_priority_pool_then_rewater_verify",
    natural_warmup_formal_verdict_no: "rerun_formal_entry_gate_after_rewater_verification",
    natural_warmup_checkpoint_failed: "wait_for_natural_checkpoint_or_record_blocked_recovery_evidence",
    natural_warmup_recovered_after_failed_checkpoint: "run_rewater_verification_then_roll_forward_without_counting_natural_unattended_yes",
  };
  const allowedAction = issues.length ? (issueAllowedActions[issues[0]] || module.allowedAction) : "none";
  return { ok: issues.length === 0, issues, actualDate, runId, warnings, allowedAction };
}

function summarizeSource(source) {
  if (!source || typeof source !== "object") return source || null;
  const keys = ["ok", "status", "complete", "exitCode", "qualityStatus", "fallback", "fallbackUsed", "blockingReason", "blockedReason", "scanner_block_reason", "trade_date", "tradeDate", "marketDate", "latestTradeDate", "expectedDate", "daily_run_id", "runId", "run_id", "latestValidOhlcSymbols", "requiredMinValidSymbols", "publishAllowed", "recentTradingDaysChecked", "requiredTradingDays", "failures", "warnings", "unattended_yes", "natural_schedule_evidence", "natural_warmup_ok", "formal_warmup_pass", "missing_checkpoints", "checkpoint_files", "checkpoints", "failures", "watchdog", "today_1m_symbols", "ready_ma20", "ready_ma35", "daily_volume_status", "priority_pool_symbols", "priority_fresh_quote_coverage_120s", "mother_pool_min_price", "mother_pool_price_floor_rejected_count", "hot_pool_symbols", "hot_pool_min_symbols", "hot_pool_max_symbols", "metrics", "processEvidence", "power_checked", "taskRegistered", "startWhenAvailableReady", "postBootRecoveryVerified", "lockSafe", "staleLockHandled", "systemBootAt", "unexpectedShutdownEvent", "recoveryActions", "task", "registration_receipt_file", "registration_receipt", "registrationReceiptAuthoritative", "registrationReceiptIgnoredReason", "sourceCoverage", "source_snapshot"];
  const result = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  if (source.resource_key !== undefined) result.resource_key = source.resource_key;
  if (Array.isArray(source.results)) {
    result.results = source.results.map((row) => ({
      key: row?.key || "",
      ok: row?.ok === true,
      liveRunId: row?.liveRunId || "",
      terminalRunId: row?.terminalRunId || "",
      desktopRunId: row?.desktopRunId || "",
      mobileRunId: row?.mobileRunId || "",
      scorecardRunId: row?.scorecardRunId || "",
      terminalApi: row?.terminalApi ? { ok: row.terminalApi.ok === true, status: Number(row.terminalApi.status || 0), runId: row.terminalApi.runId || "" } : undefined,
      desktopSnapshot: row?.desktopSnapshot ? { ok: row.desktopSnapshot.ok === true, runId: row.desktopSnapshot.runId || "" } : undefined,
      mobileFragment: row?.mobileFragment ? { empty: row.mobileFragment.empty === true, runId: row.mobileFragment.runId || "" } : undefined,
      scorecard: row?.scorecard ? { ok: row.scorecard.ok === true, status: Number(row.scorecard.status || 0), runId: row.scorecard.runId || "" } : undefined,
    }));
  }
  return result;
}

function normalizeModuleReceipt({ module, source, sourceFile, tradeDate, dailyRunId, now = new Date(), commandResult = null }) {
  const due = isModuleDue(module, now);
  const checkedAt = now.toISOString();
  const common = { contract: "terminal-module-receipt-v1", module: module.key, label: module.label, daily_run_id: dailyRunId, trade_date: compactDate(tradeDate), source_file: sourceFile, source_present: Boolean(source), source_run_id: sourceRunId(source), source_trade_date: sourceTradeDate(source), checked_at: checkedAt, command_result: commandResult };
  if (!due) return { ...common, status: "NOT_DUE", complete: false, receipt_present: true, exit_code: 0, reason_code: "module_not_due", allowed_action: `wait_until_${module.dueTime}_then_collect_receipt`, evidence: summarizeSource(source) };
  if (!source) return { ...common, status: "MISSING", complete: false, receipt_present: false, exit_code: 1, reason_code: "module_receipt_missing", allowed_action: module.allowedAction, evidence: null };
  const validation = validateModule(module, source, tradeDate);
  const offSessionPreviousGoodOnly = module.adapter === "watchdog_source"
    && validation.issues.length === 1
    && validation.issues[0] === "source_warmup_off_session_previous_good";
  if (offSessionPreviousGoodOnly) {
    return { ...common, status: "SKIPPED", complete: true, receipt_present: true, exit_code: 0, reason_code: "source_warmup_off_session_previous_good", allowed_action: "preserve_previous_good_and_continue_off_session_closure", issues: validation.issues, evidence: summarizeSource(source) };
  }
  return { ...common, status: validation.ok ? "PASS" : "BLOCKED", complete: validation.ok, receipt_present: true, exit_code: validation.ok ? 0 : 1, reason_code: validation.ok ? "ok" : validation.issues[0], allowed_action: validation.ok ? "none" : validation.allowedAction, issues: validation.issues, evidence: summarizeSource(source) };
}

module.exports = { DOWNSTREAM_MODULES, REQUIRED_DOWNSTREAM_MODULE_KEYS, FULL_MODULES, moduleReceiptDir, moduleReceiptFile, moduleSourceFile, isModuleDue, sourceTradeDate, sourceRunId, normalizeModuleReceipt, validateModule, summarizeSource };





















