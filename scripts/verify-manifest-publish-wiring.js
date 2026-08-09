"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function assert(condition, issue, details = {}) {
  if (!condition) issues.push({ issue, details });
}

function indexOfAll(text, needles) {
  return Object.fromEntries(needles.map((needle) => [needle, text.indexOf(needle)]));
}

function assertOrdered(text, orderedNeedles, label) {
  const positions = indexOfAll(text, orderedNeedles);
  for (const needle of orderedNeedles) {
    assert(positions[needle] >= 0, `${label}_missing:${needle}`, positions);
  }
  for (let index = 1; index < orderedNeedles.length; index += 1) {
    const prev = orderedNeedles[index - 1];
    const next = orderedNeedles[index];
    assert(
      positions[prev] >= 0 && positions[next] >= 0 && positions[prev] < positions[next],
      `${label}_wrong_order:${prev}->${next}`,
      positions,
    );
  }
}

const pkg = readJson("package.json");
const scripts = pkg.scripts || {};
const scorecardPublish = String(scripts["scorecard:publish"] || "");
const unattendedRoot = String(scripts["verify:terminal-unattended-root"] || "");
const scorecardSync = String(scripts["scorecard:sync"] || "");
const scorecardSyncWrapped = String(scripts["scorecard:sync:wrapped"] || "");
const dailyRunner = read("run-scorecard-daily-automation.ps1");
const manifestWriter = read("scripts/write-daily-terminal-run-manifest.js");
const manifestGuard = read("scripts/guard-daily-manifest-before-scorecard-publish.js");
const opsStatus = read("lib/terminal-ops-status.js");
const terminalFastBundle = read("api/terminal-fast-bundle.js");
const mobileFragment = read("api/mobile-fragment.js");
const desktopShell = read("terminal-desktop-fast-shell.js");
const scorecardApi = read("api/scorecard.js");
const scorecardSourceGenerator = read("scripts/generate-terminal-scorecard-source.js");
const wrapper = read("run-scorecard-daily-automation-wrapper.ps1");
const rollForward = read("scripts/run-terminal-auto-roll-forward.js");
const orchestrator = read("scripts/write-terminal-orchestrator-state.js");

assertOrdered(scorecardPublish, [
  "verify-terminal-canary-publish.js",
  "guard-daily-manifest-before-scorecard-publish.js",
  "scorecard:publish:raw",
], "package_scorecard_publish");

assert(scorecardSync.includes("run-scorecard-daily-automation.ps1"), "scorecard_sync_not_using_daily_runner", { scorecardSync });
assert(scorecardSyncWrapped.includes("run-scorecard-daily-automation-wrapper.ps1"), "scorecard_sync_wrapped_not_using_wrapper", { scorecardSyncWrapped });
assert(wrapper.includes("run-scorecard-daily-automation.ps1"), "scorecard_wrapper_not_calling_daily_runner");

assertOrdered(dailyRunner, [
  "scripts\\write-daily-terminal-run-manifest.js",
  "scripts\\verify-terminal-canary-publish.js",
  "scripts\\guard-daily-manifest-before-scorecard-publish.js",
  "scripts\\publish-scorecard-snapshot.js",
], "daily_scorecard_runner_publish_gate");

assert(dailyRunner.includes("--scorecard=$snapshotFile"), "daily_runner_canary_not_using_candidate_snapshot");
assert(dailyRunner.includes("--scorecard-candidate-file=$snapshotFile"), "daily_runner_manifest_missing_scorecard_candidate_file");
assert(!dailyRunner.includes("$manifestArgs += \"--require-formal-now\""), "daily_runner_manifest_must_not_use_live_formal_gate_for_scorecard_publish");
assert(dailyRunner.includes("--allow-degraded"), "daily_runner_guard_missing_closed_day_degraded_allowance");
assert(manifestWriter.includes("todayAuthoritative"), "manifest_writer_missing_today_authoritative_gate");
assert(manifestWriter.includes("formalDisplayAllowed"), "manifest_writer_missing_formal_display_allowed_gate");
assert(manifestWriter.includes("displayMode"), "manifest_writer_missing_display_mode_gate");
assert(manifestWriter.includes("formal_display_blocked"), "manifest_writer_missing_formal_display_blocked_issue");
assert(manifestWriter.includes("const pendingNotDue = marketClosed ? false"), "manifest_writer_market_closed_must_override_pending_not_due");
assert(manifestWriter.includes("!pendingNotDue && !marketClosed && tradeDate !== EXPECTED_DATE"), "manifest_writer_market_closed_must_not_fail_trade_date_mismatch");
assert(manifestWriter.includes("MARKET_CLOSED_PREVIOUS_GOOD_HOLD"), "manifest_writer_missing_market_closed_previous_good_status");
assert(manifestWriter.includes("market_closed_previous_good_hold"), "manifest_writer_missing_market_closed_previous_good_issue");
assert(manifestGuard.includes("moduleFormalDisplayGreen"), "manifest_guard_missing_module_formal_display_green");
assert(manifestGuard.includes("row.todayAuthoritative === true"), "manifest_guard_not_requiring_today_authoritative");
assert(manifestGuard.includes("row.formalDisplayAllowed === true"), "manifest_guard_not_requiring_formal_display_allowed");
assert(manifestGuard.includes("row.fallback !== true"), "manifest_guard_not_blocking_fallback_true");
assert(opsStatus.includes("todayAuthoritative"), "ops_status_missing_today_authoritative");
assert(opsStatus.includes("formalDisplayAllowed"), "ops_status_missing_formal_display_allowed");
assert(opsStatus.includes("displayMode"), "ops_status_missing_display_mode");
assert(opsStatus.includes("displayBlockReason"), "ops_status_missing_display_block_reason");
assert(terminalFastBundle.includes("buildLatestOpsStatus"), "fast_bundle_missing_ops_status_import");
assert(terminalFastBundle.includes("buildOpsAuthorityIndex"), "fast_bundle_missing_ops_authority_index");
assert(terminalFastBundle.includes("attachOpsAuthorityToEndpoints"), "fast_bundle_missing_endpoint_authority_attachment");
assert(terminalFastBundle.includes("terminalAuthority: opsAuthority"), "fast_bundle_missing_payload_terminal_authority");
assert(terminalFastBundle.includes("payload.terminalAuthority"), "fast_bundle_summary_missing_terminal_authority");
assert(terminalFastBundle.includes("payload.todayAuthoritative"), "fast_bundle_summary_missing_today_authoritative");
assert(terminalFastBundle.includes("payload.formalDisplayAllowed"), "fast_bundle_summary_missing_formal_display_allowed");
assert(mobileFragment.includes("buildLatestOpsStatus"), "mobile_fragment_missing_ops_status_import");
assert(mobileFragment.includes("terminalAuthorityForTab"), "mobile_fragment_missing_terminal_authority_for_tab");
assert(mobileFragment.includes("data-formal-display-allowed"), "mobile_fragment_missing_formal_display_allowed_dom");
assert(mobileFragment.includes("formalDisplayAllowed"), "mobile_fragment_missing_formal_display_allowed_payload");
assert(desktopShell.includes("displayAuthorityMeta"), "desktop_shell_missing_display_authority_meta");
assert(desktopShell.includes("formalDisplayBlocked"), "desktop_shell_missing_formal_display_blocked");
assert(desktopShell.includes("formalDisplayBlockHtml"), "desktop_shell_missing_formal_display_block_html");
assert(desktopShell.includes("data-formal-display-allowed"), "desktop_shell_missing_formal_display_allowed_dom");
assert(desktopShell.includes("terminalAuthority"), "desktop_shell_missing_terminal_authority_meta");
assert(desktopShell.includes("displayBlockReason"), "desktop_shell_missing_display_block_reason");
assert(scorecardApi.includes("sourceReportsCoverDate"), "scorecard_api_missing_source_reports_date_cover_gate");
assert(scorecardApi.includes("normalizeSourceReportForSelectedDate"), "scorecard_api_missing_source_report_selected_date_normalizer");
assert(scorecardApi.includes("source_report_date_mismatch"), "scorecard_api_missing_source_report_date_mismatch_blocker");
assert(scorecardApi.includes("desktop_route_snapshot_source_reports_stale_ignored"), "scorecard_api_missing_stale_desktop_source_report_guard");
assert(scorecardApi.includes("normalizePayloadSourceReportsForDate"), "scorecard_api_missing_final_source_report_normalization");
assert(scorecardSourceGenerator.includes("includeInScorecard(row, expectedDate"), "scorecard_source_generator_missing_record_date_gate");
assert(scorecardSourceGenerator.includes("rowDate !== expectedDate"), "scorecard_source_generator_not_blocking_old_record_dates");
assert(scorecardSourceGenerator.includes("includeInScorecard(row, latestDate)"), "scorecard_source_generator_not_passing_latest_date_to_record_gate");
assert(scorecardSourceGenerator.includes("source_report_date_mismatch"), "scorecard_source_generator_missing_source_report_date_mismatch_blocker");
assert(scorecardSourceGenerator.includes("preservePreviousGood: true"), "scorecard_source_generator_missing_previous_good_marker_for_stale_reports");
assert(rollForward.includes('npmRun("scorecard:publish")'), "roll_forward_publish_not_using_manifest_gated_script");
assert(orchestrator.includes("npm run manifest:daily-terminal-run && npm run scorecard:publish"), "orchestrator_publish_repair_not_manifest_then_publish");
assert(unattendedRoot.includes("verify:manifest-publish-wiring"), "unattended_root_missing_manifest_publish_wiring_gate", { unattendedRoot });
assertOrdered(unattendedRoot, [
  "policy:autonomous-ops",
  "rollforward:terminal",
  "verify:terminal-canary-publish:live",
], "unattended_root_rollforward_plan");

const payload = {
  ok: issues.length === 0,
  contract: "manifest-publish-wiring-v1",
  checkedAt: new Date().toISOString(),
  gates: {
    packageScorecardPublish: "canary -> manifest guard -> raw publish",
    dailyScorecardRunner: "manifest refresh -> canary(candidate snapshot) -> manifest guard -> raw publish",
    rollForward: "npm run scorecard:publish",
    orchestratorRepair: "manifest then scorecard:publish",
  },
  issues,
};

console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exit(1);
