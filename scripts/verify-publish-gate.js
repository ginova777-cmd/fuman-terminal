const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

const issues = [];

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
  if (!/\bpwsh\.exe\b/i.test(gateScript)) issues.push("freshness:gate must use PowerShell 7 pwsh.exe");
  if (!/run-live-freshness-gate\.ps1/i.test(gateScript)) issues.push("freshness:gate must run run-live-freshness-gate.ps1");
}
const fastGateScript = packageJson.scripts && packageJson.scripts["freshness:gate:fast"];
if (!fastGateScript) {
  issues.push("package.json missing scripts.freshness:gate:fast");
}
if (!packageJson.scripts?.["freshness:local-repair"]) {
  issues.push("package.json missing scripts.freshness:local-repair");
}
const mainReleaseScript = packageJson.scripts && packageJson.scripts["release:main"];
if (!mainReleaseScript) {
  issues.push("package.json missing scripts.release:main");
} else {
  if (!/\bpwsh\.exe\b/i.test(mainReleaseScript)) issues.push("release:main must use PowerShell 7 pwsh.exe");
  if (!/run-main-release-pipeline\.ps1/i.test(mainReleaseScript)) issues.push("release:main must run run-main-release-pipeline.ps1");
}

if (process.platform === "win32") {
  for (const expected of [
    ["Fuman Freshness Gate Fast 0845-1645", "run freshness:gate:fast", "C:\\fuman-terminal-sync", 8],
    ["Fuman Freshness Gate Full 0610 2010", "run freshness:gate", "C:\\fuman-terminal-sync", 2],
    ["Fuman Terminal Local Freshness Verify 0830-2230", "run freshness:local-repair", "C:\\fuman-terminal-sync", 8],
    ["Fuman Publish Gate Verify 0820", "run verify:publish-gate", "C:\\fuman-terminal-sync", 1],
  ]) {
    const [name, args, workingDirectory, minTriggers] = expected;
    const task = queryScheduledTask(name);
    if (!task) {
      issues.push(`scheduled task missing: ${name}`);
      continue;
    }
    if (!String(task.Execute || "").toLowerCase().endsWith("npm.cmd")) {
      issues.push(`${name} must execute npm.cmd`);
    }
    if (String(task.Arguments || "") !== args) {
      issues.push(`${name} arguments must be "${args}"`);
    }
    if (String(task.WorkingDirectory || "") !== workingDirectory) {
      issues.push(`${name} working directory must be ${workingDirectory}`);
    }
    if (Number(task.TriggerCount || 0) < minTriggers) {
      issues.push(`${name} trigger count too low: ${task.TriggerCount}`);
    }
  }
}

if (!fs.existsSync(path.join(ROOT, "run-freshness-gate-task.ps1"))) {
  issues.push("run-freshness-gate-task.ps1 missing scheduled task wrapper");
} else {
  const taskWrapper = read("run-freshness-gate-task.ps1");
  if (!/Set-Location -LiteralPath \$PSScriptRoot/.test(taskWrapper) || !/npm run freshness:gate/.test(taskWrapper)) {
    issues.push("run-freshness-gate-task.ps1 must only enter repo root and run npm run freshness:gate");
  }
}

if (!fs.existsSync(path.join(ROOT, "run-local-freshness-repair.ps1"))) {
  issues.push("run-local-freshness-repair.ps1 missing local data repair script");
} else {
  const repairScript = read("run-local-freshness-repair.ps1");
  if (!/verify:data-freshness/.test(repairScript) || !/freshness:gate:fast/.test(repairScript)) {
    issues.push("run-local-freshness-repair.ps1 must verify local data and repair with freshness:gate:fast");
  }
}

if (!fs.existsSync(path.join(ROOT, "run-main-release-pipeline.ps1"))) {
  issues.push("run-main-release-pipeline.ps1 missing main release pipeline");
} else {
  const releasePipeline = read("run-main-release-pipeline.ps1");
  for (const marker of [
    "git fetch origin main",
    "git pull --ff-only origin main",
    "npm run verify:bump",
    "npm run bump:version",
    "npm run sync:source",
    "npm run deploy",
    "npm run verify:live-version",
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
if (!/if \(\$Scope -ne "all"\)/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must block every non-all scope");
}
if (/FUMAN_ALLOW_SCOPED_PUBLISH/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must not expose FUMAN_ALLOW_SCOPED_PUBLISH bypass");
}
if (/FUMAN_STRATEGY4_SCOPED_PUBLISH/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must not expose strategy4 scoped publish bypass");
}
if (!/FUMAN_INSIDE_FRESHNESS_GATE/.test(cacheSync) || !/freshness:gate:fast/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 direct calls must redirect to npm run freshness:gate:fast by default");
}
if (!/Verify live data freshness/.test(cacheSync) || !/--live/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 post-publish verifier must use live data freshness");
}
if (!/FUMAN_SKIP_TERMINAL_GATE_ARTIFACT/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 post-publish verifier must skip terminal gate artifact until run-live-freshness-gate publishes it");
}
if (!/Pre-publish data freshness gate/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 missing pre-publish freshness gate");
}
if (!/FAST_DEBOUNCE_SKIP/.test(cacheSync) || !/FUMAN_FAST_GATE_COMMIT_DEBOUNCE_MINUTES/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 missing fast gate commit debounce");
}

const gate = read("run-live-freshness-gate.ps1");
for (const marker of [
  "Invoke-RepoSyncPreflight",
  "git fetch origin main",
  "realtime radar raw refresh",
  "strategy2 intraday raw refresh",
  "institution raw refresh",
  "warrant flow raw refresh",
  "open buy raw refresh",
  "strategy3 raw refresh",
  "strategy4 raw refresh",
  "strategy5 raw refresh",
  "cb detect raw refresh",
  "verify:data-freshness:live",
  "FUMAN_INSIDE_FRESHNESS_GATE",
  "FUMAN_FAST_GATE",
  "Fast gate selected",
  "live-freshness-ok.json",
  "Publish-TerminalFreshnessGate",
  "Wait-TerminalFreshnessGateVisible",
  "gateId",
  "Terminal freshness gate visible but not current",
  "FUMAN_SKIP_TERMINAL_GATE_ARTIFACT",
]) {
  if (!gate.includes(marker)) issues.push(`run-live-freshness-gate.ps1 missing ${marker}`);
}

const dataFreshnessVerifier = read("scripts/verify-data-freshness.js");
for (const marker of [
  "validateTerminalFreshnessGate",
  "data/live-freshness-ok.json",
  "terminal freshness gate version mismatch",
  "terminal freshness gate missing gateId",
  "terminal freshness gate invalid gateId",
  "terminal freshness gate CB rows not aligned with manifest",
  "FUMAN_SKIP_TERMINAL_GATE_ARTIFACT",
]) {
  if (!dataFreshnessVerifier.includes(marker)) issues.push(`verify-data-freshness.js missing ${marker}`);
}

const mobileLayoutVerifier = read("scripts/verify-mobile-layout.js");
for (const marker of [
  "repeat(2, minmax(0, 1fr))",
  "forbidden mobile #market-view #heatmap one-column override found",
  "--live",
]) {
  if (!mobileLayoutVerifier.includes(marker)) issues.push(`verify-mobile-layout.js missing ${marker}`);
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
if (!/networkFirst\(request\)/.test(serviceWorker) || !/cache: "no-store"/.test(serviceWorker) || !/live-freshness-ok\.json/.test(serviceWorker)) {
  issues.push("fuman-sw.js must keep mobile data requests network-first/no-store and include live-freshness-ok.json");
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
  "scripts/intraday-radar-rules.js",
  "scripts/scan-realtime-radar-cache.js",
  "data/data-manifest.json",
  "data/terminal-home-bundle.json",
  "data/institution-latest.json",
  "data/warrant-flow-latest.json",
]) {
  if (!sourceSyncScript.includes(file)) issues.push(`sync-main-deploy-source.js missing ${file}`);
}

for (const legacyScript of [
  "run-warrant-flow.ps1",
  "run-institution.ps1",
  "run-open-buy.ps1",
  "run-open-buy-sync-retry.ps1",
  "run-strategy2-intraday.ps1",
  "run-strategy3.ps1",
  "run-strategy3-watchdog.ps1",
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

if (!fs.existsSync(path.join(ROOT, "AGENTS.md"))) {
  issues.push("AGENTS.md missing Codex publish rule");
} else {
  const agents = read("AGENTS.md");
  if (!agents.includes("npm run freshness:gate")) issues.push("AGENTS.md must name npm run freshness:gate as the only publish entrypoint");
  if (!agents.includes("data/live-freshness-ok.json")) issues.push("AGENTS.md must explain the live terminal freshness gate artifact");
  if (!agents.includes("FRESHNESS-GATE-MOBILE.md")) issues.push("AGENTS.md must point Codex to FRESHNESS-GATE-MOBILE.md");
  if (!agents.includes("git pull --ff-only origin main")) issues.push("AGENTS.md must require Codex to sync before touching the project");
  if (!agents.includes("repo sync preflight")) issues.push("AGENTS.md must explain that freshness:gate blocks stale repos");
  if (!agents.includes("External data-source timeouts")) issues.push("AGENTS.md must explain external source warning handling");
  if (!agents.includes("Do not modify Supabase-related code")) issues.push("AGENTS.md must preserve the current Supabase pause rule");
  if (!agents.includes("STRATEGY2-FRESHNESS-GOVERNANCE.md")) issues.push("AGENTS.md must point Codex to STRATEGY2-FRESHNESS-GOVERNANCE.md");
  if (!agents.includes("strategy2-intraday-*.json")) issues.push("AGENTS.md must mention strategy2 JSON cannot bypass freshness gate");
  if (!agents.includes("REALTIME-RADAR-FRESHNESS-GOVERNANCE.md")) issues.push("AGENTS.md must point Codex to REALTIME-RADAR-FRESHNESS-GOVERNANCE.md");
  if (!agents.includes("realtime-radar-latest.json")) issues.push("AGENTS.md must mention realtime radar JSON cannot bypass freshness gate");
}

if (!fs.existsSync(path.join(ROOT, "FRESHNESS-GATE-MOBILE.md"))) {
  issues.push("FRESHNESS-GATE-MOBILE.md missing mobile governance summary");
} else {
  const mobile = read("FRESHNESS-GATE-MOBILE.md");
  for (const marker of [
    "資料新鮮度治理",
    "Verified Data Publish Gate",
    "npm run freshness:gate",
    "npm run verify:data-freshness:live",
    "npm run verify:publish-gate",
    "git pull --ff-only origin main",
    "repo sync preflight",
    "外部來源 timeout",
    "手機資料請求必須 network-first / no-store",
    "排程重疊",
    "不要手動改 publish data",
    "GitHub 或網路不可用",
    "目前先不要修改 Supabase",
    "Fuman Terminal Freshness Gate",
    "live-freshness-ok.json",
    "gateId",
    "manifestCbCount",
    "STRATEGY2-FRESHNESS-GOVERNANCE.md",
    "策略2 A進場區",
    "REALTIME-RADAR-FRESHNESS-GOVERNANCE.md",
    "/api/market + /api/realtime",
    "realtime-radar-latest.json",
  ]) {
    if (!mobile.includes(marker)) issues.push(`FRESHNESS-GATE-MOBILE.md missing ${marker}`);
  }
}

if (!fs.existsSync(path.join(ROOT, "STRATEGY2-FRESHNESS-GOVERNANCE.md"))) {
  issues.push("STRATEGY2-FRESHNESS-GOVERNANCE.md missing strategy2 data governance");
} else {
  const strategy2Governance = read("STRATEGY2-FRESHNESS-GOVERNANCE.md");
  for (const marker of [
    "策略2資料新鮮度治理",
    "Verified Data Publish Gate",
    "npm run freshness:gate",
    "npm run verify:data-freshness:live",
    "strategy2 intraday raw refresh",
    "cache sync all",
    "live-freshness-ok.json",
    "STRATEGY2_SCAN_START_MINUTES = 525",
    "STRATEGY2_ENTRY_START_MINUTES = 545",
    "STRATEGY2_ENTRY_END_MINUTES = 720",
    "STRATEGY2_SCAN_END_MINUTES = 720",
    "A進場區",
    "latestAAt / firstAAt 最新的在最上方",
    "STAR 必須來自期貨 + 試撮驗證欄位",
    ".\\run-cache-sync.ps1 -Scope strategy2",
    "legacy-entrypoint-guard.ps1",
  ]) {
    if (!strategy2Governance.includes(marker)) issues.push(`STRATEGY2-FRESHNESS-GOVERNANCE.md missing ${marker}`);
  }
}

if (!fs.existsSync(path.join(ROOT, "REALTIME-RADAR-FRESHNESS-GOVERNANCE.md"))) {
  issues.push("REALTIME-RADAR-FRESHNESS-GOVERNANCE.md missing realtime radar data governance");
} else {
  const realtimeRadarGovernance = read("REALTIME-RADAR-FRESHNESS-GOVERNANCE.md");
  for (const marker of [
    "即時雷達資料新鮮度治理",
    "Verified Data Publish Gate",
    "npm run freshness:gate",
    "npm run verify:data-freshness:live",
    "/api/market + /api/realtime",
    "realtime-radar-latest.json",
    "ETF / ETN / DR / 指數 / 權證 / CB / 非普通股",
    "2330、2412、3045",
    "水泥 / 軍工 / 國防 / 航太",
    "avg_volume_5 < 3000",
    "cumulative_bid_ask_volume < 3000",
    "score 高到低 -> 成交值高到低 -> 取前 80 檔",
    "failed batch details",
    "stale quote details",
    "Supabase 不是即時雷達必要條件",
    "legacy-entrypoint-guard.ps1",
  ]) {
    if (!realtimeRadarGovernance.includes(marker)) issues.push(`REALTIME-RADAR-FRESHNESS-GOVERNANCE.md missing ${marker}`);
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
      "AGENTS.md",
      "FRESHNESS-GATE-MOBILE.md",
      "scripts/verify-publish-gate.js",
      "scripts/verify-data-freshness.js",
      "run-live-freshness-gate.ps1",
      "run-cache-sync.ps1",
      "run-main-release-pipeline.ps1",
      "package.json",
      "scripts/generate-health-summary.js",
      "REALTIME-RADAR-FRESHNESS-GOVERNANCE.md",
    ]);
    const dirty = status.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .filter((line) => !allowedDirty.has(line.slice(3).trim()));
    if (dirty.length) {
      issues.push(`repo sync check failed: unexpected dirty files: ${dirty.slice(0, 8).join(", ")}`);
    }
  }
}

if (issues.length) {
  console.error("[publish-gate] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[publish-gate] ok");

