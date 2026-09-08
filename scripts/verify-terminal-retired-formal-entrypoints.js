const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function add(ok, code, detail = "") {
  checks.push({ ok, code, detail });
}

const retiredDaytradeEntrypoints = [
  "FugleDayTradeScanner.ps1",
  "Watch-FugleSupabaseCoverage.ps1",
];

const retiredVerifierEntrypoints = [
  "run-strategy2-battle-verify.ps1",
  "scripts/verify-strategy2-battle-state.js",
  "run-strategy3-battle-verify.ps1",
  "scripts/verify-strategy3-battle-state.js",
  "scripts/verify-strategy3-alert-path.js",
  "install-strategy3-battle-tasks.ps1",
  "run-daily-battle-verify.ps1",
  "scripts/verify-daily-battle-readiness.js",
  "install-battle-verify-tasks.ps1",
  "package.json.pre-no-fake-root-chain-20260809.bak",
  "scripts/verify-terminal-no-fake-unattended.js.bak-20260809-readiness",
  "scripts/verify-terminal-recovery-queue.js.pre-deferred-receipt-hardgate-20260809.bak",
];
for (const retired of retiredVerifierEntrypoints) {
  add(!fs.existsSync(path.join(root, retired)), "legacy_verifier_entrypoint_absent", retired);
}
for (const activeContractFile of [
  "AGENTS.md",
  "package.json",
  "scripts/verify-active-strategy-root-authority.js",
  "scripts/verify-api-unattended-scorecard.js",
  "scripts/verify-fugle-source-contract.js",
  "scripts/verify-supabase-conservative-recovery.js",
]) {
  const source = read(activeContractFile);
  for (const retired of retiredVerifierEntrypoints) {
    add(!source.includes(path.basename(retired)), "legacy_verifier_reference_absent", `${activeContractFile}:${retired}`);
  }
}
for (const retired of retiredDaytradeEntrypoints) {
  add(!fs.existsSync(path.join(root, retired)), "legacy_daytrade_entrypoint_absent", retired);
  add(!fs.existsSync(path.join(root, "scripts", retired)), "legacy_daytrade_script_absent", retired);
}
for (const activeContractFile of [
  "package.json",
  "run-terminal-master-control.ps1",
  "scripts/fuman-schedule-registry.json",
  "scripts/sync-main-deploy-source.js",
]) {
  const source = read(activeContractFile);
  for (const retired of retiredDaytradeEntrypoints) {
    add(!source.includes(retired), "legacy_daytrade_reference_absent", `${activeContractFile}:${retired}`);
  }
}

const scorecardPage = read("88.html");
add(!/keyOrder\s*=\s*\[[^\]]*(strategy1|realtime-radar)/i.test(scorecardPage), "scorecard_key_order_retired_removed");
add(!/normalized\.includes\("策略1"\)/.test(scorecardPage), "scorecard_strategy1_alias_removed");
const marketClosedReadback = read("scripts/verify-market-closed-terminal-readback.js");
for (const endpoint of ["open-buy-latest", "cb-detect-latest", "warrant-flow-latest", "realtime-radar-latest"]) {
  add(!new RegExp(`\\[\\"[^\\"]+\\", \\"/api/${endpoint}`).test(marketClosedReadback), `market_closed_active_probe_retired_${endpoint}`);
}

add(marketClosedReadback.includes('result.payload?.marketStatus === "membership_locked"'), "market_closed_mobile_membership_lock_accepted");
const strategy3Latest = read(path.join("api", "strategy3-latest.js"));
add(strategy3Latest.includes("buildMarketCalendarContract") && strategy3Latest.includes("installMarketCalendarResponse"), "strategy3_v2_market_calendar_contract_installed");
add(strategy3Latest.includes('withEntitlementRequired(strategy3LatestWithEvidence, "strategy3")'), "strategy3_v2_membership_guard_installed");
const membershipVerifier = read(path.join("scripts", "verify-membership-access-contract.js"));
for (const endpoint of ["cb-detect-latest", "warrant-flow-latest"]) {
  const protectedPathEntry = `"/api/${endpoint}?live=1"`;
  add(!membershipVerifier.includes(protectedPathEntry), `membership_active_probe_retired_${endpoint}`);
}
const syncSource = read(path.join("scripts", "sync-main-deploy-source.js"));
for (const retired of [
  "api/open-buy-latest.js",
  "scripts/scan-open-buy-cache.js",
  "run-open-buy.ps1",
  "data/scorecard-latest.json",
]) {
  add(!syncSource.includes(`"${retired}"`), "sync_source_retired_removed", retired);
}

for (const retiredProtectedCache of [
  'path.join("data", "institution-mobile-top.json")',
  'path.join("data", "strategy5-page-1.json")',
]) {
  add(syncSource.includes(retiredProtectedCache), "sync_source_retired_protected_cache_listed", retiredProtectedCache);
}
add(!syncSource.includes('path.join("data", "warrant-flow-mobile-top.json")'), "sync_source_warrant_protected_cache_retired_removed");

const sw = read("fuman-sw.js");
add(!sw.includes("terminal-realtime-radar.css"), "sw_realtime_radar_precache_removed");
add(!sw.includes("terminal-theme-css-snapshot-first"), "sw_old_theme_snapshot_marker_removed");

const terminalFast = read(path.join("api", "terminal-fast-bundle.js"));
add(/RETIRED_TERMINAL_ENDPOINTS/.test(terminalFast) && /open-buy/.test(terminalFast) && /realtime-radar/.test(terminalFast) && /heatmap/.test(terminalFast), "terminal_fast_bundle_strips_retired_endpoints");

const terminalApp = read("terminal-app.js");
for (const retiredStaticRefresh of [
  "strategy5-page-1.json",
  "institution-mobile-top.json",
  "warrant-flow-mobile-top.json",
]) {
  add(!terminalApp.includes(`\"${retiredStaticRefresh}\":async`), "terminal_app_formal_static_refreshers_removed", retiredStaticRefresh);
}

const scorecardApi = read(path.join("api", "scorecard.js"));
add(scorecardApi.includes("json-snapshot-disabled"), "scorecard_static_json_fallback_disabled_by_default");

const failed = checks.filter((item) => !item.ok);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks }, null, 2));
