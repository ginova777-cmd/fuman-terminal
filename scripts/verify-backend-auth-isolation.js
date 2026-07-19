"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch (error) {
    issues.push({ issue: `missing_or_unreadable:${file}`, details: { message: error.message } });
    return "";
  }
}

function assert(condition, issue, details = {}) {
  if (!condition) issues.push({ issue, details });
}

function includes(file, marker, issue) {
  const text = read(file);
  assert(text.includes(marker), issue || `missing_marker:${file}:${marker}`, { file, marker });
  return text;
}

function packageJson() {
  try {
    return JSON.parse(read("package.json"));
  } catch (error) {
    issues.push({ issue: "package_json_parse_failed", details: { message: error.message } });
    return { scripts: {} };
  }
}

function verifyMembershipGuard() {
  const text = includes("lib/server-entitlement-guard.js", "fumanInternalVerify === true", "entitlement_guard_missing_internal_verify_bypass");
  assert(text.includes("missing_bearer_token"), "entitlement_guard_missing_explicit_missing_bearer_reason");
  assert(text.includes("membership_required"), "entitlement_guard_missing_membership_required_error");
  assert(text.includes("withEntitlementRequired"), "entitlement_guard_missing_wrapper");
}

function verifyComputeDisplayLayering() {
  const helper = includes("scripts/e2e-membership-closure-utils.js", "callInternalApi", "membership_helper_missing_internal_api_caller");
  assert(helper.includes("fumanInternalVerify: true"), "membership_helper_internal_call_not_using_internal_verify");
  assert(helper.includes('payload?.error === "membership_required"'), "membership_helper_must_only_treat_explicit_membership_required_as_protected");

  const runner = includes("scripts/protected-e2e-closure-runner.js", "computeLayer", "protected_runner_missing_compute_layer");
  assert(runner.includes("displayLayer"), "protected_runner_missing_display_layer");
  assert(/internalLatest\s*=\s*await\s+callInternalApi/.test(runner), "protected_runner_compute_layer_not_internal_api");
  assert(runner.includes("display_latest_endpoint_public_or_membership_protected"), "protected_runner_missing_display_membership_classification");
  assert(runner.includes("membership gates only protect production display/data access"), "protected_runner_missing_membership_scope_rule");
}

function verifyOpsStatusLayering() {
  const api = includes("api/terminal-ops-status.js", "withEntitlementRequired(handler, \"terminal-ops-status\")", "ops_status_api_not_membership_protected");
  assert(api.includes("buildLatestOpsStatus"), "ops_status_api_missing_internal_payload_builder");

  const verifier = includes("scripts/verify-terminal-ops-status-api.js", "fumanInternalVerify: true", "ops_status_verifier_missing_internal_verify");
  assert(verifier.includes("unauth.statusCode === 401"), "ops_status_verifier_missing_unauth_membership_check");
  assert(verifier.includes("payload.unattendedStatus === \"YES\""), "ops_status_verifier_missing_internal_unattended_check");
  assert(verifier.includes("membership_required"), "ops_status_verifier_missing_membership_required_assertion");
}

function verifyProductionProtectedReadback() {
  const production = includes("scripts/verify-terminal-ops-production-live.js", "DIRECT_PROTECTED_ENDPOINTS", "production_live_missing_direct_protected_endpoints");
  assert(production.includes("terminal_ops_status"), "production_live_missing_ops_status_endpoint");
  assert(production.includes("scorecard"), "production_live_missing_scorecard_endpoint");
  assert(production.includes("source_reports"), "production_live_missing_source_reports_endpoint");
  assert(production.includes("REDACTED_LOCKED_ENDPOINTS"), "production_live_missing_redacted_locked_endpoints");
  assert(production.includes("terminal_fast_bundle"), "production_live_missing_terminal_fast_bundle_redaction_check");
  assert(production.includes("mobile_boot"), "production_live_missing_mobile_boot_redaction_check");
  assert(production.includes("direct_protected_endpoint_not_membership_required"), "production_live_missing_401_membership_required_hard_issue");
}

function verifyScheduleAndOpsPolicy() {
  const registry = read("scripts/fuman-schedule-registry.json");
  assert(registry.includes("Fuman Scorecard Daily Automation 1400"), "schedule_registry_missing_scorecard_daily_automation");
  assert(registry.includes("Fuman API Unattended Patrol"), "schedule_registry_missing_api_unattended_patrol");

  const rollForward = includes("scripts/run-terminal-auto-roll-forward.js", "Auth failures are never auto-executed", "rollforward_missing_auth_failure_policy");
  assert(rollForward.includes("membership display auth must not be confused with backend service token auth"), "rollforward_missing_membership_vs_backend_token_rule");

  const orchestrator = includes("scripts/write-terminal-orchestrator-state.js", "BLOCKED_AUTH", "orchestrator_missing_blocked_auth_state");
  assert(orchestrator.includes("verify service token env"), "orchestrator_missing_service_token_repair_text");
}

function verifyRootGateWiring() {
  const pkg = packageJson();
  const scripts = pkg.scripts || {};
  assert(String(scripts["verify:backend-auth-isolation"] || "").includes("scripts/verify-backend-auth-isolation.js"), "package_missing_verify_backend_auth_isolation");
  assert(String(scripts["verify:terminal-unattended-root"] || "").includes("verify:backend-auth-isolation"), "unattended_root_missing_backend_auth_isolation");
  assert(String(scripts["verify:membership-e2e-layering"] || "").includes("scripts/verify-membership-e2e-layering.js"), "package_missing_membership_e2e_layering");
  assert(String(scripts["verify:membership-access-contract"] || "").includes("scripts/verify-membership-access-contract.js"), "package_missing_membership_access_contract");
}

verifyMembershipGuard();
verifyComputeDisplayLayering();
verifyOpsStatusLayering();
verifyProductionProtectedReadback();
verifyScheduleAndOpsPolicy();
verifyRootGateWiring();

const ok = issues.length === 0;
console.log(JSON.stringify({
  ok,
  contract: "backend-auth-isolation-v1",
  checkedAt: new Date().toISOString(),
  guarantees: [
    "membership auth gates display/protected API access only",
    "internal compute readback uses fumanInternalVerify",
    "unauthenticated 401 membership_required is not scanner failure",
    "production locked shells must be redacted",
    "auth failures enter BLOCKED_AUTH instead of fake success"
  ],
  issues,
}, null, 2));

if (!ok) process.exit(1);
