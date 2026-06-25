const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_VERCEL_PROJECT_ID = "prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl";
const EXPECTED_VERCEL_ORG_ID = "team_HfAXzMLgDcpw6UFbnexhuxHG";
const EXPECTED_VERCEL_PROJECT_NAME = "fuman-terminal";
const EXPECTED_NODE_VERSION = "24.x";

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

const issues = [];

function readJsonFile(file) {
  try {
    return JSON.parse(read(file));
  } catch (error) {
    issues.push(`${file} must be valid JSON: ${error.message}`);
    return null;
  }
}

function assertNoPatternInExistingFiles(files, pattern, message) {
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute)) continue;
    if (pattern.test(read(file))) issues.push(`${file} ${message}`);
  }
}

const desktopApiOnlyGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-desktop-api-only.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (desktopApiOnlyGuard.status !== 0) {
  issues.push(`verify-desktop-api-only failed: ${(desktopApiOnlyGuard.stderr || desktopApiOnlyGuard.stdout || "").trim()}`);
}

const terminalModulesGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-terminal-modules-contract.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (terminalModulesGuard.status !== 0) {
  issues.push(`verify-terminal-modules-contract failed: ${(terminalModulesGuard.stderr || terminalModulesGuard.stdout || "").trim()}`);
}
function queryScheduledTask(taskName) {
  const escaped = taskName.replace(/'/g, "''");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Get-ScheduledTask -TaskName '${escaped}' -ErrorAction SilentlyContinue | Select-Object TaskName,@{n='Execute';e={$_.Actions.Execute}},@{n='Arguments';e={$_.Actions.Arguments}},@{n='WorkingDirectory';e={$_.Actions.WorkingDirectory}},@{n='TriggerCount';e={$_.Triggers.Count}} | ConvertTo-Json -Compress -Depth 4`,
  ], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

const packageJson = JSON.parse(read("package.json"));
if (packageJson.engines?.node !== EXPECTED_NODE_VERSION) {
  issues.push(`package.json engines.node must be ${EXPECTED_NODE_VERSION}; current=${packageJson.engines?.node || "(missing)"}`);
}
const vercelProject = readJsonFile(".vercel/project.json");
if (vercelProject) {
  if (vercelProject.projectId !== EXPECTED_VERCEL_PROJECT_ID) {
    issues.push(`.vercel/project.json projectId must be ${EXPECTED_VERCEL_PROJECT_ID}; current=${vercelProject.projectId || "(missing)"}`);
  }
  if (vercelProject.orgId !== EXPECTED_VERCEL_ORG_ID) {
    issues.push(`.vercel/project.json orgId must be ${EXPECTED_VERCEL_ORG_ID}; current=${vercelProject.orgId || "(missing)"}`);
  }
  if (vercelProject.projectName !== EXPECTED_VERCEL_PROJECT_NAME) {
    issues.push(`.vercel/project.json projectName must be ${EXPECTED_VERCEL_PROJECT_NAME}; current=${vercelProject.projectName || "(missing)"}`);
  }
  if (vercelProject.settings?.nodeVersion !== EXPECTED_NODE_VERSION) {
    issues.push(`.vercel/project.json settings.nodeVersion must be ${EXPECTED_NODE_VERSION}; current=${vercelProject.settings?.nodeVersion || "(missing)"}`);
  }
}
if (!/require-version-bump-approval\.js/.test(String(packageJson.scripts?.deploy || ""))) {
  issues.push("package.json scripts.deploy must require version/deploy approval");
}
if (!/require-version-bump-approval\.js/.test(String(packageJson.scripts?.["release:main"] || ""))) {
  issues.push("package.json scripts.release:main must require version/deploy approval");
}
for (const [scriptName, scriptBody] of Object.entries(packageJson.scripts || {})) {
  if (["bump:version", "verify:bump"].includes(scriptName)) continue;
  if (/\bbump:version\b|bump-version\.js/.test(String(scriptBody || ""))) {
    issues.push(`package.json scripts.${scriptName} must not auto bump version`);
  }
}
if (!packageJson.scripts?.["cleanup:api-only-retired"] || !/cleanup-api-only-retired-artifacts\.js/.test(packageJson.scripts["cleanup:api-only-retired"])) {
  issues.push("package.json missing scripts.cleanup:api-only-retired");
}
for (const scriptName of ["verify:mobile-layout", "verify:mobile-layout:live"]) {
  if (!packageJson.scripts?.[scriptName]) {
    issues.push(`package.json missing scripts.${scriptName}`);
  }
}
if (!String(packageJson.scripts?.postdeploy || "").includes("verify-mobile-layout.js --live")) {
  issues.push("postdeploy must run live mobile layout verification");
}
const gateScript = packageJson.scripts && packageJson.scripts["freshness:gate"];
if (!gateScript) {
  issues.push("package.json missing scripts.freshness:gate");
} else {
  if (!/npm run release:daily/.test(gateScript)) issues.push("freshness:gate must delegate to npm run release:daily");
}
for (const [scriptName, marker] of [
  ["scan:full", "run-full-scan.ps1"],
  ["publish:gate", "run-publish-gate.ps1"],
  ["release:daily", "run-daily-release.ps1"],
]) {
  const script = packageJson.scripts && packageJson.scripts[scriptName];
  if (!script) {
    issues.push(`package.json missing scripts.${scriptName}`);
  } else {
    if (!/\bpwsh\.exe\b/i.test(script)) issues.push(`${scriptName} must use PowerShell 7 pwsh.exe`);
    if (!new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(script)) {
      issues.push(`${scriptName} must run ${marker}`);
    }
  }
}
const fastGateScript = packageJson.scripts && packageJson.scripts["freshness:gate:fast"];
if (!fastGateScript) {
  issues.push("package.json missing scripts.freshness:gate:fast");
}
const mainReleaseScript = packageJson.scripts && packageJson.scripts["release:main"];
if (!mainReleaseScript) {
  issues.push("package.json missing scripts.release:main");
} else {
  if (!/\bpwsh\.exe\b/i.test(mainReleaseScript)) issues.push("release:main must use PowerShell 7 pwsh.exe");
  if (!/run-main-release-pipeline\.ps1/i.test(mainReleaseScript)) issues.push("release:main must run run-main-release-pipeline.ps1");
}

if (!fs.existsSync(path.join(ROOT, "run-main-release-pipeline.ps1"))) {
  issues.push("run-main-release-pipeline.ps1 missing main release pipeline");
} else {
  const releasePipeline = read("run-main-release-pipeline.ps1");
  for (const marker of [
    "git fetch origin main",
    "git pull --ff-only origin main",
    "npm run verify:bump",
    "npm run sync:source",
    "npm run deploy",
    "npm run verify:live-version",
    "npm run verify:warrant-freshness:live",
    "git push origin HEAD:main",
  ]) {
    if (!releasePipeline.includes(marker)) issues.push(`run-main-release-pipeline.ps1 missing ${marker}`);
  }
  if (!/Assert-CleanTree/.test(releasePipeline)) {
    issues.push("run-main-release-pipeline.ps1 must require a clean tree before syncing main");
  }
}

if (!fs.existsSync(path.join(ROOT, "legacy-entrypoint-guard.ps1"))) {
  issues.push("legacy-entrypoint-guard.ps1 missing legacy script redirect guard");
} else {
  const legacyGuard = read("legacy-entrypoint-guard.ps1");
  if (!/freshness:gate:fast/.test(legacyGuard) || !/npm run \$gateScript/.test(legacyGuard)) {
    issues.push("legacy-entrypoint-guard.ps1 must redirect legacy data scripts to npm run freshness:gate:fast by default");
  }
}

const cacheSync = read("run-cache-sync.ps1");
const gate = read("run-live-freshness-gate.ps1");
const fullScan = read("run-full-scan.ps1");
const publishGate = read("run-publish-gate.ps1");
const dailyRelease = read("run-daily-release.ps1");
const runtimeConfig = read("terminal-runtime-config.js");
const realtimeRadarApi = read("api/realtime-radar-latest.js");
const openBuyLatestApi = read("api/open-buy-latest.js");
const strategy4LatestApi = read("api/strategy4-latest.js");
const strategy4Scanner = read("scripts/scan-strategy4-cache.js");
const runStrategy4 = read("run-strategy4.ps1");
const slimCacheGenerator = read("scripts/generate-slim-cache.js");
const sourceSync = read("scripts/sync-main-deploy-source.js");
const strategy2CompleteRunPublisher = read("scripts/publish-strategy2-complete-run.js");
const strategy2SharedSource = read("lib/supabase-public-slot.js");
const strategy2Scanner = read("scripts/scan-intraday-signals.js");
const runIdCompleteGate = read("scripts/verify-run-id-complete-gates.js");
const terminalLiveCheck = read("terminal-live-check.js");
const terminalApp = read("terminal-app.js");
if (!/dataManifest:\s*""/.test(runtimeConfig)) {
  issues.push("terminal-runtime-config.js dataManifest must be an empty string; static JSON manifest polling must stay disabled");
}
if (/dataManifest:\s*["']\/data\//.test(runtimeConfig)) {
  issues.push("terminal-runtime-config.js must not point dataManifest at static JSON data");
}
assertNoPatternInExistingFiles([
  "package.json",
  "scripts/prepare-deploy.js",
  "scripts/verify-production-guard.js",
  "run-publish-gate.ps1",
  "run-main-release-pipeline.ps1",
  "run-daily-release.ps1",
  "run-full-scan.ps1",
  "run-cache-sync.ps1",
  "terminal-runtime-config.js",
  "api/desktop-route-snapshot.js",
  "api/terminal-fast-bundle.js",
], /fuman-terminal-sync/i, "must not depend on C:\\fuman-terminal-sync in production runtime or deploy flow");
assertNoPatternInExistingFiles([
  "terminal-runtime-config.js",
  "api/desktop-route-snapshot.js",
  "api/terminal-fast-bundle.js",
  "api/mobile-boot.js",
  "api/mobile-fragment.js",
  "api/open-buy-latest.js",
  "api/latest-strategy.js",
  "api/strategy2-latest.js",
  "api/strategy3-latest.js",
  "api/strategy4-latest.js",
  "api/strategy5-latest.js",
  "api/institution-latest.js",
  "api/warrant-flow-latest.js",
  "api/cb-detect-latest.js",
  "api/realtime-radar-latest.js",
  "api/market-overview-latest.js",
  "lib/desktop-route-snapshot-cache.js",
], /google\s*sheet|googlesheet|sheets\.googleapis|docs\.google\.com\/spreadsheets/i, "must not use Google Sheet as a production data source");
if (!/if \(\$Scope -ne "all"\)/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must block every non-all scope");
}
if (/FUMAN_ALLOW_SCOPED_PUBLISH/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must not expose FUMAN_ALLOW_SCOPED_PUBLISH bypass");
}
if (/FUMAN_STRATEGY4_SCOPED_PUBLISH/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must not expose strategy4 scoped publish bypass");
}
if (!/FUMAN_INSIDE_FRESHNESS_GATE/.test(cacheSync) || !/freshness:gate/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 direct calls must redirect to npm run freshness:gate by default");
}
if (!/npm run snapshot:data/.test(cacheSync) || !/CACHE_SYNC_WRITE_CODE_REPO/.test(gate) || !/CACHE_SYNC_WRITE_CODE_REPO_CRITICAL_ONLY/.test(gate)) {
  issues.push("freshness gate critical data release must snapshot source data before release:main");
}
if (!/Get-CriticalDataReleaseFiles/.test(cacheSync) || !/CACHE_SYNC_WRITE_CODE_REPO_CRITICAL_ONLY/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must limit freshness-gate source repo writes to critical data files");
}
for (const marker of ["DESKTOP_API_ONLY_STATIC_FILTER", "Test-DesktopApiOnlyStaticDataFile", "desktop-api-only-static-disabled"]) {
  if (!cacheSync.includes(marker)) {
    issues.push(`run-cache-sync.ps1 missing desktop API-only static filter marker ${marker}`);
  }
}
if (!/Pre-publish data freshness gate removed/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must explicitly disable the removed pre-publish data freshness gate");
}
if (!/FAST_DEBOUNCE_SKIP/.test(cacheSync) || !/FUMAN_FAST_GATE_COMMIT_DEBOUNCE_MINUTES/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 missing fast gate commit debounce");
}
for (const marker of [
  "realtimeRadarCache: \"/api/realtime-radar-latest\"",
]) {
  if (!runtimeConfig.includes(marker)) issues.push(`terminal-runtime-config.js missing live realtime radar endpoint marker ${marker}`);
}
if (/realtimeRadarStaticCache:\s*"\/data\/realtime-radar-latest\.json"/.test(runtimeConfig)) {
  issues.push("terminal-runtime-config.js must not expose realtime radar static cache fallback");
}
for (const marker of [
  "openBuyCache: \"/api/open-buy-latest\"",
  "strategy4Cache: \"/api/strategy4-latest\"",
  "strategy3Cache: \"/api/strategy3-latest\"",
  "strategy5Cache: \"/api/strategy5-latest\"",
  "institutionCache: \"/api/institution-latest\"",
  "warrantFlowCache: \"/api/warrant-flow-latest\"",
]) {
  if (!runtimeConfig.includes(marker)) issues.push(`terminal-runtime-config.js must keep complete-run/no-store frontend endpoint ${marker}`);
}
if (/legacy-scan-time/.test(strategy4LatestApi) || !/gate: "(run_id|complete-run-authoritative)"/.test(strategy4LatestApi)) {
  issues.push("api/strategy4-latest.js must read latest complete run by run_id and must not fall back to legacy scan_time");
}
if (/staticFallback|static-fallback|\/data\/strategy4-|strategy4_static|strategy4_scan_results_latest_empty/.test(strategy4LatestApi)) {
  issues.push("api/strategy4-latest.js must be API-only and must not fall back to static strategy4 JSON");
}
if (!/api\/open-buy-latest/.test(openBuyLatestApi) || !/strategy1_open_buy_runs/.test(openBuyLatestApi) || !/strategy1_open_buy_results/.test(openBuyLatestApi) || !/v_strategy1_ready_status/.test(openBuyLatestApi) || !/Cache-Control", "no-store/.test(openBuyLatestApi)) {
  issues.push("api/open-buy-latest.js must read Strategy1 from Supabase API-only runs/results with decision_ready and no-store headers");
}
if (/v_strategy1_open_buy_latest_complete_run|LATEST_RUN_VIEW|latestRunView|latest_run_view/.test(openBuyLatestApi)) {
  issues.push("api/open-buy-latest.js must not use legacy latest run view fallback");
}
if (/latest-payload/.test(openBuyLatestApi)) {
  issues.push("api/open-buy-latest.js must not expose legacy latest-payload gate");
}
if (/snapshot-friendly-skip-ready-status/.test(openBuyLatestApi) || /options\.snapshotFriendly\s*\?\s*\{\s*decision_ready:\s*false/.test(openBuyLatestApi)) {
  issues.push("api/open-buy-latest.js snapshot/compact path must still read v_strategy1_ready_status and must not bypass decision_ready");
}
if (!/emptySnapshotPayload\("strategy1_decision_not_ready"/.test(openBuyLatestApi)) {
  issues.push("api/open-buy-latest.js compact snapshot response must return an empty Strategy1 payload when decision_ready is false");
}
if (/legacy scan_time gate|legacy_scan_time_gate|includeRunId = false|STRATEGY4_SUPABASE_RUN_ID/.test(strategy4Scanner)) {
  issues.push("scan-strategy4-cache.js must hard-fail when run_id complete gate is unavailable, not retry legacy scan_time");
}
if (!/STRATEGY4_API_ONLY = true/.test(strategy4Scanner) || /OUT_FILE|BACKUP_FILE|SUMMARY_FILE|writeSummary\("strategy4"|fs\.writeFileSync\([^)]*strategy4-(latest|backup|summary)\.json/.test(strategy4Scanner)) {
  issues.push("scan-strategy4-cache.js must be API-only: full scan publishes Supabase complete run only, no data/strategy4 static output");
}
if (/run-cache-sync|generate-slim-cache|run-strategy4-postflight|data\\strategy4|data\/strategy4|strategy4-(latest|backup|summary|slim|zone|score).*\.json/.test(runStrategy4) || !/api\/strategy4-latest/.test(runStrategy4)) {
  issues.push("run-strategy4.ps1 must be API-only: no static strategy4 JSON copy, slim generation, cache sync, or static postflight");
}
if (/"strategy4", "data\/strategy4-latest\.json"|strategy4PresetFiles\]/.test(slimCacheGenerator)) {
  issues.push("generate-slim-cache.js must not generate strategy4 static slim/zone/page JSON");
}
if (/data\/strategy4-|strategy4-score/.test(sourceSync)) {
  issues.push("sync-main-deploy-source.js must not publish strategy4 static JSON artifacts");
}
if (/readJson\("data\/open-buy-latest\.json"/.test(read("api/terminal-home.js"))) {
  issues.push("api/terminal-home.js must not fallback to legacy data/open-buy-latest.json");
}
if (!/publish_strategy2_complete_run/.test(strategy2CompleteRunPublisher) || !/strategy2_latest\?on_conflict=id/.test(strategy2CompleteRunPublisher)) {
  issues.push("publish-strategy2-complete-run.js must publish strategy2_latest and Supabase complete run RPC");
}
if (!/strategy1,strategy2,strategy3,strategy4,strategy5,institution,warrant_flow/.test(runIdCompleteGate) || /RUN_GATE_OPTIONAL \|\| "strategy2"/.test(runIdCompleteGate)) {
  issues.push("verify-run-id-complete-gates.js must require strategy2 as a strict complete-run gate by default");
}
for (const marker of [
  "/api/open-buy-latest",
  "/api/strategy4-latest",
  "/api/strategy3-latest",
  "/api/strategy5-latest",
  "/api/institution-latest",
  "/api/warrant-flow-latest",
]) {
  if (!terminalLiveCheck.includes(marker) && !runtimeConfig.includes(marker)) {
    issues.push(`frontend source missing complete-run/no-store polling endpoint ${marker}`);
  }
}
if (!/loadOpenBuySupabasePayload/.test(terminalApp) || !/api\/open-buy-latest/.test(terminalApp)) {
  issues.push("terminal-app.js must poll api/open-buy-latest before static open-buy fallback");
}
if (!/pollCompleteRunUpdates/.test(terminalLiveCheck) || !/installCompleteRunPollingManager/.test(terminalApp) || !/installStrategy3ApiRunPolling/.test(terminalApp)) {
  issues.push("frontend must keep unified complete-run polling manager for API no-store auto updates, including strategy3 API run polling");
}
if (!/installStrategy4ApiRunPolling/.test(terminalApp)) {
  issues.push("frontend must keep strategy4 API run polling for forced reload on runId change");
}
if (/\/data\/strategy4-|localStorage\.getItem\(STRATEGY4|localStorage\.setItem\(STRATEGY4/.test(terminalLiveCheck) || /\/data\/strategy4-|localStorage\.getItem\(STRATEGY4|localStorage\.setItem\(STRATEGY4/.test(terminalApp)) {
  issues.push("strategy4 frontend must be API-only: no static JSON, backup JSON, or localStorage seed data paths");
}
for (const marker of [
  "fuman_realtime_radar_cache",
  "fugle_realtime_quote_latest",
  "fetchRadarCachePayload",
  "radar-cache-latest-id",
  "radar-cache-latest-updated",
  "quote-view-fallback",
  "static-fallback",
]) {
  if (!realtimeRadarApi.includes(marker)) issues.push(`api/realtime-radar-latest.js missing fallback order marker ${marker}`);
}

for (const marker of [
  "Invoke-RepoSyncPreflight",
  "git fetch origin main",
  "realtime radar raw refresh",
  "strategy2 intraday raw refresh",
  "institution raw refresh",
  "warrant flow raw refresh",
  "STAR preopen raw refresh",
  "open buy raw refresh",
  "strategy3 raw refresh",
  "strategy4 raw refresh",
  "strategy5 raw refresh",
  "cb detect raw refresh",
  "FUMAN_INSIDE_FRESHNESS_GATE",
  "FUMAN_FAST_GATE",
  "Fast gate selected",
  "Legacy terminal freshness diagnostic disabled",
]) {
  if (!gate.includes(marker)) issues.push(`run-live-freshness-gate.ps1 missing ${marker}`);
}
if (!/SkipRawRefresh/.test(gate) || !/Raw refresh skipped/.test(gate) || !/\$gateMode = if \(\$SkipRawRefresh\)/.test(gate)) {
  issues.push("run-live-freshness-gate.ps1 must support publish-only mode via -SkipRawRefresh");
}
for (const marker of [
  "Invoke-ScanTask \"strategy3\" \"strategy3 raw refresh\" \"critical\"",
  "scripts\\scan-strategy3-cache.js",
  "data\\strategy3-latest.json",
  "data\\scan-receipts",
  "scan-summary.json",
]) {
  if (!fullScan.includes(marker)) issues.push(`run-full-scan.ps1 missing strategy3 receipt marker ${marker}`);
}
for (const marker of [
  "\"strategy3\"",
  "stale scan receipt",
  "blocking scan receipt",
  "run-live-freshness-gate.ps1",
  "-SkipRawRefresh",
]) {
  if (!publishGate.includes(marker)) issues.push(`run-publish-gate.ps1 missing publish gate marker ${marker}`);
}
for (const marker of [
  "run-full-scan.ps1",
  "scripts\\generate-slim-cache.js",
  "run-publish-gate.ps1",
]) {
  if (!dailyRelease.includes(marker)) issues.push(`run-daily-release.ps1 missing daily release marker ${marker}`);
}

const mobileHealthVerifier = read("scripts/verify-mobile-health.js");
for (const marker of [
  "FIRST_SCREEN_BUDGET_BYTES",
  "FIRST_SCREEN_JSON_BUDGET_BYTES",
  "FIRST_SCREEN_FORBIDDEN",
  "/api/mobile-boot",
]) {
  if (!mobileHealthVerifier.includes(marker)) issues.push(`verify-mobile-health.js missing ${marker}`);
}

const mobileLayoutVerifier = read("scripts/verify-mobile-layout.js");
for (const marker of [
  "repeat(2, minmax(0, 1fr))",
  "forbidden mobile #market-view #heatmap one-column override found",
  "--live",
]) {
  if (!mobileLayoutVerifier.includes(marker)) issues.push(`verify-mobile-layout.js missing ${marker}`);
}

const liveVersionVerifier = read("scripts/verify-live-version.js");
for (const marker of [
  "verifyMarketEventReminderGuard",
  "installMarketSettlementTitleBadgeGuard",
  "台指期大結算",
  "美股四巫日",
  "market event reminder order must be 台指期大結算 before 美股四巫日",
]) {
  if (!liveVersionVerifier.includes(marker)) issues.push(`verify-live-version.js missing market event reminder marker ${marker}`);
}
for (const marker of [
  "verifyMarketAiPriorityRiskGuard",
  "terminal-ai-risk-guard.js",
  "installMarketAiPriorityRiskGuard",
  "事件波動風險最高",
  "個股極端波動風險",
  "AI 盤中/盤後模式風險",
]) {
  if (!liveVersionVerifier.includes(marker)) issues.push(`verify-live-version.js missing AI priority risk marker ${marker}`);
}
const aiRiskGuard = read("terminal-ai-risk-guard.js");
for (const marker of [
  "installMarketAiPriorityRiskGuard",
  "事件波動風險最高",
  "個股極端波動風險",
  "AI 盤中/盤後模式風險",
]) {
  if (!aiRiskGuard.includes(marker)) issues.push(`terminal-ai-risk-guard.js missing ${marker}`);
}
if (!read("index.html").includes("terminal-ai-risk-guard.js")) issues.push("index.html missing terminal-ai-risk-guard.js");
if (!read("index.github.html").includes("terminal-ai-risk-guard.js")) issues.push("index.github.html missing terminal-ai-risk-guard.js");
if (!gate.includes("verify:live-version")) {
  issues.push("run-live-freshness-gate.ps1 must include verify:live-version for market event reminders");
}

for (const marker of [
  "Set-Strategy2IntradayEnv",
  "STRATEGY2_SCAN_START_MINUTES",
  "STRATEGY2_ENTRY_START_MINUTES",
  "STRATEGY2_ENTRY_END_MINUTES",
  "STRATEGY2_SCAN_END_MINUTES",
  "525",
  "545",
  "720",
]) {
  if (!gate.includes(marker)) issues.push(`run-live-freshness-gate.ps1 missing strategy2 governance marker ${marker}`);
}
if (!/overlapping run/.test(gate)) {
  issues.push("run-live-freshness-gate.ps1 must skip overlapping scheduled runs cleanly");
}

const serviceWorker = read("fuman-sw.js");
if (!/networkFirst\(request\)/.test(serviceWorker) || !/cache: "no-store"/.test(serviceWorker)) {
  issues.push("fuman-sw.js must keep mobile data requests network-first/no-store");
}
if (!/ETIMEDOUT|ECONNRESET|fetch failed/.test(gate)) {
  issues.push("run-live-freshness-gate.ps1 must capture external source timeout warnings");
}

const healthSummary = read("scripts/generate-health-summary.js");
if (!/ETIMEDOUT|ECONNRESET|fetch failed|AbortError/.test(healthSummary)) {
  issues.push("generate-health-summary.js must classify external source timeout warnings");
}

const sourceSyncScript = read("scripts/sync-main-deploy-source.js");
for (const file of [
  "terminal-live-check.js",
  "terminal-watchlist-module.js",
  "lib/supabase-public-slot.js",
  "scripts/intraday-radar-rules.js",
  "scripts/scan-intraday-signals.js",
  "scripts/fugle-websocket-collector.js",
  "scripts/scan-realtime-radar-cache.js",
  "scripts/scan-strategy3-cache.js",
  "scripts/verify-desktop-api-only.js",
  "data/terminal-home-bundle.json",
  "data/terminal-home-mobile-slim.json",
  "scripts/scan-open-buy-cache.js",
  "scripts/scan-star-preopen.js",
  "ops/public-slot/Strategy1RunIdCompleteGate.sql",
  "ops/public-slot/Watchdog-PublicSlotSharedSource.ps1",
  "data/star-preopen-latest.json",
  "data/star-preopen-scorecard-source.json",
  "api/desktop-static-disabled.js",
  "api/scan-warrant-flow.js",
  "scripts/scan-warrant-flow-cache.js",
  "scripts/cleanup-api-only-retired-artifacts.js",
  "run-api-only-retired-cleanup.ps1",
  "install-api-only-cleanup-task.ps1",
]) {
  if (!sourceSyncScript.includes(file)) issues.push(`sync-main-deploy-source.js missing ${file}`);
}

const apiOnlyCleanup = read("scripts/cleanup-api-only-retired-artifacts.js");
for (const marker of [
  "api-only-retired-artifact-cleanup",
  "scan-intraday-signals.js",
  "intraday-radar-rules.js",
  "scan-open-buy-cache.js",
  "scan-strategy4-cache.js",
  "scan-strategy5-cache.js",
  "scan-warrant-flow-cache.js",
  "open-buy-latest.json",
  "institution-latest.json",
  "warrant-flow-latest.json",
  "run-freshness-gate-task.ps1",
  ".vercel/output/static/scan-intraday-signals.js",
  ".vercel/output/static/intraday-radar-rules.js",
  "data/chip-trade-health-latest.json",
  "data/fugle-open-rebound-latest.json",
  "warrant-volume-page-",
  "open-buy-page-",
  "strategy2-intraday-page-",
  "strategy3-page-",
  "strategy4-page-",
  "strategy5-page-",
  "warrant-flow-page-",
  "cb-detect-page-",
]) {
  if (!apiOnlyCleanup.includes(marker)) issues.push(`cleanup-api-only-retired-artifacts.js missing ${marker}`);
}

const cleanupTaskInstaller = read("install-api-only-cleanup-task.ps1");
for (const marker of [
  "Fuman API-Only Retired Artifact Cleanup 1535",
  "run-api-only-retired-cleanup.ps1",
  "New-ScheduledTaskTrigger -Daily",
]) {
  if (!cleanupTaskInstaller.includes(marker)) issues.push(`install-api-only-cleanup-task.ps1 missing ${marker}`);
}

const strategy3Scanner = read("scripts/scan-strategy3-cache.js");
for (const marker of [
  "fetchStrategy3QuoteReady",
  "fetchStrategy3Intraday1mLatestN",
  "chipTradeExclusion",
  "STRATEGY3_APPLY_BLACKLIST",
  "TradingView 隔日沖判斷",
]) {
  if (!strategy3Scanner.includes(marker)) issues.push(`scan-strategy3-cache.js missing strategy3 TV-only marker ${marker}`);
}

const openBuyScanner = read("scripts/scan-open-buy-cache.js");
for (const marker of [
  "SUPABASE_OPEN_BUY_RUNS_TABLE",
  "SUPABASE_OPEN_BUY_RESULTS_TABLE",
  "incomplete scan is not eligible for run_id complete gate",
  "open-buy supabase run_id gate ok",
]) {
  if (!openBuyScanner.includes(marker)) issues.push(`scan-open-buy-cache.js missing strategy1 run_id complete gate marker ${marker}`);
}

for (const legacyScript of [
  "run-warrant-flow.ps1",
  "run-institution.ps1",
  "run-open-buy.ps1",
  "run-strategy2-intraday.ps1",
  "run-strategy5.ps1",
  "run-realtime-radar.ps1",
  "run-market-overview.ps1",
  "run-flow-watchdog.ps1",
]) {
  const scriptText = read(legacyScript);
  if (!/legacy-entrypoint-guard\.ps1/.test(scriptText)) {
    issues.push(`${legacyScript} must redirect to legacy-entrypoint-guard.ps1`);
  }
}

const runStrategy3 = read("run-strategy3.ps1");
if (!/run-strategy3-complete-scan\.ps1/.test(runStrategy3) || /run-cache-sync\.ps1|strategy3-latest\.json/.test(runStrategy3)) {
  issues.push("run-strategy3.ps1 must call the complete scan path without static JSON or cache sync");
}
const strategy3Watchdog = read("run-strategy3-watchdog.ps1");
for (const marker of ["/api/strategy3-latest", "Cache-Control", "no-store", "runId", "complete"]) {
  if (!strategy3Watchdog.includes(marker)) issues.push(`run-strategy3-watchdog.ps1 missing API-only watchdog marker ${marker}`);
}
if (/strategy3-latest\.json|run-cache-sync\.ps1/.test(strategy3Watchdog)) {
  issues.push("run-strategy3-watchdog.ps1 must not read strategy3 static JSON or repair through cache sync");
}


if (!fs.existsSync(path.join(ROOT, "STRATEGY2-FRESHNESS-GOVERNANCE.md"))) {
  issues.push("STRATEGY2-FRESHNESS-GOVERNANCE.md missing strategy2 data governance");
} else {
  const strategy2Governance = read("STRATEGY2-FRESHNESS-GOVERNANCE.md");
  for (const marker of [
    "策略2 Supabase API-Only Governance",
    "v_strategy2_detection_health",
    "v_strategy2_entry_events_today",
    "分層 Health Gate",
    "canPublishUniverse",
    "canUpgradeTechnicalEntry",
    "degraded_intraday_1m",
    "不升級 A 區",
    "afterhours_stopped_ok",
    "STRATEGY2_SCAN_START_MINUTES = 525",
    "STRATEGY2_ENTRY_START_MINUTES = 545",
    "STRATEGY2_ENTRY_END_MINUTES = 720",
    "STRATEGY2_SCAN_END_MINUTES = 720",
    "npm run verify:publish-gate",
  ]) {
    if (!strategy2Governance.includes(marker)) issues.push(`STRATEGY2-FRESHNESS-GOVERNANCE.md missing ${marker}`);
  }
}


for (const marker of [
  "canPublishUniverse",
  "canUpgradeTechnicalEntry",
  "degraded_intraday_1m",
  "healthLayers",
]) {
  if (!strategy2SharedSource.includes(marker)) issues.push(`lib/supabase-public-slot.js missing Strategy2 layered health marker ${marker}`);
}
for (const marker of [
  "sharedSourceCanPublishUniverse",
  "sharedSourceCanUpgradeTechnicalEntry",
  "quoteEntrySourceHealthy",
  "technicalEntryHealthy",
  "quote universe will publish but A-zone technical upgrade is disabled",
  "quote 母池保留，但 1分K/技術確認未就緒，暫不升級 A 區",
]) {
  if (!strategy2Scanner.includes(marker)) issues.push(`scan-intraday-signals.js missing Strategy2 split gate marker ${marker}`);
}

if (!fs.existsSync(path.join(ROOT, "REALTIME-RADAR-FRESHNESS-GOVERNANCE.md"))) {
  issues.push("REALTIME-RADAR-FRESHNESS-GOVERNANCE.md missing realtime radar data governance");
} else {
  const realtimeRadarGovernance = read("REALTIME-RADAR-FRESHNESS-GOVERNANCE.md");
  for (const marker of [
    "即時雷達 Supabase API-Only Governance",
    "API 必須回 `ok`",
    "marketSession.marketDataDate",
    "ETF、ETN、DR、指數、權證、CB、非普通股",
    "npm run verify:publish-gate",
  ]) {
    if (!realtimeRadarGovernance.includes(marker)) issues.push(`REALTIME-RADAR-FRESHNESS-GOVERNANCE.md missing ${marker}`);
  }
}

if (!fs.existsSync(path.join(ROOT, "STRATEGY5-FRESHNESS-GOVERNANCE.md"))) {
  issues.push("STRATEGY5-FRESHNESS-GOVERNANCE.md missing strategy5 data governance");
} else {
  const strategy5Governance = read("STRATEGY5-FRESHNESS-GOVERNANCE.md");
  for (const marker of [
    "策略5 Supabase API-Only Governance",
    "/api/strategy5-latest",
    "`rows` 必須是 `matches` 的 alias",
    "?top=1&compact=1&limit=50",
    "readback log 至少包含 `runId`",
    "不要把策略5正式來源退回",
  ]) {
    if (!strategy5Governance.includes(marker)) issues.push(`STRATEGY5-FRESHNESS-GOVERNANCE.md missing ${marker}`);
  }
}

function runGit(args) {
  return spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
}

const fetchResult = runGit(["fetch", "--quiet", "origin", "main"]);
if (fetchResult.status !== 0) {
  issues.push(`repo sync check failed: cannot fetch origin main: ${(fetchResult.stderr || fetchResult.stdout || "").trim()}`);
} else {
  const compare = runGit(["rev-list", "--left-right", "--count", "HEAD...origin/main"]);
  if (compare.status !== 0 || !compare.stdout.trim()) {
    issues.push("repo sync check failed: cannot compare HEAD with origin/main");
  } else {
    const [, behindText] = compare.stdout.trim().split(/\s+/);
    const behind = Number(behindText || 0);
    if (behind > 0) {
      issues.push(`repo sync check failed: local repo is behind origin/main by ${behind} commit(s); run git pull --ff-only origin main`);
    }
  }

  const status = runGit(["status", "--porcelain=v1"]);
  if (status.status !== 0) {
    issues.push("repo sync check failed: cannot inspect working tree");
  } else {
    const allowedDirty = new Set([
      ".gitignore",
      "AGENTS.md",
      "scripts/verify-publish-gate.js",
      "api/realtime-radar-latest.js",
      "api/terminal-home.js",
      "terminal-runtime-config.js",
      "scripts/e2e-smoke.js",
      "scripts/verify-deployment.js",
      "scripts/verify-warrant-freshness.js",
      "run-live-freshness-gate.ps1",
      "run-api-only-retired-cleanup.ps1",
      "run-cache-sync.ps1",
      "run-open-buy-sync-retry.ps1",
      "scripts/intraday-radar-rules.js",
  "scripts/scan-intraday-signals.js",
  "scripts/fugle-websocket-collector.js",
      "scripts/sync-main-deploy-source.js",
      "scripts/verify-source-sync.js",
      "scripts/cleanup-api-only-retired-artifacts.js",
      "install-api-only-cleanup-task.ps1",
      "run-main-release-pipeline.ps1",
      "run-daily-release.ps1",
      "run-full-scan.ps1",
      "run-publish-gate.ps1",
      "package.json",
      "data/mobile-home-summary.json",
      "data/strategy-match-index.json",
      "data/strategy2-intraday-live-top.json",
      "data/strategy2-intraday-slim.json",
      "data/strategy2-intraday-top.json",
      "data/terminal-home-bundle.json",
      "data/terminal-home-mobile-slim.json",
      "scripts/generate-health-summary.js",
      "REALTIME-RADAR-FRESHNESS-GOVERNANCE.md",
      "STRATEGY5-FRESHNESS-GOVERNANCE.md",
      "STRATEGY2-FRESHNESS-GOVERNANCE.md",
      "lib/supabase-public-slot.js",
      "scripts/scan-intraday-signals.js",
      "ops/public-slot/Watchdog-PublicSlotSharedSource.ps1",
    ]);
    const dirty = status.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .filter((line) => {
        const file = line.slice(3).trim();
        if (allowedDirty.has(file)) return false;
        if (/^data\/scan-receipts\/[^/]+\.json$/.test(file)) return false;
        if (/^data\/mobile-analysis\/\d{4}\.json$/.test(file)) return false;
        return true;
      });
    if (dirty.length) {
      issues.push(`repo sync check failed: unexpected dirty files: ${dirty.join(", ")}`);
    }
  }
}

if (issues.length) {
  console.error("[publish-gate] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[publish-gate] ok");

