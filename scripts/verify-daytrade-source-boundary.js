"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const checks = [];
function read(relative) {
  const file = path.join(ROOT, relative);
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}
function check(ok, code, evidence = {}) { checks.push({ ok: Boolean(ok), code, evidence }); }

const formalAdapter = read("scripts/check-strategy2-supabase-coverage.js");
const sharedDiagnostic = read("scripts/check-strategy2-shared-source-diagnostic.js");
const sharedLegacy = read("scripts/check-strategy2-shared-source-diagnostic-legacy.js");
const publishGate = read("scripts/check-publish-source-gate.js");
const strategy3Api = read("api/strategy3-latest.js");
const strategy3V2Api = read("api/strategy3-v2-latest.js");
const strategy3V2Contract = read("scripts/strategy3-v2-contract.js");
const alignment = read("scripts/verify-daytrade-source-contract-alignment.js");
const scannerHealth = read("scripts/check-scanner-resource-health.js");
const strategy3Scanner = read("scripts/run-strategy3-v2-complete-scan.js");
const acceptanceVerifier = read("scripts/verify-daytrade-source-acceptance.js");
const map = JSON.parse(read("data/contracts/source-layer-strategy-map.json") || "{}");
const registry = JSON.parse(read("scripts/terminal-active-module-registry.json") || "{}");
const byKey = new Map((map.strategies || []).map((item) => [String(item.key || "").toLowerCase(), item]));
const active = new Set((registry.active || []).map((item) => String(item.key || "").toLowerCase()));
const retired = new Set((registry.retired || []).map((item) => String(item.key || "").toLowerCase()));

check(Boolean(formalAdapter), "formal_adapter_present");
check(formalAdapter.includes("formal_authority_dedicated_daytrade"), "formal_adapter_declares_dedicated_authority");
check(!formalAdapter.includes("fugle_shared_source"), "formal_adapter_has_no_shared_source_reference");
check(formalAdapter.includes("verify-daytrade-source-contract-alignment.js"), "formal_adapter_calls_dedicated_alignment_verifier");
check(Boolean(sharedDiagnostic), "shared_diagnostic_wrapper_present");
check(sharedDiagnostic.includes("diagnostic_only_shared_source"), "shared_diagnostic_wrapper_declares_diagnostic_role");
check(sharedDiagnostic.includes("formalEntryAuthority: false") && sharedDiagnostic.includes("unattendedAuthority: false"), "shared_diagnostic_wrapper_cannot_authorize");
check(Boolean(sharedLegacy), "shared_diagnostic_legacy_preserved");
check(sharedLegacy.includes("fugle_shared_source"), "shared_diagnostic_legacy_reads_shared_source");
check(!publishGate.includes("fugle_shared_source"), "publish_gate_has_no_shared_source_reference");
check(publishGate.includes("check-strategy2-supabase-coverage.js"), "publish_gate_uses_dedicated_adapter_name");
check(Boolean(strategy3Api), "strategy3_api_present");
check(strategy3Api.includes("strategy3-v2-latest.js"), "strategy3_api_uses_v2_dedicated_source");
check(!strategy3Api.includes("fugle_shared_source"), "strategy3_api_has_no_shared_source_reference");
check(!fs.existsSync(path.join(ROOT, "api/strategy3-latest.shared-probe-legacy.js")), "strategy3_legacy_handler_removed");
check(strategy3Api.includes("strategy3-v2-latest.js"), "strategy3_api_routes_v2_only");
check(strategy3V2Api.includes("strategy3_v2") && strategy3V2Contract.includes("strategy3-v2-clean-chain"), "strategy3_v2_contract_present");
check(alignment.includes("fugle_daytrade_source"), "alignment_verifier_uses_dedicated_source");
check(scannerHealth.includes('fetchSourceStatusPayload(sourceName = "fugle_daytrade_source")'), "scanner_resource_health_defaults_to_dedicated_source");
check(strategy3Scanner.includes("local_fugle_daytrade_ws_candles+local_fugle_daytrade_ws_quotes"), "strategy3_v2_scanner_reads_dedicated_local_water");
check(!strategy3Scanner.includes("fugle_shared_source"), "strategy3_v2_scanner_has_no_shared_source_reference");
check(acceptanceVerifier.includes("formalPass: failures.length === 0"), "acceptance_formal_decision_is_failure_based");
check(acceptanceVerifier.includes("sourceMismatchWarning ? [sourceMismatchWarning] : []"), "acceptance_shared_source_is_warning_only");
check(acceptanceVerifier.includes('role: "diagnostic_only"'), "acceptance_shared_source_declares_diagnostic_role");
check(acceptanceVerifier.includes("formalEntryAuthority: false") && acceptanceVerifier.includes("unattendedAuthority: false"), "acceptance_shared_source_authority_flags_false");
check(acceptanceVerifier.includes('role: "formal_authority"') && acceptanceVerifier.includes('sourceName: "fugle_daytrade_source"'), "acceptance_daytrade_source_declares_formal_authority");
for (const key of ["strategy2", "strategy3", "seven-strategies"]) {
  const entry = byKey.get(key);
  check(Boolean(entry), `map_${key}_present`, { key });
  check(entry?.formalSource === "fugle_daytrade_source", `map_${key}_formal_source_dedicated`, { formalSource: entry?.formalSource || "" });
}
for (const key of ["strategy1", "realtime-radar", "heatmap"]) {
  check(retired.has(key) && !active.has(key), `retired_${key}_excluded_from_active_registry`, { key });
}

const result = {
  ok: checks.every((item) => item.ok),
  contract: "daytrade-source-boundary-v1",
  checkedAt: new Date().toISOString(),
  formalSource: "fugle_daytrade_source",
  sharedSourcePolicy: "diagnostic_only",
  checks,
  issues: checks.filter((item) => !item.ok),
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
