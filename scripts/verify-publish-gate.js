const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_VERCEL_PROJECT_ID = "prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl";
const EXPECTED_VERCEL_ORG_ID = "team_HfAXzMLgDcpw6UFbnexhuxHG";
const EXPECTED_VERCEL_PROJECT_NAME = "fuman-terminal";
const EXPECTED_NODE_VERSION = "24.x";
const EXPECTED_GIT_REMOTE_RE = /^(https:\/\/github\.com\/ginova777-cmd\/fuman-terminal\.git|git@github\.com:ginova777-cmd\/fuman-terminal\.git)$/i;
const LEGACY_SYNC_TREE_RE = new RegExp("fuman-terminal" + "-sync", "i");

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

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function assertGitReleaseRemote() {
  const originUrl = git(["remote", "get-url", "origin"]);
  if (originUrl.status !== 0) {
    issues.push(`git origin remote must be configured: ${(originUrl.stderr || originUrl.stdout || "").trim()}`);
    return;
  }
  const remote = String(originUrl.stdout || "").trim();
  if (!EXPECTED_GIT_REMOTE_RE.test(remote)) {
    issues.push(`git origin must point to GitHub fuman-terminal, not a local sync tree; current=${remote || "(missing)"}`);
  }
  if (LEGACY_SYNC_TREE_RE.test(remote) || /^[A-Za-z]:[\\/]/i.test(remote)) {
    issues.push(`git origin must not be a local path or legacy sync tree; current=${remote}`);
  }
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.status !== 0) {
    issues.push(`current branch must track origin/main before publish: ${(upstream.stderr || upstream.stdout || "").trim()}`);
  } else if (String(upstream.stdout || "").trim() !== "origin/main") {
    issues.push(`current branch upstream must be origin/main; current=${String(upstream.stdout || "").trim() || "(missing)"}`);
  }
}

assertGitReleaseRemote();

const desktopApiOnlyGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-desktop-api-only.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (desktopApiOnlyGuard.status !== 0) {
  issues.push(`verify-desktop-api-only failed: ${(desktopApiOnlyGuard.stderr || desktopApiOnlyGuard.stdout || "").trim()}`);
}

const buySellNoRollbackGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "guard-buy-sell-no-rollback.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (buySellNoRollbackGuard.status !== 0) {
  issues.push(`guard-buy-sell-no-rollback failed: ${(buySellNoRollbackGuard.stderr || buySellNoRollbackGuard.stdout || "").trim()}`);
}

const buySellFieldContractGuard = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, "scripts", "verify-buy-sell-field-contract.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (buySellFieldContractGuard.status !== 0) {
  issues.push(`verify-buy-sell-field-contract failed: ${(buySellFieldContractGuard.stderr || buySellFieldContractGuard.stdout || "").trim()}`);
}

const fugleSourceContractGuard = spawnSync(process.execPath, ["--use-system-ca", path.join(ROOT, "scripts", "verify-fugle-source-contract.js"), "--static-only"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (fugleSourceContractGuard.status !== 0) {
  issues.push(`verify-fugle-source-contract failed: ${(fugleSourceContractGuard.stderr || fugleSourceContractGuard.stdout || "").trim()}`);
}

const terminalModulesGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-terminal-modules-contract.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (terminalModulesGuard.status !== 0) {
  issues.push(`verify-terminal-modules-contract failed: ${(terminalModulesGuard.stderr || terminalModulesGuard.stdout || "").trim()}`);
}

const runtimeOwnershipGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-runtime-ownership.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (runtimeOwnershipGuard.status !== 0) {
  issues.push(`verify-runtime-ownership failed: ${(runtimeOwnershipGuard.stderr || runtimeOwnershipGuard.stdout || "").trim()}`);
}

const fastShellSelfContainedGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-fast-shell-self-contained.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (fastShellSelfContainedGuard.status !== 0) {
  issues.push(`verify-fast-shell-self-contained failed: ${(fastShellSelfContainedGuard.stderr || fastShellSelfContainedGuard.stdout || "").trim()}`);
}

const deployWorktreeCleanGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-deploy-worktree-clean.js")], {
  cwd: ROOT,
  encoding: "utf8",
});
if (deployWorktreeCleanGuard.status !== 0) {
  issues.push(`verify-deploy-worktree-clean failed: ${(deployWorktreeCleanGuard.stderr || deployWorktreeCleanGuard.stdout || "").trim()}`);
}

const scorecardNoRollbackGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-scorecard-no-rollback.js"), "--no-live", "--no-output", "--skip-schedule"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (scorecardNoRollbackGuard.status !== 0) {
  issues.push(`verify-scorecard-no-rollback failed: ${(scorecardNoRollbackGuard.stderr || scorecardNoRollbackGuard.stdout || "").trim()}`);
}
const scorecardStrategyRulesGuard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-scorecard-strategy-rules.js"), "--no-live", "--no-output"], {
  cwd: ROOT,
  encoding: "utf8",
});
if (scorecardStrategyRulesGuard.status !== 0) {
  issues.push(`verify-scorecard-strategy-rules failed: ${(scorecardStrategyRulesGuard.stderr || scorecardStrategyRulesGuard.stdout || "").trim()}`);
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
const fumanScheduleRegistry = readJsonFile("scripts/fuman-schedule-registry.json");
if (fumanScheduleRegistry) {
  const tasks = Array.isArray(fumanScheduleRegistry.tasks) ? fumanScheduleRegistry.tasks : [];
  const policy = fumanScheduleRegistry.policy || {};
  const activeTasks = Array.isArray(policy.activeTasks) ? policy.activeTasks : [];
  const expectedDisabledTasks = Array.isArray(policy.expectedDisabledTasks) ? policy.expectedDisabledTasks : [];
  const retiredTasks = Array.isArray(policy.retiredTasks) ? policy.retiredTasks : [];
  if (fumanScheduleRegistry.policyVersion !== 3) {
    issues.push(`scripts/fuman-schedule-registry.json policyVersion must be 3; current=${fumanScheduleRegistry.policyVersion || "(missing)"}`);
  }
  const strategy2LineStart0900 = tasks.find((task) => task?.taskName === "\\Fuman Strategy2 LINE Start 0900");
  if (!strategy2LineStart0900) {
    issues.push("scripts/fuman-schedule-registry.json must name Strategy2 LINE start as Fuman Strategy2 LINE Start 0900");
  } else {
    if (strategy2LineStart0900.time !== "09:00") {
      issues.push(`scripts/fuman-schedule-registry.json Strategy2 LINE Start 0900 time must be 09:00; current=${strategy2LineStart0900.time || "(missing)"}`);
    }
    const triggers = Array.isArray(strategy2LineStart0900.expectedTriggers) ? strategy2LineStart0900.expectedTriggers : [];
    if (triggers.length !== 1 || triggers[0] !== "09:00") {
      issues.push("scripts/fuman-schedule-registry.json Strategy2 LINE Start 0900 expectedTriggers must be exactly 09:00");
    }
    if (!String(strategy2LineStart0900.description || "").includes("09:00-13:30")) {
      issues.push("scripts/fuman-schedule-registry.json Strategy2 LINE Start 0900 description must say 09:00-13:30");
    }
  }
  const strategy2LineStop1330 = tasks.find((task) => task?.taskName === "\\Fuman Strategy2 LINE Stop 1330");
  if (!strategy2LineStop1330) {
    issues.push("scripts/fuman-schedule-registry.json must name Strategy2 LINE stop as Fuman Strategy2 LINE Stop 1330");
  } else {
    if (strategy2LineStop1330.time !== "13:30") {
      issues.push(`scripts/fuman-schedule-registry.json Strategy2 LINE Stop 1330 time must be 13:30; current=${strategy2LineStop1330.time || "(missing)"}`);
    }
    if (!String(strategy2LineStop1330.description || "").includes("13:30")) {
      issues.push("scripts/fuman-schedule-registry.json Strategy2 LINE Stop 1330 description must say 13:30");
    }
  }
  if (tasks.some((task) => /Strategy2 LINE Stop 1200/.test(String(task?.taskName || task?.displayName || "")))) {
    issues.push("scripts/fuman-schedule-registry.json must not use legacy Strategy2 LINE Stop 1200; Strategy2 runs 09:00-13:30");
  }
  const freshnessFull2010 = tasks.find((task) => task?.taskName === "\\Fuman Freshness Gate Full 2010");
  if (!freshnessFull2010) {
    issues.push("scripts/fuman-schedule-registry.json must name full freshness gate as Fuman Freshness Gate Full 2010");
  } else {
    if (freshnessFull2010.time !== "20:10") {
      issues.push(`scripts/fuman-schedule-registry.json Fuman Freshness Gate Full 2010 time must be 20:10; current=${freshnessFull2010.time || "(missing)"}`);
    }
    const triggers = Array.isArray(freshnessFull2010.expectedTriggers) ? freshnessFull2010.expectedTriggers : [];
    if (triggers.length !== 1 || triggers[0] !== "20:10") {
      issues.push("scripts/fuman-schedule-registry.json Fuman Freshness Gate Full 2010 expectedTriggers must be exactly 20:10");
    }
  }
  if (tasks.some((task) => /Freshness Gate Full \d{4} 2010/.test(String(task?.taskName || task?.displayName || "")))) {
    issues.push("scripts/fuman-schedule-registry.json must not keep a time-coded legacy full freshness gate task");
  }
  if (!activeTasks.includes("Fuman Freshness Gate Full 2010")) {
    issues.push("scripts/fuman-schedule-registry.json policy.activeTasks must include Fuman Freshness Gate Full 2010");
  }
  if (expectedDisabledTasks.length > 0) {
    issues.push("scripts/fuman-schedule-registry.json policy.expectedDisabledTasks must stay empty; old disabled tasks must be retired/removed");
  }
  if (!retiredTasks.includes("Fuman Deploy Worktree Clean Monitor 5m")) {
    issues.push("scripts/fuman-schedule-registry.json policy.retiredTasks must retire deploy worktree clean monitor");
  }
  if (!retiredTasks.includes("Fuman Strategy2 LINE Stop 1200")) {
    issues.push("scripts/fuman-schedule-registry.json policy.retiredTasks must retire Fuman Strategy2 LINE Stop 1200");
  }
  const forbiddenFullTriggers = policy.forbiddenTriggers && policy.forbiddenTriggers["Fuman Freshness Gate Full 2010"];
  if (!Array.isArray(forbiddenFullTriggers) || !forbiddenFullTriggers.includes("06:10")) {
    issues.push("scripts/fuman-schedule-registry.json policy.forbiddenTriggers must forbid 06:10 on Fuman Freshness Gate Full 2010");
  }
}
const fumanScheduleFullText = read("check-fuman-schedule-full.ps1");
if (!fumanScheduleFullText.includes("Fuman Strategy2 LINE Stop 1330") || !fumanScheduleFullText.includes("09:00 後每 3 秒巡邏到 13:30")) {
  issues.push("check-fuman-schedule-full.ps1 must describe Strategy2 as 09:00-13:30 and name LINE stop as 1330");
}
if (/Fuman Strategy2 LINE Stop 1200|策略2 當沖雷達[\s\S]{0,120}12:00/.test(fumanScheduleFullText)) {
  issues.push("check-fuman-schedule-full.ps1 must not describe Strategy2 as stopping at 12:00");
}
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
const vercelJson = readJsonFile("vercel.json");
if (vercelJson) {
  const rewrites = Array.isArray(vercelJson.rewrites) ? vercelJson.rewrites : [];
  if (!rewrites.some((route) => route?.source === "/88" && route?.destination === "/88.html")) {
    issues.push("vercel.json must keep /88 rewritten to /88.html for the public scorecard");
  }
  for (const [source, destination] of [
    ["/data/realtime-radar-latest.json", "/api/desktop-static-disabled"],
    ["/data/strategy-match-index.json", "/api/desktop-static-disabled"],
    ["/data/data-status-index.json", "/api/desktop-static-disabled"],
    ["/data/scan-receipts/realtime-radar.json", "/api/desktop-static-disabled"],
  ]) {
    if (!rewrites.some((route) => route?.source === source && route?.destination === destination)) {
      issues.push(`vercel.json must route retired realtime radar static source ${source} to ${destination}`);
    }
  }
}
const deployScript = String(packageJson.scripts?.deploy || "");
if (!/deploy-production-safe\.js/.test(deployScript)) {
  issues.push("package.json scripts.deploy must use scripts/deploy-production-safe.js");
}
if (/vercel\s+--prod/i.test(deployScript)) {
  issues.push("package.json scripts.deploy must not call vercel --prod directly");
}
for (const [scriptName, marker] of [
  ["verify:vercel-cost", "verify-vercel-cost-guard.js"],
  ["verify:vercel-projects", "verify-vercel-project-inventory.js"],
  ["monitor:vercel-cost", "monitor-vercel-cost-health.js"],
  ["monitor:vercel-cost:install", "install-vercel-cost-health-monitor-task.ps1"],
]) {
  if (!String(packageJson.scripts?.[scriptName] || "").includes(marker)) issues.push(`package.json missing scripts.${scriptName}`);
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
if (!packageJson.scripts?.["scorecard:sync"] || !/run-scorecard-daily-automation\.ps1/.test(packageJson.scripts["scorecard:sync"])) {
  issues.push("package.json scripts.scorecard:sync must run run-scorecard-daily-automation.ps1");
}
if (/run-scorecard-snapshot\.ps1/.test(String(packageJson.scripts?.["scorecard:sync"] || ""))) {
  issues.push("package.json scripts.scorecard:sync must not call retired run-scorecard-snapshot.ps1");
}
if (!packageJson.scripts?.["scorecard:publish"] || !/publish-scorecard-snapshot\.js/.test(packageJson.scripts["scorecard:publish"])) {
  issues.push("package.json missing scripts.scorecard:publish");
}
if (!packageJson.scripts?.["scorecard:export-source"] || !/export-scorecard-supabase-source\.js/.test(packageJson.scripts["scorecard:export-source"])) {
  issues.push("package.json missing scripts.scorecard:export-source Supabase source exporter");
}
if (!packageJson.scripts?.["scorecard:source:ops"] || !/scorecard-source-supabase-ops\.js/.test(packageJson.scripts["scorecard:source:ops"])) {
  issues.push("package.json missing scripts.scorecard:source:ops for scorecard Supabase source apply/backfill/probe");
}
if (!packageJson.scripts?.["scorecard:terminal-source"] || !/generate-terminal-scorecard-source\.js/.test(packageJson.scripts["scorecard:terminal-source"])) {
  issues.push("package.json missing scripts.scorecard:terminal-source for terminal complete-run scorecard freshness");
}
if (!packageJson.scripts?.["verify:scorecard"] || !/verify-scorecard-snapshot\.js/.test(packageJson.scripts["verify:scorecard"])) {
  issues.push("package.json missing scripts.verify:scorecard");
}
if (!packageJson.scripts?.["verify:scorecard-chain"] || !/verify-scorecard-resource-chain\.js/.test(packageJson.scripts["verify:scorecard-chain"])) {
  issues.push("package.json missing scripts.verify:scorecard-chain");
}
if (!packageJson.scripts?.["verify:scorecard-no-rollback"] || !/verify-scorecard-no-rollback\.js/.test(packageJson.scripts["verify:scorecard-no-rollback"])) {
  issues.push("package.json missing scripts.verify:scorecard-no-rollback");
}
if (!packageJson.scripts?.["verify:scorecard-health"] || !/verify-scorecard-health\.js/.test(packageJson.scripts["verify:scorecard-health"])) {
  issues.push("package.json missing scripts.verify:scorecard-health");
}
if (!packageJson.scripts?.["verify:scorecard-rules"] || !/verify-scorecard-strategy-rules\.js/.test(packageJson.scripts["verify:scorecard-rules"])) {
  issues.push("package.json missing scripts.verify:scorecard-rules");
}
if (!packageJson.scripts?.["verify:market-surfaces-chain"] || !/verify-market-surfaces-chain\.js/.test(packageJson.scripts["verify:market-surfaces-chain"])) {
  issues.push("package.json missing scripts.verify:market-surfaces-chain for market overview/heatmap/AI/realtime/watchlist");
}
if (!packageJson.scripts?.["verify:market-ai-dashboard-ui"] || !/verify-terminal-ui-e2e\.js/.test(packageJson.scripts["verify:market-ai-dashboard-ui"]) || !/market-ai/.test(packageJson.scripts["verify:market-ai-dashboard-ui"])) {
  issues.push("package.json missing scripts.verify:market-ai-dashboard-ui for AI dashboard hero/cards/evidence/filter E2E");
}
if (!packageJson.scripts?.["verify:fast-shell-self-contained"] || !/verify-fast-shell-self-contained\.js/.test(packageJson.scripts["verify:fast-shell-self-contained"])) {
  issues.push("package.json missing scripts.verify:fast-shell-self-contained for desktop fast shell helper isolation");
}
if (!packageJson.scripts?.["verify:fast-shell-regression-drill"] || !/verify-fast-shell-regression-drill\.js/.test(packageJson.scripts["verify:fast-shell-regression-drill"])) {
  issues.push("package.json missing scripts.verify:fast-shell-regression-drill for closed-loop UI regression rehearsal");
}
if (!packageJson.scripts?.["verify:post-scan-snapshot-refresh"] || !/verify-post-scan-snapshot-refresh-contract\.js/.test(packageJson.scripts["verify:post-scan-snapshot-refresh"])) {
  issues.push("package.json missing scripts.verify:post-scan-snapshot-refresh for scan-complete immediate-display contract");
}
if (!String(packageJson.scripts?.["verify:terminal-cold-start"] || "").includes("scripts/verify-terminal-cold-start-performance.js")) {
  issues.push("package.json missing scripts.verify:terminal-cold-start for terminal cold-start performance gate");
}
if (!String(packageJson.scripts?.["warm:terminal-cold-start"] || "").includes("scripts/warm-terminal-cold-start-cache.js")
  || !String(packageJson.scripts?.["verify:terminal-cold-start"] || "").includes("warm:terminal-cold-start")
  || !String(packageJson.scripts?.["verify:terminal-cold-start:strict"] || "").includes("warm:terminal-cold-start")) {
  issues.push("terminal cold-start gates must warm production API/CDN route cache before measuring fresh-browser paint");
}
if (!String(packageJson.scripts?.["verify:terminal-cold-start:strict"] || "").includes("--strict-strategy2")) {
  issues.push("package.json missing scripts.verify:terminal-cold-start:strict for snapshot-first performance gate");
}
if (!String(packageJson.scripts?.["verify:terminal-perfect"] || "").includes("verify:terminal-cold-start")) {
  issues.push("verify:terminal-perfect must include verify:terminal-cold-start");
}
if (!String(packageJson.scripts?.["monitor:terminal-cold-start"] || "").includes("scripts/monitor-terminal-cold-start-stability.js")) {
  issues.push("package.json missing scripts.monitor:terminal-cold-start for cold-start stability monitoring");
}
if (!String(packageJson.scripts?.["verify:terminal-route-stress"] || "").includes("scripts/verify-terminal-route-switch-stress.js")) {
  issues.push("package.json missing scripts.verify:terminal-route-stress for repeated tab switching stability");
}
const coldStartVerifierPath = path.join(ROOT, "scripts", "verify-terminal-cold-start-performance.js");
if (!fs.existsSync(coldStartVerifierPath)) {
  issues.push("scripts/verify-terminal-cold-start-performance.js missing terminal cold-start performance gate");
} else {
  const terminalColdStartVerifier = fs.readFileSync(coldStartVerifierPath, "utf8");
  for (const marker of ["no-sacrifice-live", "snapshot-first-strict", "STRICT_STRATEGY2_BUDGET_MS", "ROUTE_BUDGETS_MS", "FUMAN_COLD_START_ROUTES"]) {
    if (!terminalColdStartVerifier.includes(marker)) issues.push("verify-terminal-cold-start-performance.js missing " + marker);
  }
}
const coldStartMonitorPath = path.join(ROOT, "scripts", "monitor-terminal-cold-start-stability.js");
if (!fs.existsSync(coldStartMonitorPath)) {
  issues.push("scripts/monitor-terminal-cold-start-stability.js missing cold-start stability monitor");
} else {
  const coldStartMonitor = fs.readFileSync(coldStartMonitorPath, "utf8");
  for (const marker of ["FUMAN_COLD_MONITOR_ROUNDS", "p95Ms", "budgetMultiplier", "scripts/verify-terminal-cold-start-performance.js"]) {
    if (!coldStartMonitor.includes(marker)) issues.push("monitor-terminal-cold-start-stability.js missing " + marker);
  }
}
const routeStressPath = path.join(ROOT, "scripts", "verify-terminal-route-switch-stress.js");
if (!fs.existsSync(routeStressPath)) {
  issues.push("scripts/verify-terminal-route-switch-stress.js missing route switching stress gate");
} else {
  const routeStress = fs.readFileSync(routeStressPath, "utf8");
  for (const marker of ["FUMAN_STRESS_LOOPS", "market-ai", "realtime-radar", "modeTabs <= 1", "aiPanels <= 1"]) {
    if (!routeStress.includes(marker)) issues.push("verify-terminal-route-switch-stress.js missing " + marker);
  }
}
for (const scriptName of ["verify:mobile-layout", "verify:mobile-layout:live"]) {
  if (!packageJson.scripts?.[scriptName]) {
    issues.push(`package.json missing scripts.${scriptName}`);
  }
}
if (!String(packageJson.scripts?.["verify:mobile-responsive-ui"] || "").includes("mobile-phone-landscape-night")) {
  issues.push("package.json missing scripts.verify:mobile-responsive-ui for desktop/phone/tablet mobile shell checks");
}
if (!String(packageJson.scripts?.postdeploy || "").includes("verify-mobile-layout.js --live")) {
  issues.push("postdeploy must run live mobile layout verification");
}
if (!String(packageJson.scripts?.["sync:official:chip"] || "").includes("scripts/sync-official-chip-data.js")) {
  issues.push("package.json missing scripts.sync:official:chip for TWSE/TPEx chip source fallback");
}
if (!String(packageJson.scripts?.["sync:chip:sources"] || "").includes("run-chip-source-sync.ps1")) {
  issues.push("package.json missing scripts.sync:chip:sources for daily FinMind-first chip source sync");
}
if (!String(packageJson.scripts?.["verify:chip-source"] || "").includes("scripts/verify-chip-source-health.js")) {
  issues.push("package.json missing scripts.verify:chip-source for scoped chip source health verification");
}
if (!String(packageJson.scripts?.["verify:fugle-source-contract"] || "").includes("scripts/verify-fugle-source-contract.js")) {
  issues.push("package.json missing scripts.verify:fugle-source-contract for four-layer shared source contract gate");
}
if (!String(packageJson.scripts?.["verify:shared-source-readonly"] || "").includes("ops/public-slot/Test-PublicSlotSharedSourceReadOnly.ps1")) {
  issues.push("package.json missing scripts.verify:shared-source-readonly for read-only cross-computer shared source scorecard");
}
if (!String(packageJson.scripts?.["check:scanner-resource-health"] || "").includes("scripts/check-scanner-resource-health.js")) {
  issues.push("package.json missing scripts.check:scanner-resource-health for scanner publish/preserve gate");
}
if (!String(packageJson.scripts?.["strategy2:readiness"] || "").includes("scripts/check-strategy2-readiness-gate.js")) {
  issues.push("package.json missing scripts.strategy2:readiness for Strategy2 100% readiness gate");
}
if (!String(packageJson.scripts?.["strategy2:trading-day"] || "").includes("scripts/check-strategy2-trading-day.js")) {
  issues.push("package.json missing scripts.strategy2:trading-day for Strategy2 market-closed detection");
}
if (!String(packageJson.scripts?.["strategy2:readiness-source:install"] || "").includes("Install-Strategy2ReadinessSourceTask.ps1")) {
  issues.push("package.json missing scripts.strategy2:readiness-source:install for Strategy2 source collector task");
}
if (!String(packageJson.scripts?.["strategy2:snapshot:publish"] || "").includes("scripts/publish-strategy2-latest-snapshot.js")) {
  issues.push("package.json missing scripts.strategy2:snapshot:publish for Strategy2 snapshot-first cache");
}
if (!String(packageJson.scripts?.["verify:terminal-fields"] || "").includes("scripts/verify-terminal-field-completeness.js")) {
  issues.push("package.json missing scripts.verify:terminal-fields for row/card field completeness gate");
}
if (!String(packageJson.scripts?.["verify:realtime-radar-frontend-contract"] || "").includes("scripts/verify-realtime-radar-frontend-contract.js")) {
  issues.push("package.json missing scripts.verify:realtime-radar-frontend-contract for realtime radar frontend contract");
}
if (!String(packageJson.scripts?.["verify:strategy4-standard-gate"] || "").includes("scripts/verify-strategy4-standard-gate.js")) {
  issues.push("package.json missing scripts.verify:strategy4-standard-gate for Strategy4 resource/source/history/API/terminal standard gate");
}
if (!String(packageJson.scripts?.["verify:daily-battle-readiness"] || "").includes("scripts/verify-daily-battle-readiness.js")) {
  issues.push("package.json missing scripts.verify:daily-battle-readiness for all-strategy battle readiness table");
}
if (!String(packageJson.scripts?.["verify:cb-autonomy"] || "").includes("scripts/verify-cb-autonomy-readonly.js")) {
  issues.push("package.json missing scripts.verify:cb-autonomy for CB unattended self-proof");
}
if (!String(packageJson.scripts?.["verify:cb-battle"] || "").includes("scripts/verify-cb-battle-state.js")) {
  issues.push("package.json missing scripts.verify:cb-battle for CB complete-run/source-health battle gate");
}
if (!String(packageJson.scripts?.["verify:cb-alert-path"] || "").includes("scripts/verify-cb-alert-path.js")) {
  issues.push("package.json missing scripts.verify:cb-alert-path for CB alert receipt gate");
}
if (!String(packageJson.scripts?.["verify:cb-alert-path:send"] || "").includes("scripts/verify-cb-alert-path.js --send")) {
  issues.push("package.json missing scripts.verify:cb-alert-path:send for actual CB Gmail receipt proof");
}
if (!String(packageJson.scripts?.["verify:cost-governance-audit"] || "").includes("scripts/verify-cost-governance-audit.js")) {
  issues.push("package.json missing scripts.verify:cost-governance-audit for Supabase cleanup before/after audit proof");
}
if (!String(packageJson.scripts?.["verify:supabase-publish-hard-gate"] || "").includes("scripts/verify-supabase-publish-hard-gate.js")) {
  issues.push("package.json missing scripts.verify:supabase-publish-hard-gate for source coverage publish blocker");
}
if (!String(packageJson.scripts?.["verify:strategy2-source-publish-gate"] || "").includes("scripts/verify-strategy2-source-publish-gate.js")) {
  issues.push("package.json missing scripts.verify:strategy2-source-publish-gate for Strategy2 fail-closed publish gate proof");
}
if (!String(packageJson.scripts?.["verify:api-unattended-scorecard"] || "").includes("scripts/verify-api-unattended-scorecard.js")) {
  issues.push("package.json missing scripts.verify:api-unattended-scorecard for all-strategy API unattended scorecard");
}
if (!String(packageJson.scripts?.["verify:production-api-freshness"] || "").includes("scripts/verify-production-api-freshness-contract.js")) {
  issues.push("package.json missing scripts.verify:production-api-freshness for production API today/sourceCoverage/fallback/static410 contract");
}
if (!String(packageJson.scripts?.["verify:deploy-worktree-clean"] || "").includes("scripts/verify-deploy-worktree-clean.js")) {
  issues.push("package.json missing scripts.verify:deploy-worktree-clean for C:\\fuman-terminal static data dirty guard");
}
if (!String(packageJson.scripts?.["guard:mirror"] || "").includes("scripts/verify-production-mirror-guard.js")) {
  issues.push("package.json missing scripts.guard:mirror for production mirror dirty guard");
}
if (!String(packageJson.scripts?.["verify:sync-hard-gate"] || "").includes("scripts/verify-sync-hard-gate.js")) {
  issues.push("package.json missing scripts.verify:sync-hard-gate for release clone deploy preflight");
}
if (!String(packageJson.scripts?.["verify:final-readonly"] || "").includes("scripts/verify-final-readonly.js")) {
  issues.push("package.json missing scripts.verify:final-readonly for pinned read-only final verification");
}
if (!String(packageJson.scripts?.["verify:retired-artifacts"] || "").includes("scripts/verify-retired-artifacts-clean.js")) {
  issues.push("package.json missing scripts.verify:retired-artifacts for old cache/artifact rollback prevention");
}
if (!String(packageJson.scripts?.["schedule:check"] || "").includes("check-fuman-schedules.ps1")) {
  issues.push("package.json missing scripts.schedule:check for canonical scheduler policy verification");
}
if (!String(packageJson.scripts?.["schedule:retire"] || "").includes("scripts/remove-fuman-retired-schedule-tasks.ps1")) {
  issues.push("package.json missing scripts.schedule:retire for retired scheduler task cleanup");
}
if (!String(packageJson.scripts?.["schedule:migrate:freshness2010"] || "").includes("scripts/migrate-fuman-freshness-gate-2010-task.ps1")) {
  issues.push("package.json missing scripts.schedule:migrate:freshness2010 for full gate 2010 migration");
}
if (!String(packageJson.scripts?.["monitor:deploy-worktree-clean"] || "").includes("scripts/monitor-deploy-worktree-clean.js")) {
  issues.push("package.json missing scripts.monitor:deploy-worktree-clean");
}
if (!String(packageJson.scripts?.["monitor:deploy-worktree-clean:install"] || "").includes("install-deploy-worktree-clean-monitor-task.ps1")) {
  issues.push("package.json missing scripts.monitor:deploy-worktree-clean:install");
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
  if (!/run-realtime-radar\.ps1/.test(legacyGuard)) {
    issues.push("legacy-entrypoint-guard.ps1 must allow run-realtime-radar.ps1 to execute the realtime radar patrol");
  }
}

const cacheSync = read("run-cache-sync.ps1");
const gate = read("run-live-freshness-gate.ps1");
const fullScan = read("run-full-scan.ps1");
const publishGate = read("run-publish-gate.ps1");
const dailyRelease = read("run-daily-release.ps1");
const refreshDesktopSnapshot = read("refresh-desktop-route-snapshot.ps1");
const agentsGuide = read("AGENTS.md");
const postScanSnapshotAgents = read("post-scan-snapshot-refreshAGENTS.MD");
const prepareDeploy = read("scripts/prepare-deploy.js");
const deployProductionWithReleaseEnv = read("scripts/deploy-production-with-release-env.js");
const deployProductionSafe = read("scripts/deploy-production-safe.js");
const vercelCostGuard = read("scripts/verify-vercel-cost-guard.js");
const vercelProjectInventory = read("scripts/verify-vercel-project-inventory.js");
const vercelCostMonitor = read("scripts/monitor-vercel-cost-health.js");
const vercelCostMonitorInstaller = read("scripts/install-vercel-cost-health-monitor-task.ps1");
const runtimeConfig = read("terminal-runtime-config.js");
const realtimeApi = read("api/realtime.js");
const realtimeRadarApi = read("api/realtime-radar-latest.js");
const realtimeRadarCss = read("terminal-realtime-radar.css");
const openBuyLatestApi = read("api/open-buy-latest.js");
const latestStrategyApi = read("api/latest-strategy.js");
const strategy2LatestApi = read("api/strategy2-latest.js");
const strategy3LatestApi = read("api/strategy3-latest.js");
const strategy4LatestApi = read("api/strategy4-latest.js");
const strategy5LatestApi = read("api/strategy5-latest.js");
const warrantFlowLatestApi = read("api/warrant-flow-latest.js");
const institutionLatestApi = read("api/institution-latest.js");
const terminalFastBundleApi = read("api/terminal-fast-bundle.js");
const desktopRouteSnapshotCache = read("lib/desktop-route-snapshot-cache.js");
const desktopRouteSnapshotBuilder = read("lib/desktop-route-snapshot-builder.js");
const terminalHomeApi = read("api/terminal-home.js");
const mobileBootApi = read("api/mobile-boot.js");
const mobileFragmentApi = read("api/mobile-fragment.js");
const cbDetectLatestApi = read("api/cb-detect-latest.js");
const strategy4Scanner = read("scripts/scan-strategy4-cache.js");
const realtimeRadarScanner = read("scripts/scan-realtime-radar-cache.js");
const realtimeRadarFrontendContract = read("scripts/verify-realtime-radar-frontend-contract.js");
const strategy4StandardGate = read("scripts/verify-strategy4-standard-gate.js");
const cbDetectScanner = read("scripts/generate-cb-detect.js");
const runStrategy4 = read("run-strategy4.ps1");
const runOpenBuy = read("run-open-buy.ps1");
const runStrategy1Preopen = read("run-strategy1-preopen-common.ps1");
const runStrategy2Intraday = read("run-strategy2-intraday.ps1");
const runStrategy3Complete = read("run-strategy3-complete-scan.ps1");
const runStrategy3BattleVerify = read("run-strategy3-battle-verify.ps1");
const runStrategy5 = read("run-strategy5.ps1");
const runInstitution = read("run-institution.ps1");
const runWarrantFlow = read("run-warrant-flow.ps1");
const runCbDetect = read("run-cb-detect.ps1");
const runRealtimeRadar = read("run-realtime-radar.ps1");
const runChipSourceSync = read("run-chip-source-sync.ps1");
const productionHealthMonitor = read("scripts/monitor-production-health.js");
const productionHealthMonitorRunner = read("run-production-health-monitor.ps1");
const workflowAlertSender = read("scripts/send-workflow-alert.js");
const slimCacheGenerator = read("scripts/generate-slim-cache.js");
const watchlistMatchIndexGenerator = read("scripts/generate-watchlist-match-index.js");
const strategy3BattleStateVerifier = read("scripts/verify-strategy3-battle-state.js");
const strategy3AlertPathVerifier = read("scripts/verify-strategy3-alert-path.js");
const cbAutonomyVerifier = read("scripts/verify-cb-autonomy-readonly.js");
const cbAlertPathVerifier = read("scripts/verify-cb-alert-path.js");
const costGovernanceAuditVerifier = read("scripts/verify-cost-governance-audit.js");
const costGovernanceAuditPatch = read("ops/public-slot/SupabaseCostGovernanceAuditPatch_20260630.sql");
const sourceSync = read("scripts/sync-main-deploy-source.js");
const sourceSyncVerifier = read("scripts/verify-source-sync.js");
const productionGuard = read("scripts/verify-production-guard.js");
const productionMirrorGuard = read("scripts/verify-production-mirror-guard.js");
const syncHardGate = read("scripts/verify-sync-hard-gate.js");
const finalReadonlyVerifier = read("scripts/verify-final-readonly.js");
const retiredArtifactsVerifier = read("scripts/verify-retired-artifacts-clean.js");
const releaseManifestApi = read("api/release-manifest.js");
const strategy2CompleteRunPublisher = read("scripts/publish-strategy2-complete-run.js");
const strategy2SharedSource = read("lib/supabase-public-slot.js");
const strategy2SourcePublishGate = read("lib/strategy2-source-publish-gate.js");
const strategy2Scanner = read("scripts/scan-intraday-signals.js");
const supabasePublishHardGate = read("scripts/verify-supabase-publish-hard-gate.js");
const strategy2SourcePublishGateVerifier = read("scripts/verify-strategy2-source-publish-gate.js");
const apiUnattendedScorecard = read("scripts/verify-api-unattended-scorecard.js");
const productionApiFreshnessContract = read("scripts/verify-production-api-freshness-contract.js");
const apiUnattendedRunner = read("run-api-unattended-scorecard.ps1");
const apiUnattendedInstaller = read("scripts/install-api-unattended-scorecard-task.ps1");
const refreshIntradayLatestDates = read("scripts/refresh-intraday-latest-dates.js");
const warrantFlowScanner = read("scripts/scan-warrant-flow-cache.js");
const officialChipSync = read("scripts/sync-official-chip-data.js");
const chipSourceHealthVerifier = read("scripts/verify-chip-source-health.js");
const scannerResourceHealthCheck = read("scripts/check-scanner-resource-health.js");
const publishSourceGate = read("scripts/check-publish-source-gate.js");
const strategy2ReadinessGate = read("scripts/check-strategy2-readiness-gate.js");
const strategy2TradingDayGate = read("scripts/check-strategy2-trading-day.js");
const postScanSnapshotVerifier = read("scripts/verify-post-scan-snapshot-refresh-contract.js");
const strategy2BattleStateVerifier = read("scripts/verify-strategy2-battle-state.js");
const strategy5BattleVerifier = read("scripts/verify-strategy5-battle-state.js");
const scannerResourceHealthRunner = read("scanner-resource-health.ps1");
const runIdCompleteGate = read("scripts/verify-run-id-complete-gates.js");
const terminalLiveCheck = read("terminal-live-check.js");
const terminalSourceContracts = read("scripts/verify-terminal-source-contracts.js");
const terminalApp = read("terminal-app.js");
const marketAiLiveWatchdog = read("terminal-market-ai-live-watchdog.js");
const marketAiLiveApi = read("api/market-ai-live.js");
const desktopFastShell = read("terminal-desktop-fast-shell.js");
const mobileShell = read("mobile.html");
const mobileHealthVerifier = read("scripts/verify-mobile-health.js");
const mobileApiOnlyVerifier = read("scripts/verify-mobile-api-only.js");
const mobileAiFragmentVerifier = read("scripts/verify-mobile-ai-fragment.js");
const mobileUpdateEventPublisher = read("scripts/publish-mobile-update-event.js");
const runtimePaths = read("scripts/runtime-paths.js");
const dataQualityReportGenerator = read("scripts/generate-data-quality-report.js");
const consistencyReportGenerator = read("scripts/generate-consistency-report.js");
const signalQualityReportGenerator = read("scripts/generate-signal-quality-report.js");
const performanceReportGenerator = read("scripts/generate-performance-report.js");
const strategyWeightReportGenerator = read("scripts/generate-strategy-weight-report.js");
const stocksSlimGenerator = read("scripts/generate-stocks-slim.js");
const scorecardApi = read("api/scorecard.js");
const scorecardPage = read("88.html");
const scorecardSnapshotRunner = read("run-scorecard-snapshot.ps1");
const publicSlotSharedSourceRunner = read("ops/public-slot/Run-PublicSlotSharedSource.ps1");
const publicSlotSupabaseSource = read("ops/public-slot/SupabasePublicSlotSource.ps1");
const publicSlotRuntimeConfigExample = read("ops/public-slot/public-slot-shared-source.config.example.json");
const publicSlotAntiRollbackGuard = read("ops/public-slot/Guard-PublicSlotSourceAntiRollback.ps1");
const fugleWebsocketCollector = read("scripts/fugle-websocket-collector.js");
const publicSlotFugleWebsocketCollector = read("ops/public-slot/fugle-websocket-collector.js");
const publicSlotSharedSourceStarter = read("ops/public-slot/Start-PublicSlotSharedSource.cmd");
const strategy2ReadinessSourceStarter = read("ops/public-slot/Start-Strategy2ReadinessSource.cmd");
const strategy2ReadinessSourceInstaller = read("ops/public-slot/Install-Strategy2ReadinessSourceTask.ps1");
const publicSlotSharedSourceWatchdogInstaller = read("ops/public-slot/Install-PublicSlotSharedSourceWatchdog.ps1");
const strategy2ReadinessSql = [
  read("ops/public-slot/Strategy2ReadinessContractCache.sql"),
  read("ops/public-slot/Strategy2Readiness100SourcePatch.sql"),
].join("\n");
const intraday1mCoverageStatsRpcSql = read("ops/public-slot/FugleSourceLiveRepairB6_Intraday1mCoverageStatsRpc_20260630.sql");
const sharedSourceReadonlyScorecardSql = read("ops/public-slot/SharedSourceReadOnlyScorecardPatch_20260701.sql");
const sharedSourceReadonlyVerifier = read("ops/public-slot/Test-PublicSlotSharedSourceReadOnly.ps1");
if (!/dataManifest:\s*""/.test(runtimeConfig)) {
  issues.push("terminal-runtime-config.js dataManifest must be an empty string; static JSON manifest polling must stay disabled");
}
for (const marker of [
  "production API must expose tradeDate=today after due window",
  "sourceCoverage ready",
  "fallback disclosure",
  "retired static JSON 410",
  "/data/open-buy-latest.json",
  "/data/strategy2-intraday-latest.json",
  "/data/strategy3-latest.json",
  "/data/strategy4-latest.json",
  "/data/strategy5-latest.json",
  "/data/institution-latest.json",
  "/data/warrant-flow-latest.json",
  "/data/cb-detect-latest.json",
  "/data/realtime-radar-latest.json",
]) {
  if (!productionApiFreshnessContract.includes(marker)) {
    issues.push(`verify-production-api-freshness-contract.js missing production API freshness marker ${marker}`);
  }
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
], LEGACY_SYNC_TREE_RE, "must not depend on the legacy sync tree in production runtime or deploy flow");
assertNoPatternInExistingFiles([
  "terminal-runtime-config.js",
  "api/desktop-route-snapshot.js",
  "api/terminal-fast-bundle.js",
  "api/scorecard.js",
  "api/scorecard-health.js",
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
if (!/scorecard_latest/.test(scorecardApi) || !/readSnapshot/.test(scorecardApi) || !/scorecard-latest\.json/.test(scorecardApi)) {
  issues.push("api/scorecard.js must read Supabase snapshot scorecard_latest and keep data/scorecard-latest.json only as fallback/bootstrap");
}
for (const marker of ["scorecard-rule-group", "scorecard-rule-tags", "scorecard-followup", "策略項目", "策略細項", "7日追蹤", "rowRuleGroup", "rowRuleTags", "rowFollowup", "cleanReason"]) {
  if (!scorecardPage.includes(marker)) issues.push(`88.html missing scorecard rule-column UI marker ${marker}`);
}
for (const marker of ["規則版本=", "策略項目=", "策略細項=", "7日追蹤=", "追蹤狀態="]) {
  if (!scorecardPage.includes(marker)) issues.push(`88.html must clean scorecard machine marker ${marker} from reason display`);
}
for (const marker of ["scorecard-snapshot-retired", "run-scorecard-daily-automation.ps1", "DuckDB fallback is disabled"]) {
  if (!scorecardSnapshotRunner.includes(marker)) issues.push(`run-scorecard-snapshot.ps1 must stay retired wrapper and include ${marker}`);
}
for (const marker of ["scorecard.duckdb", "export-scorecard-snapshot.py"]) {
  if (scorecardSnapshotRunner.includes(marker)) issues.push(`run-scorecard-snapshot.ps1 must not restore legacy ${marker} flow`);
}
if (!/verify:publish-gate/.test(prepareDeploy)) {
  issues.push("scripts/prepare-deploy.js must run verify:publish-gate before production deploy");
}
for (const marker of ["FUMAN_DEPLOY_LOCK_FILE", "fuman-vercel-deploy.lock", "FUMAN_ALLOW_DUPLICATE_DEPLOY", "verify-sync-hard-gate.js", "verify-vercel-cost-guard.js", "verify-vercel-project-inventory.js", "deploy-production-with-release-env.js", "require-version-bump-approval.js"]) {
  if (!deployProductionSafe.includes(marker)) issues.push(`deploy-production-safe.js missing guarded deploy marker ${marker}`);
}
for (const marker of ["FUMAN_VERCEL_CRON_DAILY_BUDGET", "/api/desktop-route-snapshot-refresh", "/api/production-health", "@vercel/analytics", "@vercel/speed-insights", ".vercelignore", "outputs/", "cronInvocationsPerActiveDay"]) {
  if (!vercelCostGuard.includes(marker)) issues.push(`verify-vercel-cost-guard.js missing cost guard marker ${marker}`);
}
for (const marker of ["FUMAN_VERCEL_PROJECT_STRICT", "fuman-terminal", "fuman-terminal-strategy3", "fuman-terminal-strategy4", "fuman-terminal-strategy5-unattended", "fuman-strategy1-clean", "fuman-watchlist-limit", "unexpected Fuman Vercel project", "vercel", "project", "ls", "--format=json"]) {
  if (!vercelProjectInventory.includes(marker)) issues.push(`verify-vercel-project-inventory.js missing project inventory marker ${marker}`);
}
for (const marker of ["send-workflow-alert.js", "vercel_cost_health_failed", "verify-vercel-cost-guard.js", "verify-vercel-project-inventory.js", "verify-production-mirror-guard.js", "vercel-cost-health-status.json"]) {
  if (!vercelCostMonitor.includes(marker)) issues.push(`monitor-vercel-cost-health.js missing Vercel cost monitor marker ${marker}`);
}
for (const marker of ["Fuman Vercel Cost Health Monitor 2115", "Register-ScheduledTask", "run-vercel-cost-health-monitor.ps1", "21:15"]) {
  if (!vercelCostMonitorInstaller.includes(marker)) issues.push(`install-vercel-cost-health-monitor-task.ps1 missing Vercel cost monitor task marker ${marker}`);
}
if (!/verify:vercel-cost/.test(prepareDeploy) || !/verify:vercel-projects/.test(prepareDeploy)) {
  issues.push("scripts/prepare-deploy.js must run verify:vercel-cost and verify:vercel-projects before production deploy");
}
if (!read("run-vercel-cost-health-monitor.ps1").includes("monitor-vercel-cost-health.js") || !read("run-vercel-cost-health-monitor.ps1").includes("--use-system-ca")) {
  issues.push("run-vercel-cost-health-monitor.ps1 missing monitor runner markers");
}

for (const marker of ["FUMAN_RELEASE_SHA", "FUMAN_DEPLOY_SHA", "FUMAN_DEPLOY_ID", "--env", "vercel", "rev-parse"]) {
  if (!deployProductionWithReleaseEnv.includes(marker)) issues.push(`deploy-production-with-release-env.js missing release env marker ${marker}`);
}
if (!/verify:sync-hard-gate/.test(prepareDeploy)) {
  issues.push("scripts/prepare-deploy.js must run verify:sync-hard-gate before production deploy");
}
if (!/verify:retired-artifacts/.test(prepareDeploy)) {
  issues.push("scripts/prepare-deploy.js must run verify:retired-artifacts before production deploy");
}
if (!/verify:publish-gate/.test(publishGate)) {
  issues.push("run-publish-gate.ps1 must run verify:publish-gate before freshness publish");
}
for (const marker of ["production mirror is dirty", "status\", \"--porcelain=v1\"", "FUMAN_RELEASE_SHA", "FUMAN_DEPLOY_SHA"]) {
  if (!productionMirrorGuard.includes(marker)) issues.push(`verify-production-mirror-guard.js missing mirror guard marker ${marker}`);
}
for (const marker of ["verify-production-mirror-guard.js", "production mirror only", "release/deploy gates from the release clone"]) {
  if (!syncHardGate.includes(marker)) issues.push(`verify-sync-hard-gate.js missing release clone/mirror marker ${marker}`);
}
for (const marker of ["FUMAN_RELEASE_SHA is required", "mode: \"read-only\"", "/api/release-manifest", "/api/production-health", "/api/terminal-fast-bundle"]) {
  if (!finalReadonlyVerifier.includes(marker)) issues.push(`verify-final-readonly.js missing pinned read-only final verify marker ${marker}`);
}
for (const marker of ["release manifest deployId missing", "deployId: manifest.deployId || manifest.deploymentId || \"\""]) {
  if (!finalReadonlyVerifier.includes(marker)) issues.push(`verify-final-readonly.js missing release deployId gate marker ${marker}`);
}
if (/writeFileSync|appendFileSync|freshness:gate|write-desktop-route-snapshot|publish-mobile-update-event|run-daily-release|run-full-scan/.test(finalReadonlyVerifier)) {
  issues.push("verify-final-readonly.js must stay read-only and must not write files, publish mobile events, run scans, or refresh snapshots");
}
for (const marker of ["EXACT_RETIRED", "retired artifacts must not be tracked in source", "retired artifacts must not exist in source", "git ls-files"]) {
  if (!retiredArtifactsVerifier.includes(marker)) issues.push(`verify-retired-artifacts-clean.js missing retired artifact guard marker ${marker}`);
}
for (const marker of ["Fuman Public Slot Shared Source Watchdog", "Register-ScheduledTask", "-RepetitionInterval", "-RepetitionDuration", "RepeatDurationDays = 3650"]) {
  if (!publicSlotSharedSourceWatchdogInstaller.includes(marker)) {
    issues.push(`Install-PublicSlotSharedSourceWatchdog.ps1 missing durable watchdog schedule marker ${marker}`);
  }
}
for (const marker of ["twse:T86", "tpex:3itrade_hedge_result", "twse:MI_MARGN", "tpex:margin_balance", "keepOfficialOnlyForFinMindGaps"]) {
  if (!officialChipSync.includes(marker)) issues.push(`sync-official-chip-data.js missing official chip fallback marker ${marker}`);
}
for (const marker of ["sync:finmind:chip", "sync:official:chip", "verify:chip-source", "FinMind chip sync failed; continuing to official source gap fill"]) {
  if (!runChipSourceSync.includes(marker)) issues.push(`run-chip-source-sync.ps1 missing chip source pipeline marker ${marker}`);
}
for (const marker of ["v_institution_source_health", "v_chip_flows_latest", "coverage_status", "CHIP_SOURCE_HEALTH_MAX_AGE_DAYS"]) {
  if (!chipSourceHealthVerifier.includes(marker)) issues.push(`verify-chip-source-health.js missing chip source health marker ${marker}`);
}
for (const marker of ["v_scanner_resource_health", "ready", "stale", "not_ready", "failed", "STRATEGY_ALIASES"]) {
  if (!scannerResourceHealthCheck.includes(marker)) issues.push(`check-scanner-resource-health.js missing scanner resource health marker ${marker}`);
}
for (const marker of ["v_strategy2_readiness_status", "strategy2_ready_100", "missing_summary", "sourceStatus", "readiness"]) {
  if (!scannerResourceHealthCheck.includes(marker)) issues.push(`check-scanner-resource-health.js missing Strategy2 readiness marker ${marker}`);
}
for (const marker of ["isTwseTradingDay", "market_closed", "v_strategy2_readiness_status", "strategy2_ready_100", "missing_summary", "sourceStatus", "source_status", "sourceGate", "cleanNumber", "mother_pool_symbols", "fresh_quote_coverage_120s", "today_1m_symbols", "quote_derived_1m_full_universe", "intraday_1m_stale_seconds", "readiness"]) {
  if (!scannerResourceHealthCheck.includes(marker)) issues.push(`check-scanner-resource-health.js missing Strategy2 market/readiness marker ${marker}`);
}
for (const marker of ["isTwseTradingDay", "market_closed", "v_strategy2_readiness_status", "v_strategy2_readiness_missing", "publishAllowed", "preserve latest complete run", "refresh_strategy2_readiness_cache"]) {
  if (!strategy2ReadinessGate.includes(marker)) issues.push(`check-strategy2-readiness-gate.js missing Strategy2 readiness gate marker ${marker}`);
}
for (const marker of [
  "publish-source-gate-v1",
  "check-strategy2-supabase-coverage.js",
  "check-scanner-resource-health.js",
  "send-workflow-alert.js",
  "publishAllowed",
  "mustPreserveLatest",
  "allowLatestWrite",
  "preservePreviousCompleteRun",
  "freshQuoteCoverage120s",
  "today1mSymbols",
  "readyGe35",
  "latestCandleTime",
  "intraday1mStaleSeconds",
  "preopenCoverage",
  "dailyVolumeFreshness",
  "fallbackUsed",
  "writeBudget",
  "retentionOk",
]) {
  if (!publishSourceGate.includes(marker)) issues.push(`check-publish-source-gate.js missing publish source gate marker ${marker}`);
}
if (!String(packageJson.scripts?.["publish:source-gate"] || "").includes("scripts/check-publish-source-gate.js")) {
  issues.push("package.json publish:source-gate must run scripts/check-publish-source-gate.js");
}
if (!read("run-publish-gate.ps1").includes("npm.cmd run publish:source-gate")) {
  issues.push("run-publish-gate.ps1 must run publish:source-gate before verify:publish-gate");
}
for (const marker of ["isTwseTradingDay", "market_closed", "closed-exit-code", "skip Strategy2 readiness source collectors"]) {
  if (!strategy2TradingDayGate.includes(marker)) issues.push(`check-strategy2-trading-day.js missing Strategy2 market-closed marker ${marker}`);
}
for (const marker of ["refresh_strategy2_readiness_cache", "strategy2 readiness cache refreshed", "refresh_strategy2_preopen_hot_gate_cache", "strategy2 preopen hot gate cache refreshed", "strategy2 ready cache full-cycle refreshed", "strategy2 ready cache partial refresh", "strategy2 ready cache incomplete full-cycle", "rpc_failed", "missing_total_expected", "next_offset", "total_expected", "Get-Strategy2ReadyRefreshMaxPages", "strategy2ReadyRpcOk"]) {
  if (!publicSlotSharedSourceRunner.includes(marker)) issues.push(`Run-PublicSlotSharedSource.ps1 missing Strategy2 readiness refresh marker ${marker}`);
}
if (/\$readyPage\s*=\s*0;\s*\$readyPage\s*-lt\s*12;/.test(publicSlotSharedSourceRunner)) {
  issues.push("Run-PublicSlotSharedSource.ps1 must not cap Strategy2 ready cache refresh at 12 pages; it must run the full stock pool until next_offset=0");
}
for (const marker of [
  "public-slot-shared-source.json",
  "Apply-PublicSlotRuntimeConfig",
  "FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC",
  "FUMAN_PUBLIC_SLOT_UPSERT_BATCH_SIZE",
  "FUMAN_PUBLIC_SLOT_FUTOPT_QUOTE_DELAY_MS",
  "FutoptQuoteDelayMilliseconds",
  "WritePreopenRows",
  "WritePreopenRowsMode",
  "Test-ShouldWritePreopenRows",
  "Strategy2ReadyPageSize",
  "Strategy2ReadyMaxPages",
  "Get-Strategy2ReadyEffectivePageSize",
  "Get-Strategy2ReadyRefreshBody",
  "Invoke-Direct1mStartupPrewarm",
  "PreferHistorical",
  "Direct1mPrewarmBars",
  "direct_1m_prewarm_target_symbols",
  "direct_1m_prewarm_complete",
  "QuoteDerived1mCandidateCount",
  "QuoteDerivedOpeningBackfillMinutes",
  "Intraday1mFreshHardSeconds",
  "FugleCollectorBatchSize",
  "FUGLE_COLLECTOR_CONCURRENCY",
  "FUGLE_COLLECTOR_QUOTE_TTL_MS",
  "OpeningBoostStart",
  "OpeningBoostEnd",
  "RestQuoteOpeningBoostBatchSize",
  "FUGLE_COLLECTOR_OPENING_BOOST_BATCH_SIZE",
  "progressive quote fill",
  "FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED",
  "FugleCollectorFinMindRecoveryEnabled",
  "PrioritySymbolsFile",
  "fugle-ws-priority-symbols.json",
  "Get-StrategyPrioritySymbols",
  "Get-ThreeDayOpenHighFadeSymbols",
  "Get-DynamicAmplitudeBullSymbols",
  "Get-DynamicVolumeSurgeSymbols",
  "strategy_priority_symbols",
  "three_day_open_high_fade_symbols",
  "dynamic_amplitude_bull_symbols",
  "dynamic_volume_surge_symbols",
  "collector_adaptive_rpm",
  "collector_priority_symbols",
  "Add-FreshQuoteReadthrough",
  "Get-FreshPublicSlotQuoteRows",
  "fresh_quote_readthrough_rows",
  "rest_quote_effective_batch_size",
  "rest_quote_unsupported_symbols",
  "unsupported_trade_date",
  "WriterOwnerComputer",
  "FUMAN_PUBLIC_SLOT_WRITER_OWNER_COMPUTER",
  "Assert-PublicSlotWriterOwner",
  "writer_owner_computer",
  "quoteFullCoverageFloor",
  "Get-ActiveCommonStockSymbols",
  "stock_universe",
  "mother_pool_source",
  "quote_derived_1m_full_universe",
  "quote_derived_1m_current_minute",
  "quote_derived_1m_rows",
  "quote_derived_1m_opening_backfill_rows",
  "fresh_quote_coverage_120s",
  "volume_strategy_usable",
]) {
  if (!publicSlotSharedSourceRunner.includes(marker)) issues.push(`Run-PublicSlotSharedSource.ps1 missing runtime tuning marker ${marker}`);
}
for (const marker of [
  "Write-PublicSlotFutoptQuotesLive",
  "underlying_symbol",
  "underlying_name",
  "hasUnderlyingColumns",
  "ConvertTo-PublicSlotPayloadHashtable",
]) {
  if (!publicSlotSupabaseSource.includes(marker)) issues.push(`SupabasePublicSlotSource.ps1 missing futopt underlying quote marker ${marker}`);
}
for (const marker of [
  "OPENING_BOOST_START",
  "OPENING_BOOST_END",
  "OPENING_BOOST_BATCH_SIZE",
  "FINMIND_RECOVERY_ENABLED",
  "fetchFinMindRecoveryQuotes",
  "finmindRecoveryFetched",
  "effectiveCollectorConfig",
  "openingBoostActive",
  "PRIORITY_SYMBOLS_FILE",
  "readPrioritySymbols",
  "selectStaleFirstBatch(symbols, batchSize, unsupported, prioritySymbols",
  "adaptiveRpm",
  "priorityThreeDayOpenHighFadeSymbols",
  "REQUEST_TIMEOUT_MS",
  "REQUEST_RETRIES",
]) {
  if (!fugleWebsocketCollector.includes(marker)) issues.push(`scripts/fugle-websocket-collector.js missing opening quote boost marker ${marker}`);
}
for (const marker of [
  "OPENING_BOOST_START",
  "OPENING_BOOST_END",
  "OPENING_BOOST_BATCH_SIZE",
  "FINMIND_RECOVERY_ENABLED",
  "fetchFinMindRecoveryQuotes",
  "finmindRecoveryFetched",
  "effectiveCollectorConfig",
  "openingBoostActive",
  "PRIORITY_SYMBOLS_FILE",
  "readPrioritySymbols",
  "selectStaleFirstBatch(symbols, batchSize, unsupported, prioritySymbols",
  "adaptiveRpm",
  "priorityThreeDayOpenHighFadeSymbols",
  "REQUEST_TIMEOUT_MS",
  "REQUEST_RETRIES",
]) {
  if (!publicSlotFugleWebsocketCollector.includes(marker)) issues.push(`ops/public-slot/fugle-websocket-collector.js missing opening quote boost marker ${marker}`);
}
for (const marker of [
  "FUMAN_PUBLIC_SLOT_UPSERT_TIMEOUT_SEC",
  "FUMAN_PUBLIC_SLOT_UPSERT_BATCH_SIZE",
  "safeBatchSize",
  "Array]::Copy",
  "TimeoutSec",
  "BatchSize",
]) {
  if (!publicSlotSupabaseSource.includes(marker)) issues.push(`SupabasePublicSlotSource.ps1 missing runtime upsert tuning marker ${marker}`);
}
for (const marker of [
  "\"stopAt\": \"14:05\"",
  "publicSlotUpsertTimeoutSec",
  "publicSlotUpsertBatchSize",
  "futoptQuoteDelayMilliseconds",
  "restQuoteDelayMilliseconds",
  "openingBoostStart",
  "openingBoostEnd",
  "restQuoteOpeningBoostBatchSize",
  "restQuoteOpeningBoostDelayMilliseconds",
  "fugleCollectorLoopMilliseconds",
  "fugleCollectorBatchSize",
  "fugleCollectorConcurrency",
  "fugleCollectorRequestDelayMilliseconds",
  "fugleCollectorQuoteTtlMilliseconds",
  "fugleCollectorOpeningBoostBatchSize",
  "fugleCollectorOpeningBoostConcurrency",
  "fugleCollectorOpeningBoostDelayMilliseconds",
  "fugleCollectorFinMindRecoveryEnabled",
  "fugleCollectorFinMindRecoveryTimeoutMilliseconds",
  "writePreopenRows",
  "writePreopenRowsMode",
  "strategy2ReadyPageSize",
  "minAvgVolume5Lots",
  "direct1mPrewarmEnabled",
  "direct1mPrewarmStart",
  "direct1mPrewarmSymbolCount",
  "direct1mPrewarmBatchSize",
  "direct1mPrewarmBars",
  "quoteDerived1mCandidateCount",
  "quoteDerived1mMaxQuoteAgeSeconds",
  "quoteDerivedOpeningBackfillMinutes",
  "intraday1mFreshTargetSeconds",
  "intraday1mFreshHardSeconds",
  "writerOwnerComputer",
  "readOnlyMonitor",
]) {
  if (!publicSlotRuntimeConfigExample.includes(marker)) issues.push(`public-slot-shared-source.config.example.json missing ${marker}`);
}
if (/\"stopAt\"\s*:\s*\"12:05\"/.test(publicSlotRuntimeConfigExample)) {
  issues.push("public-slot-shared-source.config.example.json must not stop shared source at 12:05");
}
for (const marker of [
  "Test-RepoRuntimeConfigSupport",
  "Test-RuntimeConfig",
  "Write-DefaultRuntimeConfig",
  "public-slot-shared-source.json",
  "stopAt = \"14:05\"",
  "runtime config guard",
  "fugle-source-contract-20260629-01",
  "Write-PublicSlotSourceCoverageSnapshot",
  "source_contract_version",
  "warmup_candle_count",
  "continuous_candle_count",
  "ready_ma20_continuous_symbols",
  "ready_ma35_continuous_symbols",
  "Invoke-Direct1mStartupPrewarm",
  "Direct1mPrewarmBars",
  "direct_1m_prewarm_target_symbols",
  "direct_1m_prewarm_complete",
  "QuoteDerived1mCandidateCount",
  "QuoteDerivedOpeningBackfillMinutes",
  "Intraday1mFreshHardSeconds",
  "FugleCollectorBatchSize",
  "FUGLE_COLLECTOR_CONCURRENCY",
  "FUGLE_COLLECTOR_QUOTE_TTL_MS",
  "OpeningBoostStart",
  "OpeningBoostEnd",
  "RestQuoteOpeningBoostBatchSize",
  "FUGLE_COLLECTOR_OPENING_BOOST_BATCH_SIZE",
  "FUGLE_COLLECTOR_FINMIND_RECOVERY_ENABLED",
  "FugleCollectorFinMindRecoveryEnabled",
  "PrioritySymbolsFile",
  "fugle-ws-priority-symbols.json",
  "Get-StrategyPrioritySymbols",
  "Get-ThreeDayOpenHighFadeSymbols",
  "Get-DynamicAmplitudeBullSymbols",
  "Get-DynamicVolumeSurgeSymbols",
  "strategy_priority_symbols",
  "three_day_open_high_fade_symbols",
  "dynamic_amplitude_bull_symbols",
  "dynamic_volume_surge_symbols",
  "collector_adaptive_rpm",
  "collector_priority_symbols",
  "Add-FreshQuoteReadthrough",
  "Get-FreshPublicSlotQuoteRows",
  "WriterOwnerComputer",
  "FUMAN_PUBLIC_SLOT_WRITER_OWNER_COMPUTER",
  "Assert-PublicSlotWriterOwner",
  "writer_owner_computer",
  "quote_derived_1m_full_universe",
  "quote_derived_1m_current_minute",
  "quote_derived_1m_rows",
  "quote_derived_1m_opening_backfill_rows",
  "fresh_quote_coverage_120s",
  "latest_candle_time_taipei",
]) {
  if (!publicSlotAntiRollbackGuard.includes(marker)) issues.push(`Guard-PublicSlotSourceAntiRollback.ps1 missing safe runtime guard marker ${marker}`);
}
if (/stopAt\s*=\s*"12:05"/.test(publicSlotAntiRollbackGuard)) {
  issues.push("Guard-PublicSlotSourceAntiRollback.ps1 must not restore runtime stopAt=12:05");
}
if (/Set-Content\s+-LiteralPath\s+\$path|Repair-CmdEntrypoints|Repair-RunnerText|Repair-HelperText|Repair-RepoRuntimeConfigSupport|RunnerSnapshotPath|repo runner repaired|Copy-Item[\s\S]{0,160}-Destination\s+\$RunnerPath/.test(publicSlotAntiRollbackGuard)) {
  issues.push("Guard-PublicSlotSourceAntiRollback.ps1 must not rewrite tracked public-slot source files");
}
for (const marker of ["check-strategy2-trading-day.js", "--closed-exit-code=10", "FutoptQuoteEverySeconds 20", "Direct1mEverySeconds 20", "Strategy2ReadyRefreshEnabled:$true", "08:45 futopt", "08:55 preopen", "08:45-13:35"]) {
  if (!strategy2ReadinessSourceStarter.includes(marker)) issues.push(`Start-Strategy2ReadinessSource.cmd missing Strategy2 readiness source marker ${marker}`);
}
if (/-StopAt 12:05/.test(publicSlotSharedSourceStarter) || /-StopAt 12:05/.test(strategy2ReadinessSourceStarter)) {
  issues.push("public-slot source cmd entrypoints must not pass -StopAt 12:05");
}
for (const [name, text] of [
  ["Start-PublicSlotSharedSource.cmd", publicSlotSharedSourceStarter],
  ["Start-Strategy2ReadinessSource.cmd", strategy2ReadinessSourceStarter],
]) {
  for (const marker of ["-RestQuoteBatchSize 240", "-RestQuoteDelayMilliseconds 40", "-RestQuoteOpeningBoostBatchSize 180", "-RestQuoteOpeningBoostDelayMilliseconds 80", "-FugleCollectorBatchSize 320", "-FugleCollectorConcurrency 4", "-FugleCollectorRequestDelayMilliseconds 20"]) {
    if (text.includes(marker)) issues.push(`${name} must not pass old high-rate public-slot quote setting ${marker}`);
  }
}
for (const marker of ["Fuman Strategy2 Readiness Source 0800", "Start-Strategy2ReadinessSource.cmd", "schtasks /Create", "/SC DAILY"]) {
  if (!strategy2ReadinessSourceInstaller.includes(marker)) issues.push(`Install-Strategy2ReadinessSourceTask.ps1 missing Strategy2 readiness task marker ${marker}`);
}
for (const marker of ["strategy2_readiness_status_cache", "strategy2_readiness_missing_cache", "refresh_strategy2_readiness_cache", "v_strategy2_readiness_status", "v_strategy2_readiness_missing", "stale_quote", "missing_3_snapshots_last_1m", "intraday_1m_not_ready_ma35_continuous", "continuous_candle_count", "ready_ma35_continuous", "strategy2_preopen_hot_gate_cache", "current_tradable_contract_month", "paged_strategy2_intraday_ready_cache"]) {
  if (!strategy2ReadinessSql.includes(marker)) issues.push(`Strategy2ReadinessContractCache.sql missing Strategy2 readiness SQL marker ${marker}`);
}
for (const marker of ["get_fugle_intraday_1m_coverage_stats", "idx_fugle_intraday_1m_symbol_candle_time_desc", "p_symbols text[]", "intraday_1m_stale_seconds"]) {
  if (!intraday1mCoverageStatsRpcSql.includes(marker)) issues.push(`FugleSourceLiveRepairB6_Intraday1mCoverageStatsRpc_20260630.sql missing coverage RPC marker ${marker}`);
}
if (/today_candle_count\s*>\s*0\s+and\s+continuous_candle_count\s*>=\s*(20|35|80|200)/i.test(intraday1mCoverageStatsRpcSql)) {
  issues.push("FugleSourceLiveRepairB6_Intraday1mCoverageStatsRpc_20260630.sql must not require today_candle_count > 0 for MA readiness; historical 1m warmup must count");
}
for (const marker of [
  "v_fuman_shared_source_readonly_scorecard",
  "fresh_quote_readthrough_rows",
  "fresh_quote_readthrough_merged_rows",
  "rest_quote_effective_batch_size",
  "opening_boost_active",
  "futopt_stock_this_loop",
  "writer_owner_computer",
  "collector_primary_source",
  "collector_fallback_source",
  "finmind_recovery_fetched",
  "finmind_recovery_error",
  "finmind_recovery_cooldown_until",
  "rest_quote_unsupported_symbols",
  "rest_quote_unsupported_this_loop",
  "strategy_priority_symbols",
  "three_day_open_high_fade_symbols",
  "dynamic_amplitude_bull_symbols",
  "dynamic_volume_surge_symbols",
  "collector_priority_symbols",
  "collector_adaptive_rpm",
  "websocket_status",
  "readonly_verdict",
  "grant select",
]) {
  if (!sharedSourceReadonlyScorecardSql.includes(marker)) issues.push(`SharedSourceReadOnlyScorecardPatch_20260701.sql missing read-only visibility marker ${marker}`);
}
if (/insert\s+into|update\s+public\.source_status|delete\s+from|truncate\s+/i.test(sharedSourceReadonlyScorecardSql)) {
  issues.push("SharedSourceReadOnlyScorecardPatch_20260701.sql must stay read-only except schema/view grants; no data writes or source_status overwrites");
}
for (const marker of [
  "v_fuman_shared_source_readonly_scorecard",
  "mode = \"read-only\"",
  "fresh_quote_coverage_120s",
  "scanner_can_run_quote_only",
  "scanner_can_run_opening",
  "intraday_1m_stale_seconds",
  "ready_ma35_continuous",
  "futopt_stock_mapped",
  "opening_boost_not_active_while_coverage_low",
  "rest_quote_rate_limited_while_coverage_low",
  "fresh_quote_readthrough_not_running",
  "rest_quote_effective_batch_zero",
  "strategyPrioritySymbols",
  "dynamicMotherPoolSymbols",
  "collectorAdaptiveRpm",
]) {
  if (!sharedSourceReadonlyVerifier.includes(marker)) issues.push(`Test-PublicSlotSharedSourceReadOnly.ps1 missing read-only verifier marker ${marker}`);
}
if (/Write-PublicSlot|Invoke-PublicSlotUpsert|Invoke-RestMethod[\s\S]{0,120}-Method\s+(Post|Patch|Delete)|Set-Content|Add-Content|Out-File/i.test(sharedSourceReadonlyVerifier)) {
  issues.push("Test-PublicSlotSharedSourceReadOnly.ps1 must stay read-only: no writes, no source_status overwrite, no local cache/runtime output");
}
if (!publicSlotSharedSourceRunner.includes("get_fugle_intraday_1m_coverage_stats")) {
  issues.push("Run-PublicSlotSharedSource.ps1 must prefer get_fugle_intraday_1m_coverage_stats before REST batch fallback");
}
if (/v_fugle_intraday_1m_status\?select=\$statusSelect&has_today_data=eq\.true/.test(publicSlotSharedSourceRunner)) {
  issues.push("Run-PublicSlotSharedSource.ps1 must not filter v_fugle_intraday_1m_status by has_today_data when counting MA readiness");
}
if (!strategy2ReadinessSql.includes("refresh_strategy2_intraday_ready_cache(500, false)") || !strategy2ReadinessSql.includes("refresh_strategy2_intraday_ready_cache(500, true)")) {
  issues.push("Strategy2Readiness100SourcePatch.sql must use 500-row refresh wrappers for intraday ready cache");
}
if (/refresh_strategy2_intraday_ready_cache\(250,\s*(true|false)\)/.test(strategy2ReadinessSql)) {
  issues.push("Strategy2Readiness100SourcePatch.sql must not use 250-row refresh wrappers");
}
for (const file of [
  "ops/public-slot/Strategy2Readiness100SourcePatch.sql",
  "ops/public-slot/Strategy2ReadinessContractCache.sql",
  "ops/public-slot/SupabasePublicSlot-StrategyViewsAndHealthPatch.sql",
  "lib/supabase-public-slot.js",
  "scripts/verify-strategy2-battle-state.js",
]) {
  const text = read(file);
  if (/today_candle_count\W*>=\W*(20|35)|rows_today\W*>=\W*(20|35)/.test(text)) issues.push(`${file} must not use today-only candle count as MA readiness`);
  if (/intraday_1m_not_ready_ge_35/.test(text)) issues.push(`${file} must not use old intraday_1m_not_ready_ge_35 reason`);
}
for (const marker of ["Invoke-ScannerResourceHealthGate", "PublishAllowed", "FallbackWarningOnly", "PreserveLatest", "market_closed"]) {
  if (!scannerResourceHealthRunner.includes(marker)) issues.push(`scanner-resource-health.ps1 missing scanner gate marker ${marker}`);
}
for (const marker of ["Get-HttpErrorSummary", "Test-ControlledPreopenRefreshFailure", "strategy1_preopen_refresh_statement_timeout", "controlled preopen refresh failure", "preserve latest complete run"]) {
  if (!runStrategy1Preopen.includes(marker)) issues.push(`run-strategy1-preopen-common.ps1 missing Strategy1 controlled preopen marker ${marker}`);
}
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
if (!/CACHE_SYNC_ALLOW_GIT_DATA_COMMIT/.test(cacheSync) || !/SCHEDULED_CACHE_GIT_COMMIT_DISABLED/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must block automatic scheduled cache data commits unless CACHE_SYNC_ALLOW_GIT_DATA_COMMIT=1 is explicitly set");
}
if (!/CACHE_SYNC_ALLOW_DEPLOY_DATA_WRITE/.test(cacheSync) || !/CACHE_SYNC_DEPLOY_DATA_WRITE_DISABLED/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must block generated data writes into deploy worktree unless CACHE_SYNC_ALLOW_DEPLOY_DATA_WRITE=1 is explicitly set");
}
for (const marker of [
  "scripts\\write-desktop-route-snapshot.js",
  "--fail-on-partial",
  "FUMAN_RUNTIME_DIR",
  "NODE_OPTIONS",
  "scan-receipts",
]) {
  if (!refreshDesktopSnapshot.includes(marker)) issues.push(`refresh-desktop-route-snapshot.ps1 missing ${marker}`);
}
for (const marker of [
  "$routeBySource",
  "--routes=$routeKey",
  "Desktop route snapshot refresh retry",
  "Start-Sleep -Seconds 5",
]) {
  if (!refreshDesktopSnapshot.includes(marker)) issues.push(`refresh-desktop-route-snapshot.ps1 missing latest post-scan route-scoped anti-rollback marker ${marker}`);
}
for (const marker of [
  "selectedTasks",
  "FUMAN_POST_SCAN_SNAPSHOT_ROUTES",
  "routes: tasks.map",
  "rows.length === tasks.length",
]) {
  if (!postScanSnapshotVerifier.includes(marker)) issues.push(`verify-post-scan-snapshot-refresh-contract.js missing route-scoped marker ${marker}`);
}
if (!/bundleDisplayReady/.test(postScanSnapshotVerifier) || !/snapshotHit \|\| row\.bundleHit/.test(postScanSnapshotVerifier)) {
  issues.push("verify-post-scan-snapshot-refresh-contract.js must keep bundleHit immediate-display readiness support");
}
if (!/ignored stale scanner receipt/.test(fullScan) || !/receiptIsStale/.test(fullScan)) {
  issues.push("run-full-scan.ps1 must reject stale child receipts from previous scanner runs");
}
for (const marker of [
  "strictRequiredStrategies",
  "allCompleteOk",
  "strictFailures",
  "Full scan strict gate failed",
]) {
  if (!fullScan.includes(marker)) issues.push(`run-full-scan.ps1 missing strict full scan marker ${marker}`);
}
if (!/Write-OpenBuyReceipt "failed" \$LASTEXITCODE \$false 0 \$script:OpenBuyVerifiedRunId/.test(runOpenBuy)) {
  issues.push("run-open-buy.ps1 must write a current failed receipt when desktop snapshot refresh fails");
}
if (!/STRATEGY4_SUPABASE_ALLOW_EXTERNAL_FALLBACK/.test(runStrategy4) || !/Strategy4 contract seed fallback enabled for cache-miss self-heal/.test(runStrategy4)) {
  issues.push("run-strategy4.ps1 must keep Strategy4 contract seed fallback self-heal marker");
}
if (!/inferredRunIdFromLatestComplete/.test(strategy2BattleStateVerifier)) {
  issues.push("verify-strategy2-battle-state.js must keep runtime-session-history latest-runId inference");
}
for (const marker of [
  "Latest Operator Contract",
  "Do Not Use As Read-Only Verification",
  "Post-Scan Immediate Display",
  "Full Scan Strict Gate",
  "Strategy4 Latest Contract",
  "Anti-Rollback",
  "allCompleteOk",
  "strictFailures",
]) {
  if (!agentsGuide.includes(marker)) issues.push(`AGENTS.md missing latest-only operator marker ${marker}`);
}
for (const marker of [
  "Old all-route behavior is retired",
  "selectedTasks()",
  "FUMAN_POST_SCAN_SNAPSHOT_ROUTES",
  "Single scanner runs must not fail because unrelated routes",
  "bundleHit",
  "full-scan strict all-complete",
  "strictRequiredStrategies",
  "allCompleteOk",
  "strictFailures",
]) {
  if (!postScanSnapshotAgents.includes(marker)) issues.push(`post-scan-snapshot-refreshAGENTS.MD missing latest route-scoped contract marker ${marker}`);
}
if (!/Invoke-DesktopRouteSnapshotRefresh/.test(gate) || !/refresh-desktop-route-snapshot\.ps1/.test(gate) || !/Invoke-DesktopRouteSnapshotRefresh "live-freshness-gate-\$gateMode"/.test(gate)) {
  issues.push("run-live-freshness-gate.ps1 must refresh desktop route snapshot after Supabase/cache publish so terminal UI gets the latest complete runs");
}
for (const [file, text, source] of [
  ["run-open-buy.ps1", runOpenBuy, "open-buy"],
  ["run-strategy3-complete-scan.ps1", runStrategy3Complete, "strategy3"],
  ["run-strategy4.ps1", runStrategy4, "strategy4"],
  ["run-strategy5.ps1", runStrategy5, "strategy5"],
  ["run-institution.ps1", runInstitution, "institution"],
  ["run-warrant-flow.ps1", runWarrantFlow, "warrant-flow"],
  ["run-cb-detect.ps1", runCbDetect, "cb-detect"],
]) {
  if (!/refresh-desktop-route-snapshot\.ps1/.test(text) || !new RegExp(`-Source\\s+["']${source}["']`).test(text)) {
    issues.push(`${file} must refresh desktop route snapshot after successful Supabase scan with source=${source}`);
  }
}
for (const [file, text, strategy] of [
  ["run-open-buy.ps1", runOpenBuy, "strategy1"],
  ["run-strategy2-intraday.ps1", runStrategy2Intraday, "strategy2"],
  ["run-strategy3-complete-scan.ps1", runStrategy3Complete, "strategy3"],
  ["run-strategy4.ps1", runStrategy4, "strategy4"],
  ["run-strategy5.ps1", runStrategy5, "strategy5"],
  ["run-institution.ps1", runInstitution, "institution"],
  ["run-warrant-flow.ps1", runWarrantFlow, "warrant"],
]) {
  if (!/scanner-resource-health\.ps1/.test(text) || !/Invoke-ScannerResourceHealthGate/.test(text)) {
    issues.push(`${file} must gate scanner publish on v_scanner_resource_health`);
  }
  if (!new RegExp(`-Strategy\\s+["']${strategy}["']`, "i").test(text)) {
    issues.push(`${file} scanner resource health gate must use strategy=${strategy}`);
  }
  if (!/PreserveLatest/.test(text)) {
    issues.push(`${file} must preserve latest complete run when resource health is stale/not_ready/failed`);
  }
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
if (!/snapshotFriendlyPendingPayload/.test(openBuyLatestApi) || !/decision-pending-display/.test(openBuyLatestApi)) {
  issues.push("api/open-buy-latest.js compact snapshot response must show latest complete-run candidates when decision_ready is false, with decision-pending metadata");
}
if (!/previous_2130_carry_forward/.test(openBuyLatestApi) || !/previous-2130-carry-forward/.test(openBuyLatestApi) || !/21:30 初篩名單/.test(openBuyLatestApi) || !/allowPrevious2130Run/.test(openBuyLatestApi)) {
  issues.push("api/open-buy-latest.js must carry forward the previous 21:30 Strategy1 complete run during holidays/preopen waits instead of showing an empty waiting snapshot");
}
if (!/canvas=1&compact=1&shell=1&limit=60&live=1/.test(runOpenBuy)) {
  issues.push("run-open-buy.ps1 must verify terminal compact Strategy1 API, not the strict full API, before refreshing desktop snapshot");
}
if (/legacy scan_time gate|legacy_scan_time_gate|includeRunId = false|STRATEGY4_SUPABASE_RUN_ID/.test(strategy4Scanner)) {
  issues.push("scan-strategy4-cache.js must hard-fail when run_id complete gate is unavailable, not retry legacy scan_time");
}
if (!/STRATEGY4_API_ONLY = true/.test(strategy4Scanner) || /OUT_FILE|BACKUP_FILE|SUMMARY_FILE|writeSummary\("strategy4"|fs\.writeFileSync\([^)]*strategy4-(latest|backup|summary)\.json/.test(strategy4Scanner)) {
  issues.push("scan-strategy4-cache.js must be API-only: full scan publishes Supabase complete run only, no data/strategy4 static output");
}
for (const marker of ["stock_daily_volume", "supabase:stock_daily_volume"]) {
  if (!strategy4Scanner.includes(marker)) issues.push(`scan-strategy4-cache.js missing stable Strategy4 source marker ${marker}`);
  if (!strategy4LatestApi.includes(marker)) issues.push(`strategy4-latest.js missing stable Strategy4 source marker ${marker}`);
}
for (const marker of [
  "assertStrategy4PrePublishSelfTest",
  "verifyStrategy4PublishedSelfTest",
  "REQUIRED_WALLET_FIELDS",
  "REQUIRED_MUTAKI_FIELDS",
  "executionRate",
  "coverageRatio",
]) {
  if (!strategy4Scanner.includes(marker)) issues.push(`scan-strategy4-cache.js missing Strategy4 standard self-test marker ${marker}`);
}
for (const marker of [
  "v_scanner_resource_health",
  "stock_daily_volume",
  "fugle_daily_volume",
  "strategy4_daily_ohlcv_view",
  "strategy4-history-prewarm-status.json",
  "verify-terminal-resource-chain.js",
  "verify-terminal-field-completeness.js",
  "verify-terminal-source-contracts.js",
  "published-breakdown-complete",
]) {
  if (!strategy4StandardGate.includes(marker)) issues.push(`verify-strategy4-standard-gate.js missing Strategy4 standard gate marker ${marker}`);
}
if (/run-cache-sync|Invoke-CacheSync|FUMAN_STRATEGY4_SCOPED_PUBLISH|generate-slim-cache|run-strategy4-postflight|data\\strategy4|data\/strategy4|strategy4-(latest|backup|summary|slim|zone|score).*\.json/.test(runStrategy4) || !/api\/strategy4-latest/.test(runStrategy4)) {
  issues.push("run-strategy4.ps1 must be API-only: no static strategy4 JSON copy, slim generation, cache sync, or static postflight");
}
if (!/canvas=1&compact=1&shell=1&limit=70&live=1/.test(runStrategy4)) {
  issues.push("run-strategy4.ps1 must verify the same compact live Strategy4 API path used by terminal/snapshot");
}
if (/"strategy4", "data\/strategy4-latest\.json"|strategy4PresetFiles\]/.test(slimCacheGenerator)) {
  issues.push("generate-slim-cache.js must not generate strategy4 static slim/zone/page JSON");
}
if (!/FUMAN_SLIM_CACHE_WRITE_CODE_REPO/.test(slimCacheGenerator) || !/function\s+writeRoots/.test(slimCacheGenerator)) {
  issues.push("generate-slim-cache.js must write generated static artifacts to runtime only unless FUMAN_SLIM_CACHE_WRITE_CODE_REPO=1 is explicitly set");
}
for (const marker of [
  "isRetiredStaticOutput",
  "strategy-match-index-static-retired",
  "realtime-radar-api-only-static-disabled",
  "market-ai-live",
]) {
  if (!slimCacheGenerator.includes(marker)) issues.push(`generate-slim-cache.js missing retired realtime/static marker ${marker}`);
}
if (/readOptional\("data\/realtime-radar-latest\.json"|readOptional\("data\/strategy-match-index\.json"|writeToBoth\("data\/strategy-match-index\.json"|source:\s*"data\/strategy-match-index\.json"|source:\s*"data\/market-ai-live\.json"/.test(slimCacheGenerator)) {
  issues.push("generate-slim-cache.js must not read/write retired realtime radar, market-ai-live, or strategy-match static JSON");
}
for (const marker of ["FUMAN_MARKET_AI_ALLOW_CODE_REPO_CACHE", "runtime:market-ai-live.json"]) {
  if (!marketAiLiveApi.includes(marker)) issues.push(`api/market-ai-live.js missing runtime-only cache marker ${marker}`);
}
if (!/api-driven-watchlist-match-index/.test(watchlistMatchIndexGenerator) || /writeJson\(|data\/strategy-match-index\.json/.test(watchlistMatchIndexGenerator)) {
  issues.push("generate-watchlist-match-index.js must be API-driven snapshot-only and must not write data/strategy-match-index.json");
}
if (/data\/strategy4-|strategy4-score/.test(sourceSync)) {
  issues.push("sync-main-deploy-source.js must not publish strategy4 static JSON artifacts");
}
if (/data\/(mobile-|terminal-home|stocks-|strategy-match|strategy-weight|performance-report|signal-quality-report|data-quality-report|data-consistency-report|market-ai|market-summary|heatmap)|data\/mobile-analysis/.test(sourceSync)) {
  issues.push("sync-main-deploy-source.js must not copy generated static terminal/mobile/report JSON artifacts");
}
if (/readJson\("data\/open-buy-latest\.json"/.test(read("api/terminal-home.js"))) {
  issues.push("api/terminal-home.js must not fallback to legacy data/open-buy-latest.json");
}
if (!/publish_strategy2_complete_run/.test(strategy2CompleteRunPublisher) || !/strategy2_latest\?on_conflict=id/.test(strategy2CompleteRunPublisher)) {
  issues.push("publish-strategy2-complete-run.js must publish strategy2_latest and Supabase complete run RPC");
}
if (!/STRATEGY2_SNAPSHOT_KEY/.test(strategy2CompleteRunPublisher) || !/upsertSnapshot\(STRATEGY2_SNAPSHOT_KEY/.test(strategy2CompleteRunPublisher)) {
  issues.push("publish-strategy2-complete-run.js must publish strategy2_latest_snapshot for opt-in snapshot-first display");
}
if (!/DIRECT_AUTHORITATIVE_KEYS\s*=\s*new Set\(\["strategy2"\]\)/.test(latestStrategyApi) || !/fetchDirectPayload/.test(latestStrategyApi) || !/direct-latest-run/.test(latestStrategyApi)) {
  issues.push("api/latest-strategy.js must treat Strategy2 as direct-authoritative and must not trust stale strategy_cache_status payloads");
}
if (!/emptyTodayRun[\s\S]*return buildStrategy2RunPayload\(emptyTodayRun/.test(strategy2LatestApi) || !/emptyToday:\s*true/.test(strategy2LatestApi)) {
  issues.push("api/strategy2-latest.js must return today's empty/not-ready run instead of falling back to historical Strategy2 rows");
}
if (!/sessionWithSupabaseRunDate/.test(strategy2LatestApi) || !/supabase-latest-run/.test(strategy2LatestApi)) {
  issues.push("api/strategy2-latest.js must let Supabase latest run date correct stale local market-session files");
}
if (!/requestedTop/.test(strategy2LatestApi) || !/hasTopLimit/.test(strategy2LatestApi) || !/const minLimit = hasTopLimit \? 1 : 20/.test(strategy2LatestApi)) {
  issues.push("api/strategy2-latest.js must honor top=1 for lightweight mobile health checks without shrinking normal terminal payloads");
}
if (!/\[completeRun,\s*readiness,\s*tradingDay,\s*sourceGate\]\s*=\s*await Promise\.all/.test(strategy2LatestApi)) {
  issues.push("api/strategy2-latest.js must fetch complete run, readiness, trading-day state, and source gate in parallel so live Strategy2 cold start stays fast");
}
for (const marker of ["isTwseTradingDay", "market_closed", "v_strategy2_readiness_status", "resourceReadiness", "publishBlocked", "publishBlockedReason"]) {
  if (!strategy2LatestApi.includes(marker)) issues.push(`api/strategy2-latest.js missing Strategy2 readiness API marker ${marker}`);
}
for (const marker of ["readStrategy2SourceGate", "fetchStrategy2SourceGate", "attachStrategy2PublishGate", "staleSeconds", "latestRunId", "writeBudget", "retentionOk", "publishAllowed", "sourceCoverage"]) {
  if (!strategy2LatestApi.includes(marker)) issues.push(`api/strategy2-latest.js missing Strategy2 source publish gate API marker ${marker}`);
}
for (const marker of ["STRATEGY2_SNAPSHOT_KEY", "readStrategy2SnapshotPayload", "snapshotFirst", "supabase:strategy2_latest_snapshot", "options.snapshot && !options.live"]) {
  if (!strategy2LatestApi.includes(marker)) issues.push(`api/strategy2-latest.js missing Strategy2 snapshot-first marker ${marker}`);
}
for (const marker of ["normalizeCoverageGateReason", "市場來源可用率", "已達", "列入預備進場觀察"]) {
  if (!strategy2LatestApi.includes(marker)) issues.push(`api/strategy2-latest.js missing Strategy2 coverage-gate contradiction guard ${marker}`);
}
for (const marker of ["strategy2SnapshotFirstEnabled", "strategy2SnapshotFirst", "snapshot-first-refreshing", "快照先顯示｜即時刷新中"]) {
  if (!desktopFastShell.includes(marker)) issues.push(`terminal-desktop-fast-shell.js missing Strategy2 snapshot-first marker ${marker}`);
}
for (const marker of ["strategy2CoverageGateHealthy", "coverageGateHealthy", "市場來源可用率"]) {
  if (!desktopFastShell.includes(marker)) issues.push(`terminal-desktop-fast-shell.js missing Strategy2 coverage-gate UI marker ${marker}`);
}
if (/pause\|hold\|history\|b\[-_ \]\?only\|暫停\|歷史\|市場來源可用率/.test(desktopFastShell)) {
  issues.push("terminal-desktop-fast-shell.js must not pause Strategy2 rows merely because text contains 市場來源可用率");
}
for (const marker of ["installStrategy2SnapshotFirstPrime", "primeStrategy2SnapshotFirst", "snapshot-first-prime", "script-idle", "installMarketColdPayloadPrime", "primeMarketColdPayloads", "marketJsonInflight", "market-prime-inflight", "primeDesktopFastBundle(false, \"script\")", "paintMarketSnapshotFirstPayload", "primeDesktopFastBundle(false, \"market-snapshot-first\")"]) {
  if (!desktopFastShell.includes(marker)) issues.push(`terminal-desktop-fast-shell.js missing cold-start snapshot/cache marker ${marker}`);
}
for (const marker of ["installStrategy2LivePrime", "primeStrategy2LiveRows", "api-live-prime", "primeStrategy2LiveRows(false, \"script\")"]) {
  if (!desktopFastShell.includes(marker)) issues.push(`terminal-desktop-fast-shell.js missing Strategy2 live prime marker ${marker}`);
}
if (/Math\.max\(Number\(options\.timeoutMs/.test(desktopRouteSnapshotCache)) {
  issues.push("readEndpointFromDesktopSnapshot must honor per-call timeoutMs instead of forcing the 12000ms default during route cold start");
}
if (!/DEFAULT_WRITE_TIMEOUT_MS/.test(desktopRouteSnapshotCache) || !/FUMAN_DESKTOP_ROUTE_SNAPSHOT_WRITE_TIMEOUT_MS/.test(desktopRouteSnapshotCache) || /timeoutMs:\s*options\.timeoutMs\s*\|\|\s*20000/.test(desktopRouteSnapshotCache)) {
  issues.push("lib/desktop-route-snapshot-cache.js must use configurable desktop snapshot write timeout instead of a hard 20s Supabase upsert timeout");
}
if (!/postScanSnapshotContract/.test(desktopRouteSnapshotCache)) {
  issues.push("lib/desktop-route-snapshot-cache.js must treat postScanSnapshotContract as a volatile endpoint query parameter");
}
if (!/SNAPSHOT_WRITE_TIMEOUT_MS/.test(desktopRouteSnapshotBuilder) || !/FUMAN_DESKTOP_ROUTE_SNAPSHOT_WRITE_TIMEOUT_MS/.test(desktopRouteSnapshotBuilder) || /timeoutMs:\s*options\.timeoutMs\s*\|\|\s*20000/.test(desktopRouteSnapshotBuilder)) {
  issues.push("lib/desktop-route-snapshot-builder.js must pass configurable desktop snapshot write timeout to all snapshot upserts");
}
if (!/function\s+liveCompactQuery/.test(desktopRouteSnapshotBuilder) || !/WATCHLIST_WARRANT_COVERAGE_QUERY\s*=\s*\{[^}]*live:\s*"1"/.test(desktopRouteSnapshotBuilder)) {
  issues.push("lib/desktop-route-snapshot-builder.js must use live query helpers for post-scan snapshot capture instead of stale CDN/cache reads");
}
for (const marker of [
  '["/api/open-buy-latest", openBuyLatest, liveCompactQuery(60)',
  '["/api/strategy3-latest", strategy3Latest, liveCompactQuery(60)',
  '["/api/strategy4-latest", strategy4Latest, liveCompactQuery(70)',
  '["/api/strategy5-latest", strategy5Latest, liveCompactQuery(70)',
  '["/api/institution-latest", institutionLatest, liveCompactQuery(60)',
  '["/api/cb-detect-latest", cbDetectLatest, liveCompactQuery(60)',
  '["/api/warrant-flow-latest", warrantFlowLatest, liveCompactQuery(60)',
]) {
  if (!desktopRouteSnapshotBuilder.includes(marker)) {
    issues.push(`lib/desktop-route-snapshot-builder.js missing live post-scan snapshot route marker ${marker}`);
  }
}
if (!/STRATEGY3_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS/.test(strategy3LatestApi) || /timeoutMs:\s*650/.test(strategy3LatestApi)) {
  issues.push("api/strategy3-latest.js must use a configurable desktop route snapshot read timeout instead of the old 650ms hard timeout");
}
for (const marker of ["tvPassCount", "normalizeStrategy3ApiContract", "strategy3TvOk"]) {
  if (!strategy3LatestApi.includes(marker)) issues.push(`api/strategy3-latest.js missing Strategy3 API contract marker ${marker}`);
}
for (const [file, source] of [
  ["api/strategy3-latest.js", strategy3LatestApi],
  ["api/strategy4-latest.js", strategy4LatestApi],
  ["api/strategy5-latest.js", strategy5LatestApi],
  ["api/institution-latest.js", institutionLatestApi],
  ["api/cb-detect-latest.js", cbDetectLatestApi],
  ["api/warrant-flow-latest.js", warrantFlowLatestApi],
]) {
  const cacheMatch = source.match(/Vercel-CDN-Cache-Control",\s*"public, max-age=(\d+), stale-while-revalidate=(\d+)"/);
  if (!/function\s+setDesktopSnapshotCache/.test(source) || !cacheMatch || Number(cacheMatch[1]) < 45 || Number(cacheMatch[2]) < 180) {
    issues.push(`${file} must short-cache desktop snapshot/complete-run hits long enough for full terminal cold-start verification without static JSON fallback`);
  }
}
if (!/compactSnapshotEndpoints/.test(terminalFastBundleApi) || !/Vercel-CDN-Cache-Control",\s*"public, max-age=45, stale-while-revalidate=240"/.test(terminalFastBundleApi)) {
  issues.push("api/terminal-fast-bundle.js must compact desktop snapshot payloads and keep enough edge cache for cold-start route switching");
}
if (!/isEmptyStrategy1WaitingSnapshot/.test(terminalFastBundleApi)
  || !/repairStrategy1WaitingSnapshot/.test(terminalFastBundleApi)
  || !/strategy1-previous-2130-carry-forward/.test(terminalFastBundleApi)
  || !/strategy1Previous2130Repair/.test(terminalFastBundleApi)) {
  issues.push("api/terminal-fast-bundle.js must repair stale Strategy1 holiday/preopen waiting snapshots with the previous 21:30 carry-forward run");
}
if (!/function\s+setStrategy2LiveShellCache/.test(strategy2LatestApi) || !/Vercel-CDN-Cache-Control",\s*"public, max-age=12, stale-while-revalidate=30"/.test(strategy2LatestApi)) {
  issues.push("api/strategy2-latest.js must micro-cache desktop shell live payloads so Strategy2 keeps realtime without cold-start stalls");
}
if (!/strategy2:\s*"\/api\/strategy2-latest"/.test(mobileBootApi) || /strategy2:\s*"\/api\/latest-strategy\?key=strategy2"/.test(mobileBootApi)) {
  issues.push("api/mobile-boot.js must load Strategy2 from /api/strategy2-latest, not the legacy latest-strategy wrapper");
}
if (!/endpoint:\s*"\/api\/strategy2-latest"/.test(mobileFragmentApi) || /endpoint:\s*"\/api\/latest-strategy\?key=strategy2"/.test(mobileFragmentApi)) {
  issues.push("api/mobile-fragment.js must load Strategy2 from /api/strategy2-latest, not the legacy latest-strategy wrapper");
}
if (!/function\s+strategy2EntryTime[\s\S]*?\[[^\]]*"time"[^\]]*"quoteTime"/.test(mobileFragmentApi)) {
  issues.push("api/mobile-fragment.js Strategy2 entry time must prefer compact row time before quoteTime so live rows are not filtered out");
}
if (!/require\("\.\/strategy2-latest"\)/.test(terminalHomeApi) || !/callJson\(strategy2Latest,\s*request\)/.test(terminalHomeApi) || /callJson\(latestStrategy/.test(terminalHomeApi)) {
  issues.push("api/terminal-home.js must load Strategy2 directly from strategy2-latest, not latest-strategy");
}
if (!/STRATEGY2_HEALTH_ENDPOINT\s*=\s*"\/api\/strategy2-latest\?top=1&compact=1&limit=50&live=1"/.test(mobileHealthVerifier) || /strategy2\?top=1/.test(mobileHealthVerifier)) {
  issues.push("scripts/verify-mobile-health.js must probe the direct Strategy2 live API and must not build malformed latest-strategy query strings");
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
  "REALTIME_QUOTE_SOURCE_ORDER",
  "fugle,finmind,twse-mis,yahoo-chart",
  "fetchFugleQuotesForCodes",
  "fetchFinMindQuotesForCodes",
  "fetchTwseMisQuotesForCodes",
  "sourceAttempts",
  "primarySource",
]) {
  if (!realtimeApi.includes(marker)) issues.push(`api/realtime.js missing realtime quote source order marker ${marker}`);
}
for (const marker of [
  "DEFAULT_RADAR_LIMIT = 120",
  "FULL_SESSION_RADAR_LIMIT = 1200",
  "MAX_RADAR_LIMIT = 1500",
  "function requestRadarLimit",
  "function radarPayloadRunId",
  "payloadRunId",
  "displayWindow: \"09:00-13:30\"",
  "totalCount",
  "hasMore",
]) {
  if (!realtimeRadarApi.includes(marker)) issues.push(`api/realtime-radar-latest.js missing full-session API marker ${marker}`);
}
for (const marker of [
  "/api/realtime-radar-latest?full=1&limit=1200",
  "/api/realtime-radar-latest?compact=1&shell=1&limit=1200",
  "staleQuoteCount",
  "failedBatchCount",
  "supabase-radar-cache",
  "apiFull.rows === 1200",
  "apiShell1200.rows === 1200",
  "terminal-desktop-fast-shell.js",
  "terminal-realtime-radar.css",
]) {
  if (!realtimeRadarFrontendContract.includes(marker)) issues.push(`verify-realtime-radar-frontend-contract.js missing frontend contract marker ${marker}`);
}
for (const marker of [
  "function renderRealtimeRadarDomShell",
  "data-realtime-radar-dom-shell",
  "radar-dom-shell",
  "realtimeRadarDomSide",
  "realtimeRadarDomSide = \"long\"",
  "data-radar-dom-side=\"long\"",
  "data-radar-dom-side=\"short\"",
  "流水帳逐筆記錄",
  "limit: 1200",
  "full: true",
  "/api/realtime-radar-latest?full=1",
  "marketJsonCacheKey(\"/api/realtime-radar-latest?full=1\", 1200)",
  "panel.querySelectorAll(\":scope > .desktop-route-shell.desktop-canvas-app\").forEach((node) => node.remove())",
]) {
  if (!desktopFastShell.includes(marker)) issues.push(`terminal-desktop-fast-shell.js missing realtime radar DOM/full-session marker ${marker}`);
}
if (desktopFastShell.includes('data-radar-dom-side="all"') || /全部\s+\$\{escapeHtml\(String\(sessionRows\.length\)\)\}/.test(desktopFastShell)) {
  issues.push("terminal-desktop-fast-shell.js must not render realtime radar all-session tab; only long/short tabs are allowed");
}
if (!/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(realtimeRadarCss) || /all-active/.test(realtimeRadarCss)) {
  issues.push("terminal-realtime-radar.css must render realtime radar board tabs as long/short only");
}
if (/<section\s+class=["']radar-flow-grid/.test(desktopFastShell) || /<section\s+class=["']radar-flow-grid/.test(terminalApp)) {
  issues.push("realtime radar DOM shell must not render the removed flow summary block");
}
for (const marker of [
  "REALTIME_RADAR_SESSION_LIMIT",
  "REALTIME_RADAR_WRITE_BUDGET_PER_SCAN",
  "realtime-radar-write-budget.json",
  "function buildRealtimeRadarRunId",
  "function createWriteBudget",
  "writeBudget",
  "runId",
  "function mergeRadarSessionRows",
  "sessionStart: \"09:00\"",
  "sessionEnd: \"13:30\"",
  "currentScanCount",
  ".slice(0, REALTIME_RADAR_SESSION_LIMIT)",
]) {
  if (!realtimeRadarScanner.includes(marker)) issues.push(`scan-realtime-radar-cache.js missing full-session scanner marker ${marker}`);
}
if (!/REALTIME_RADAR_NOTIFY\s*=\s*"0"/.test(runRealtimeRadar)) {
  issues.push("run-realtime-radar.ps1 must disable realtime radar Telegram source alerts with REALTIME_RADAR_NOTIFY=0");
}
for (const marker of [
  "REALTIME_RADAR_PATROL_INTERVAL_MS = \"3000\"",
  "REALTIME_RADAR_SKIP_SYNC_AFTER_OUTPUT = \"1\"",
  "REALTIME_RADAR_USE_LOCAL_API = \"1\"",
  "REALTIME_QUOTE_SOURCE_ORDER = \"fugle,finmind,twse-mis,yahoo-chart\"",
  "REALTIME_RADAR_EXCLUDED_CODES",
  "REALTIME_RADAR_BATCH_SIZE",
  "REALTIME_RADAR_BATCH_CONCURRENCY",
  "REALTIME_RADAR_BATCH_TIMEOUT_MS",
  "REALTIME_RADAR_BATCH_RETRIES",
  "REALTIME_RADAR_STALE_RESCAN_LIMIT",
  "REALTIME_RADAR_WRITE_BUDGET_PER_SCAN",
  "REALTIME_FUGLE_PRIMARY_BUDGET_MS",
  "REALTIME_FINMIND_FALLBACK_BUDGET_MS",
]) {
  if (!runRealtimeRadar.includes(marker)) issues.push(`run-realtime-radar.ps1 missing fast/stable radar tuning marker ${marker}`);
}
for (const marker of [
  "REALTIME_BATCH_SIZE",
  "REALTIME_BATCH_RETRIES",
  "fetchRealtimeBatch",
  "REALTIME_RADAR_USE_LOCAL_API",
  "fetchLocalRealtimeBatch",
  "require(\"../api/realtime\")",
  "function hasFreshQuote(stock)",
  "function hasFreshLastTrade(stock, scanTimestamp)",
  "lastTradeStaleCount",
  "lastTradeStaleDetails",
  "REALTIME_RADAR_EXCLUDED_CODES",
  "sourceExcludedCodes",
  "isRealtimeRadarSourceCandidate",
  "selectStaleStocksForRescan",
  "normalizeRescanBatches",
  "staleRescanLimit",
]) {
  if (!realtimeRadarScanner.includes(marker)) issues.push(`scan-realtime-radar-cache.js missing fast/stable radar tuning marker ${marker}`);
}
const buildRadarRowsMatch = realtimeRadarScanner.match(/function buildRadarRows[\s\S]*?function radarRowSessionSeconds/);
if (!buildRadarRowsMatch) {
  issues.push("scan-realtime-radar-cache.js must keep buildRadarRows before radarRowSessionSeconds for realtime radar no-rollback guard");
} else if (/\.slice\s*\(\s*0\s*,\s*80\s*\)/.test(buildRadarRowsMatch[0])) {
  issues.push("scan-realtime-radar-cache.js buildRadarRows must not roll realtime radar back to 80-row session cap");
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
if (!/fastStrategy2Only/.test(gate) || !/Fast gate strategy2-only mode/.test(gate) || !/FUMAN_FAST_GATE_ALLOW_DAILY_REFRESH/.test(gate)) {
  issues.push("run-live-freshness-gate.ps1 -Fast must default to Strategy2-only and skip daily scanners unless explicitly overridden");
}
if (/INSTITUTION_SOURCE_PROVIDER\)\s*\{\s*\$env:INSTITUTION_SOURCE_PROVIDER\s*=\s*["']finmind["']/.test(gate)) {
  issues.push("run-live-freshness-gate.ps1 must not force INSTITUTION_SOURCE_PROVIDER=finmind; use auto for official-first fallback");
}
for (const marker of [
  "Invoke-RunnerTask \"strategy3\" \"strategy3 full scan\" \"critical\" \"run-strategy3-complete-scan.ps1\"",
  "run-strategy3-complete-scan.ps1",
  "data\\scan-receipts",
  "scan-summary.json",
  "strictRequiredStrategies",
  "allCompleteOk",
  "strictFailures",
  "Full scan strict gate failed",
  "SKIP desktop route snapshot write because strictFailures",
  "post-scan immediate-display verifier",
  "scripts\\verify-post-scan-snapshot-refresh-contract.js",
]) {
  if (!fullScan.includes(marker)) issues.push(`run-full-scan.ps1 missing full scan marker ${marker}`);
}
if (!/FUMAN_SCAN_RECEIPTS_WRITE_CODE_REPO/.test(fullScan) || !/\$writeCodeRepoReceipts/.test(fullScan) || !/runtime-only/.test(fullScan)) {
  issues.push("run-full-scan.ps1 must write scan receipts to runtime only unless FUMAN_SCAN_RECEIPTS_WRITE_CODE_REPO=1 is explicitly set");
}
for (const marker of [
  "\"strategy3\"",
  "\"institution\"",
  "\"warrant-flow\"",
  "\"cb-detect\"",
  "allCompleteOk",
  "strictFailures",
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

for (const marker of [
  "FIRST_SCREEN_BUDGET_BYTES",
  "FIRST_SCREEN_JSON_BUDGET_BYTES",
  "FIRST_SCREEN_FORBIDDEN",
  "/api/mobile-boot",
]) {
  if (!mobileHealthVerifier.includes(marker)) issues.push(`verify-mobile-health.js missing ${marker}`);
}
if (!/STATIC_MOBILE_ARTIFACTS_ARE_LEGACY_CACHE_ONLY/.test(mobileHealthVerifier)) {
  issues.push("verify-mobile-health.js must mark static mobile artifacts as legacy/cache only");
}
if (!/FUMAN_VERIFY_LEGACY_MOBILE_STATIC/.test(mobileAiFragmentVerifier) || !/verify-mobile-api-only\.js/.test(mobileAiFragmentVerifier)) {
  issues.push("verify-mobile-ai-fragment.js must default to API-only verification and require explicit legacy static mode for /data mobile fragments");
}
if (!/\/api\/mobile-boot/.test(mobileUpdateEventPublisher) || !/MOBILE_UPDATE_EVENT_BOOT_SOURCE/.test(mobileUpdateEventPublisher)) {
  issues.push("publish-mobile-update-event.js must read API-only /api/mobile-boot by default and require explicit legacy static mode");
}
if (!/\/api\/mobile-boot/.test(mobileApiOnlyVerifier) || !/MOBILE_UPDATE_EVENT_BOOT_SOURCE/.test(mobileApiOnlyVerifier)) {
  issues.push("verify-mobile-api-only.js must guard mobile update event API-only boot source");
}
for (const marker of [
  "mobile-watch-merge-storage-20260629-01",
  "parseStoredRows(KEY)",
  "parseStoredRows(MOBILE_KEY)",
  "parseRows(KEY)",
  "parseRows(MOBILE_KEY)",
  "localStorage.getItem(KEY) || localStorage.getItem(MOBILE_KEY)",
  "localStorage.getItem(w)||localStorage.getItem(l)",
]) {
  if (!mobileApiOnlyVerifier.includes(marker)) issues.push(`verify-mobile-api-only.js missing mobile watch storage merge no-rollback marker ${marker}`);
}
if (/localStorage\.getItem\(KEY\)\s*\|\|\s*localStorage\.getItem\(MOBILE_KEY\)/.test(mobileShell) ||
  /localStorage\.getItem\(w\)\s*\|\|\s*localStorage\.getItem\(l\)/.test(mobileShell)) {
  issues.push("mobile.html must merge fuman_watchlist and fuman_mobile_watchlist_v1; first-non-empty storage reads are forbidden");
}
if (!/function dataOutputPaths/.test(runtimePaths) || !/FUMAN_WRITE_CODE_REPO_DATA/.test(runtimePaths)) {
  issues.push("runtime-paths.js must expose dataOutputPaths with explicit opt-in repo data writes");
}
for (const [name, source, envName] of [
  ["scripts/refresh-intraday-latest-dates.js", refreshIntradayLatestDates, "FUMAN_INTRADAY_DATE_WRITE_CODE_REPO"],
  ["scripts/scan-intraday-signals.js", strategy2Scanner, "FUMAN_STRATEGY2_INTRADAY_WRITE_CODE_REPO"],
  ["scripts/scan-warrant-flow-cache.js", warrantFlowScanner, "FUMAN_WARRANT_FLOW_WRITE_CODE_REPO"],
]) {
  if (!/dataOutputPaths/.test(source) || !source.includes(envName)) {
    issues.push(`${name} must route generated data through runtime-only dataOutputPaths unless ${envName}=1 is explicitly set`);
  }
  if (/\bFUMAN_SYNC_DIR\b/.test(source) || /C:\\\\fuman-terminal/.test(source)) {
    issues.push(`${name} must not default generated data writes into C:\\fuman-terminal`);
  }
}
for (const [name, source] of [
  ["generate-data-quality-report.js", dataQualityReportGenerator],
  ["generate-consistency-report.js", consistencyReportGenerator],
  ["generate-signal-quality-report.js", signalQualityReportGenerator],
  ["generate-performance-report.js", performanceReportGenerator],
  ["generate-strategy-weight-report.js", strategyWeightReportGenerator],
  ["generate-stocks-slim.js", stocksSlimGenerator],
]) {
  if (!/dataOutputPaths/.test(source)) {
    issues.push(`${name} must write generated data through runtime-only dataOutputPaths`);
  }
  if (/\[\s*ROOT\s*,\s*(?:RUNTIME_ROOT|process\.env\.FUMAN_RUNTIME_ROOT)/.test(source) || /\bFUMAN_SYNC_DIR\b/.test(source)) {
    issues.push(`${name} must not default to writing generated data into repo/deploy sync roots`);
  }
}
if (!/RETIRED_API_ONLY_FILES/.test(dataQualityReportGenerator) || !/api_only_retired_static_data/.test(dataQualityReportGenerator)) {
  issues.push("generate-data-quality-report.js must treat retired static latest files as API-only diagnostics");
}
for (const marker of ["market-summary.json", "institution-latest.json", "warrant-flow-latest.json"]) {
  if (!dataQualityReportGenerator.includes(marker)) {
    issues.push(`generate-data-quality-report.js missing retired static data marker ${marker}`);
  }
}
if (!/RETIRED_API_ONLY_FILES/.test(performanceReportGenerator) || !/api_only_retired_static_data/.test(performanceReportGenerator)) {
  issues.push("generate-performance-report.js must treat retired static cache assets as API-only diagnostics");
}
for (const marker of ["market-summary.json", "institution-slim.json", "warrant-flow-slim.json", "warrant-priority-top.json"]) {
  if (!performanceReportGenerator.includes(marker)) {
    issues.push(`generate-performance-report.js missing retired static asset marker ${marker}`);
  }
}

const mobileLayoutVerifier = read("scripts/verify-mobile-layout.js");
for (const marker of [
  "repeat(2, minmax(0, 1fr))",
  "forbidden mobile #market-view #heatmap one-column override found",
  "assertMobileShellCss",
  "rootcolor-scheme",
  "@media (orientation:landscape)",
  "--live",
]) {
  if (!mobileLayoutVerifier.includes(marker)) issues.push(`verify-mobile-layout.js missing ${marker}`);
}

const terminalUiE2eVerifier = read("scripts/verify-terminal-ui-e2e.js");
for (const marker of [
  "MOBILE_VIEWPORTS",
  "desktop opening mobile URL",
  "phone landscape",
  "tablet",
  "mobile CSS not applied",
]) {
  if (!terminalUiE2eVerifier.includes(marker)) issues.push(`verify-terminal-ui-e2e.js missing responsive mobile marker ${marker}`);
}
for (const marker of [
  "realtime radar DOM shell missing",
  "realtime radar must not render legacy desktop canvas shell",
  "realtime radar must not expose canvasRows",
  "realtime radar must show 09:00-13:30 session window",
  "realtime radar must render long/short ledger tabs only",
  "realtime radar flow summary block must stay removed",
]) {
  if (!terminalUiE2eVerifier.includes(marker)) issues.push(`verify-terminal-ui-e2e.js missing realtime radar no-rollback marker ${marker}`);
}
for (const marker of [
  "verifyMobileDivergedStorageMerge",
  "verifyMobileConsecutiveManualAdds",
  "fuman_watchlist",
  "fuman_mobile_watchlist_v1",
  "submitWatchlistCode(\"0000\")",
  "submitMobileWatchCode(cdp, \"0000\")",
  "3504",
  "3028",
  "3717",
  "6174",
]) {
  if (!terminalUiE2eVerifier.includes(marker)) issues.push(`verify-terminal-ui-e2e.js missing mobile watch storage/add no-rollback marker ${marker}`);
}
if (/submitWatchlistCode\("2334"\)|submitMobileWatchCode\(cdp,\s*"2334"\)/.test(terminalUiE2eVerifier)) {
  issues.push("verify-terminal-ui-e2e.js must not use 2334 as invalid-code fixture; use unambiguous 0000");
}

const liveVersionVerifier = read("scripts/verify-live-version.js");
for (const [fileName, text] of [
  ["scripts/verify-production-guard.js", productionGuard],
  ["scripts/verify-live-version.js", liveVersionVerifier],
]) {
  for (const marker of [
    "FUMAN_RELEASE_SHA",
    "FUMAN_DEPLOY_SHA",
    "/api/release-manifest",
    "gitSha",
  ]) {
    if (!text.includes(marker)) issues.push(`${fileName} missing release SHA manifest marker ${marker}`);
  }
}
for (const marker of [
  "VERCEL_GIT_COMMIT_SHA",
  "FUMAN_RELEASE_SHA",
  "FUMAN_DEPLOY_SHA",
  "VERCEL_DEPLOYMENT_ID",
  "FUMAN_DEPLOY_ID",
  "VERCEL_URL",
  "deployId",
  "deploymentId",
  "versionPayload.version",
]) {
  if (!releaseManifestApi.includes(marker)) issues.push(`api/release-manifest.js missing release manifest marker ${marker}`);
}
for (const marker of [
  "scripts/deploy-production-with-release-env.js",
  ".vercelignore",
  "VERCEL-COST-UPLOAD-GUARD.md",
  "scripts/deploy-production-safe.js",
  "scripts/verify-vercel-cost-guard.js",
  "scripts/verify-vercel-project-inventory.js",
  "scripts/monitor-vercel-cost-health.js",
  "scripts/install-vercel-cost-health-monitor-task.ps1",
  "run-vercel-cost-health-monitor.ps1",
  "scripts/monitor-production-health.js",
  "scripts/send-workflow-alert.js",
  "run-production-health-monitor.ps1",
  "run-realtime-radar.ps1",
]) {
  if (!sourceSync.includes(marker)) issues.push(`sync-main-deploy-source.js missing release/monitor sync marker ${marker}`);
  if (!sourceSyncVerifier.includes(marker)) issues.push(`verify-source-sync.js missing release/monitor compare marker ${marker}`);
}
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
  "terminal-market-ai-live-watchdog.js",
  "market-ai-live-watchdog hash mismatch",
  "installMarketAiPriorityRiskGuard",
  "事件波動風險最高",
  "個股極端波動風險",
  "AI 盤中/盤後模式風險",
]) {
  if (!liveVersionVerifier.includes(marker)) issues.push(`verify-live-version.js missing AI priority risk marker ${marker}`);
}
for (const marker of [
  "installMarketAiLiveWatchdog",
  "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40",
  "載入今日正式 AI 判讀",
  "不顯示舊 panel cache",
  "live-contract-watchdog",
]) {
  if (!marketAiLiveWatchdog.includes(marker)) issues.push(`terminal-market-ai-live-watchdog.js missing ${marker}`);
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
if (!read("index.html").includes("terminal-market-ai-live-watchdog.js")) issues.push("index.html missing terminal-market-ai-live-watchdog.js");
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
  "810",
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
if (!/LEGACY_STATIC_DATA_PATTERNS/.test(serviceWorker) || !/Formal mobile data must/.test(serviceWorker)) {
  issues.push("fuman-sw.js must label /data mobile patterns as legacy cache only, not formal mobile data");
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
  "88.html",
  "AGENTS.md",
  "check-fuman-schedules.ps1",
  "post-scan-snapshot-refreshAGENTS.MD",
  "terminal-live-check.js",
  "terminal-market-ai-live-watchdog.js",
  "terminal-watchlist-module.js",
  "api/scorecard.js",
  "api/scorecard-health.js",
  "lib/scorecard-rule-locks.js",
  "lib/supabase-public-slot.js",
  "scripts/intraday-radar-rules.js",
  "scripts/scan-intraday-signals.js",
  "scripts/fugle-websocket-collector.js",
  "scripts/check-strategy2-readiness-gate.js",
  "scripts/check-strategy2-trading-day.js",
  "scripts/generate-slim-cache.js",
  "scripts/scan-realtime-radar-cache.js",
  "scripts/scan-strategy3-cache.js",
  "scripts/verify-terminal-field-completeness.js",
  "scripts/verify-terminal-source-contracts.js",
  "scripts/verify-deploy-worktree-clean.js",
  "scripts/monitor-deploy-worktree-clean.js",
  "scripts/install-deploy-worktree-clean-monitor-task.ps1",
  "scripts/verify-sync-hard-gate.js",
  "scripts/verify-production-mirror-guard.js",
  "scripts/verify-final-readonly.js",
  "scripts/verify-retired-artifacts-clean.js",
  "scripts/migrate-fuman-freshness-gate-2010-task.ps1",
  "scripts/remove-fuman-retired-schedule-tasks.ps1",
  "scripts/verify-mobile-health.js",
  "scripts/verify-mobile-api-only.js",
  "scripts/verify-mobile-ai-fragment.js",
  "scripts/publish-mobile-update-event.js",
  "api/market.js",
  "api/heatmap.js",
  "api/market-ai-live.js",
  "api/realtime-radar-latest.js",
  "scripts/verify-desktop-api-only.js",
  "scripts/verify-production-guard.js",
  "api/release-manifest.js",
  "lib/desktop-route-snapshot-builder.js",
  "lib/desktop-route-snapshot-cache.js",
  "run-publish-gate.ps1",
  "scripts/verify-scorecard-snapshot.js",
  "scripts/verify-scorecard-resource-chain.js",
  "scripts/verify-scorecard-strategy-rules.js",
  "scripts/verify-scorecard-ui-e2e.js",
  "scripts/verify-market-surfaces-chain.js",
  "scripts/verify-heatmap-realtime.js",
  "scripts/verify-market-ai-freshness-guard.js",
  "scripts/export-scorecard-supabase-source.js",
  "scripts/generate-terminal-scorecard-source.js",
  "scripts/scorecard-source-supabase-ops.js",
  "scripts/export-scorecard-snapshot.py",
  "scripts/publish-scorecard-snapshot.js",
  "scripts/verify-post-scan-snapshot-refresh-contract.js",
  "refresh-desktop-route-snapshot.ps1",
  "run-post-scan-snapshot-refresh-verify.ps1",
  "run-scorecard-daily-automation.ps1",
  "run-scorecard-snapshot.ps1",
  "run-open-buy.ps1",
  "run-strategy3.ps1",
  "run-strategy3-complete-scan.ps1",
  "run-strategy4.ps1",
  "run-strategy5.ps1",
  "run-institution.ps1",
  "run-warrant-flow.ps1",
  "run-cb-detect.ps1",
  "data/chip-trade-exclusions.json",
  "data/scorecard-latest.json",
  "scripts/scan-open-buy-cache.js",
  "scripts/scan-star-preopen.js",
  "ops/public-slot/Strategy1RunIdCompleteGate.sql",
  "ops/public-slot/Strategy2ReadinessContractCache.sql",
  "ops/public-slot/ScorecardSourceContract.sql",
  "ops/public-slot/SharedSourceReadOnlyScorecardPatch_20260701.sql",
  "ops/public-slot/Test-PublicSlotSharedSourceReadOnly.ps1",
  "ops/public-slot/Watchdog-PublicSlotSharedSource.ps1",
  "ops/public-slot/Guard-PublicSlotSourceAntiRollback.ps1",
  "ops/public-slot/Run-PublicSlotSharedSource.ps1",
  "ops/public-slot/SupabasePublicSlotSource.ps1",
  "ops/public-slot/public-slot-shared-source.config.example.json",
  "ops/public-slot/Start-Strategy2ReadinessSource.cmd",
  "ops/public-slot/Install-Strategy2ReadinessSourceTask.ps1",
  "ops/public-slot/Install-PublicSlotSharedSourceWatchdog.ps1",
  "api/desktop-static-disabled.js",
  "api/scan-warrant-flow.js",
  "scripts/scan-warrant-flow-cache.js",
  "scripts/cleanup-api-only-retired-artifacts.js",
  "run-api-only-retired-cleanup.ps1",
  "install-api-only-cleanup-task.ps1",
]) {
  if (!sourceSyncScript.includes(file)) issues.push(`sync-main-deploy-source.js missing ${file}`);
}
for (const file of [
  "AGENTS.md",
  "post-scan-snapshot-refreshAGENTS.MD",
  "api/release-manifest.js",
  "lib/desktop-route-snapshot-builder.js",
  "lib/desktop-route-snapshot-cache.js",
  "scripts/verify-sync-hard-gate.js",
  "scripts/verify-production-mirror-guard.js",
  "scripts/verify-final-readonly.js",
  "scripts/verify-retired-artifacts-clean.js",
  "scripts/migrate-fuman-freshness-gate-2010-task.ps1",
  "scripts/remove-fuman-retired-schedule-tasks.ps1",
  "check-fuman-schedules.ps1",
  "ops/public-slot/Watchdog-PublicSlotSharedSource.ps1",
  "ops/public-slot/Install-PublicSlotSharedSourceWatchdog.ps1",
  "run-publish-gate.ps1",
]) {
  if (!sourceSyncVerifier.includes(file)) issues.push(`verify-source-sync.js missing ${file}`);
}
if (!sourceSyncScript.includes('".md"') || !sourceSyncVerifier.includes('".md"')) {
  issues.push("source sync scripts must normalize Markdown as text so AGENTS documents do not drift on CRLF/LF line endings");
}

const apiOnlyCleanup = read("scripts/cleanup-api-only-retired-artifacts.js");
for (const [fileName, text] of [
  ["scripts/cleanup-api-only-retired-artifacts.js", apiOnlyCleanup],
  ["scripts/sync-main-deploy-source.js", sourceSyncScript],
]) {
  if (!/RESERVED_PRODUCTION_ROUTES/.test(text) || !/["']\/88["']/.test(text) || !/isReservedRouteArtifact/.test(text)) {
    issues.push(`${fileName} must protect reserved production route /88 for the future scorecard path`);
  }
}
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
  "fetchStrategy3QuoteLatestReady",
  "strategy3 latest quotes unavailable",
  "STRATEGY3_DRIFT_MIN_INTRADAY_STATUS_ROWS",
  "hydrateSession1mStatusFromSupabase",
  "latestStockDateKey",
  "fetchStrategy3Intraday1mLatestN",
  "chipTradeExclusion",
  "STRATEGY3_APPLY_BLACKLIST",
  "TradingView 隔日沖判斷",
  "STRATEGY3_MIN_INTRADAY_1M_CANDIDATES",
  "sessionWindow: \"09:00-12:59\"",
  "entryWindow: \"12:50-12:59\"",
  "candidateLimitApplied",
  "scanCoverage",
  "completeScan",
]) {
  if (!strategy3Scanner.includes(marker)) issues.push(`scan-strategy3-cache.js missing strategy3 TV-only marker ${marker}`);
}
const strategy3FixedLimitPattern = new RegExp([
  "fieldGateReadyCount=1" + "2",
  "count=1" + "2",
  "slice\\(0,\\s*8" + "0\\)",
  ["STRATEGY3_MIN", "AFTER", "1300_CANDIDATES"].join("_"),
].join("|"));
if (strategy3FixedLimitPattern.test(strategy3Scanner)) {
  issues.push("scan-strategy3-cache.js must not restore fixed result caps or deleted post-session candidate gates");
}
const deletedStrategy3ReadinessScript = path.join("scripts", ["check", "strategy3", "after" + "1300", "readiness.js"].join("-"));
if (fs.existsSync(path.join(ROOT, deletedStrategy3ReadinessScript))) {
  issues.push("deleted Strategy3 post-session readiness script must stay deleted; use check-strategy3-session-readiness.js only");
}
const strategy3SessionReadiness = read("scripts/check-strategy3-session-readiness.js");
for (const marker of ["sessionReadyCount", "minIntraday1mCandidates", "09:00-12:59 intraday status ready"]) {
  if (!strategy3SessionReadiness.includes(marker)) issues.push(`check-strategy3-session-readiness.js missing session readiness marker ${marker}`);
}
for (const marker of ["check-strategy3-source-chain.js", "liveSourceChain", "live_source_chain_tv_drift_api_"]) {
  if (!strategy3BattleStateVerifier.includes(marker)) issues.push(`verify-strategy3-battle-state.js missing live source-chain drift marker ${marker}`);
}
for (const marker of ["STRATEGY3_BATTLE_REST_ATTEMPTS", "restSafe", "sourceCount", "latest_complete_run_and_live_source_chain"]) {
  if (!strategy3BattleStateVerifier.includes(marker)) issues.push(`verify-strategy3-battle-state.js missing resilient health-read marker ${marker}`);
}
for (const marker of ["run-strategy3-complete-scan.ps1", "live_source_chain_tv_drift_api_", "post-repair"]) {
  if (!runStrategy3BattleVerify.includes(marker)) issues.push(`run-strategy3-battle-verify.ps1 missing battle self-repair marker ${marker}`);
}
for (const marker of ["Invoke-Strategy3FailureAlert", "send-workflow-alert.js", "strategy3-battle-verify-alert.json", "FumanStrategy3BattleVerify1305"]) {
  if (!runStrategy3BattleVerify.includes(marker)) issues.push(`run-strategy3-battle-verify.ps1 missing Strategy3 Gmail alert marker ${marker}`);
}
for (const marker of ["FUMAN_ALERT_DRY_RUN", "smtp:dry-run", "strategy3-battle-verify", "FumanStrategy3BattleVerify1305"]) {
  if (!strategy3AlertPathVerifier.includes(marker)) issues.push(`verify-strategy3-alert-path.js missing Strategy3 alert-path marker ${marker}`);
}
const deletedPostSessionPattern = new RegExp(["after" + "1300", "after_" + "1300", ["STRATEGY3_MIN", "AFTER", "1300"].join("_")].join("|"), "i");
if (deletedPostSessionPattern.test(strategy3SessionReadiness)) {
  issues.push("check-strategy3-session-readiness.js must not restore deleted post-session readiness logic");
}
const strategy3ReadySnapshotRefresh = read("scripts/refresh-strategy3-ready-snapshot.js");
for (const marker of ["sessionReadyCount", "MIN_INTRADAY_1M_CANDIDATES", "SESSION_LATEST_MINUTE"]) {
  if (!strategy3ReadySnapshotRefresh.includes(marker)) issues.push(`refresh-strategy3-ready-snapshot.js missing session refresh marker ${marker}`);
}
const deletedSnapshotGatePattern = new RegExp([
  ["STRATEGY3_MIN", "AFTER", "1300_CANDIDATES"].join("_"),
  "after" + "1300_ready_count",
  "after_" + "1300_candle_count",
  "has_after_" + "1300_candle",
].join("|"), "i");
if (deletedSnapshotGatePattern.test(strategy3ReadySnapshotRefresh)) {
  issues.push("refresh-strategy3-ready-snapshot.js must not restore deleted post-session ready snapshot gate");
}
for (const file of [
  "ops/public-slot/FugleSourceResourceContract.sql",
  "ops/public-slot/FugleSourceLiveRepairB6_Intraday1mCoverageStatsRpc_20260630.sql",
  "ops/public-slot/Strategy3QuoteReadyFugleFirstFix.sql",
  "ops/public-slot/Strategy3CumulativeBidAskPatch.sql",
  "ops/public-slot/Strategy3CumulativeBidAskViewOnlyPatch.sql",
  "lib/supabase-public-slot.js",
  "scripts/verify-terminal-source-contracts.js",
]) {
  if (deletedSnapshotGatePattern.test(read(file)) || deletedPostSessionPattern.test(read(file))) {
    issues.push(`${file} must not restore deleted Strategy3 post-session source fields`);
  }
}
const dailyBattleReadiness = read("scripts/verify-daily-battle-readiness.js");
const deletedDozenPattern = new RegExp([
  "details\\.api\\?\\.count\\)\\s*===\\s*1" + "2",
  "tvBreakdownRows\\)\\s*===\\s*1" + "2",
  "count\\s*===\\s*1" + "2",
  "expectedFieldGateReadyCount:\\s*1" + "2",
].join("|"));
if (deletedDozenPattern.test(dailyBattleReadiness)) {
  issues.push("verify-daily-battle-readiness.js must not restore fixed Strategy3 readiness counts");
}
const terminalResourceChain = read("scripts/verify-terminal-resource-chain.js");
for (const marker of [
  "scanner receipt",
  "sourceHealth",
  "cb_detect_scan_runs",
  "cb_detect_scan_results",
  "latest complete scan",
  "requireApiRunId",
  "requireWriteBudgetDisclosure",
  "writeBudgetStatus",
]) {
  if (!terminalResourceChain.includes(marker)) issues.push(`verify-terminal-resource-chain.js missing source contract marker ${marker}`);
}
for (const marker of [
  "terminalSupabaseUrl",
  "terminalSupabaseKey",
]) {
  if (!terminalResourceChain.includes(marker)) issues.push(`verify-terminal-resource-chain.js must use terminal Supabase resolver marker ${marker}`);
}
const marketSurfacesChain = read("scripts/verify-market-surfaces-chain.js");
for (const marker of [
  "/api/market",
  "/api/heatmap",
  "/api/market-ai-live",
  "/api/realtime-radar-latest",
  "/api/watchlist-match-index",
  "terminal-ui-e2e-report.json",
  "data-market-heatmap-mode",
]) {
  if (!marketSurfacesChain.includes(marker)) issues.push(`verify-market-surfaces-chain.js missing market surface marker ${marker}`);
}
for (const marker of [
  "fugle_quotes_latest",
  "updated_at.desc",
  "formal Strategy3 quote source",
  "formal Strategy3 intraday session readiness source",
  "TERMINAL_SOURCE_CONTRACT_FETCH_ATTEMPTS",
  "strategy4_daily_ohlcv_view",
  "v_chip_flows_latest",
  "cb_detect_scan_runs",
  "cb_detect_scan_results",
  "cumulative_bid_volume",
  "v_strategy2_readiness_status",
  "v_strategy2_readiness_missing",
  "strategy2_ready_100",
  "missing_summary",
]) {
  if (!terminalSourceContracts.includes(marker)) issues.push(`verify-terminal-source-contracts.js missing source contract marker ${marker}`);
}
for (const marker of [
  "realtimeRadarCache",
  "realtime-radar-cache",
  "fuman_realtime_radar_cache",
  "fugle_realtime_quote_latest",
  "formal quote-view fallback",
  "staleQuoteCount",
  "failedBatchCount",
  "sourceExcludedCodes",
]) {
  if (!terminalSourceContracts.includes(marker)) issues.push(`verify-terminal-source-contracts.js missing realtime radar formal source-contract marker ${marker}`);
}
const realtimeRadarSourceIndex = terminalSourceContracts.indexOf('key: "realtime-radar"');
const realtimeRadarSourceBlock = realtimeRadarSourceIndex >= 0 ? terminalSourceContracts.slice(realtimeRadarSourceIndex, realtimeRadarSourceIndex + 1600) : "";
if (!realtimeRadarSourceBlock) {
  issues.push("verify-terminal-source-contracts.js missing realtime-radar contract block");
} else if (/fugle_quotes_live/.test(realtimeRadarSourceBlock)) {
  issues.push("verify-terminal-source-contracts.js realtime-radar contract must not read retired fugle_quotes_live; use fuman_realtime_radar_cache plus fugle_realtime_quote_latest fallback");
}
const fugleSourceContract = read("ops/public-slot/FugleSourceResourceContract.sql");
for (const marker of [
  "fugle-source-contract-20260629-01",
  "source_status",
  "fugle_source_coverage",
  "v_fugle_source_contract_health",
  "v_fugle_quotes_commonstock_active",
  "fugle_intraday_1m",
  "v_fugle_intraday_1m_status",
  "get_fugle_intraday_1m_latest_n",
  "warmup_candle_count",
  "continuous_candle_count",
  "ready_ma20_continuous",
  "ready_ma35_continuous",
  "ready_macd_continuous",
  "ready_ma20_continuous_symbols",
  "ready_ma35_continuous_symbols",
  "ready_macd_continuous_symbols",
  "ready_ge_35_symbols",
  "fresh_quote_coverage_120s",
  "mother_pool_source",
  "mother_pool_symbols",
  "quote_derived_1m_full_universe",
  "quote_derived_1m_opening_backfill_rows",
  "intraday_1m_fresh_hard_seconds",
  "quote_fresh_coverage_low",
  "quote_derived_not_full_universe",
  "latest_candle_time_taipei",
]) {
  if (!fugleSourceContract.includes(marker)) issues.push(`FugleSourceResourceContract.sql missing source contract marker ${marker}`);
}
const terminalFieldCompleteness = read("scripts/verify-terminal-field-completeness.js");
for (const marker of [
  "strategy4",
  "zoneLabel",
  "institutionTotalNet",
  "realtime-radar",
  "signalTags",
  "/api/market",
  "terminal-field-completeness.md",
]) {
  if (!terminalFieldCompleteness.includes(marker)) issues.push(`verify-terminal-field-completeness.js missing terminal field contract marker ${marker}`);
}
if (!strategy2SharedSource.includes("fetchStrategy3QuoteLatestReady") || !strategy2SharedSource.includes("order: \"updated_at.desc\"")) {
  issues.push("lib/supabase-public-slot.js must keep Strategy3 latest quote fallback ordered by updated_at.desc");
}

const openBuyScanner = read("scripts/scan-open-buy-cache.js");
for (const marker of [
  "SUPABASE_OPEN_BUY_RUNS_TABLE",
  "SUPABASE_OPEN_BUY_RESULTS_TABLE",
  "incomplete scan is not eligible for run_id complete gate",
  "open-buy supabase run_id gate ok",
  "runSupabasePublishHardGate",
  "verify-supabase-publish-hard-gate.js",
  "Supabase publish hard gate blocked Strategy1 publish",
]) {
  if (!openBuyScanner.includes(marker)) issues.push(`scan-open-buy-cache.js missing strategy1 run_id complete gate marker ${marker}`);
}
const strategy1AutonomyVerifier = read("scripts/verify-strategy1-autonomy-readonly.js");
for (const marker of [
  "runSupabasePublishHardGate",
  "runPublishSourceGateAlertSmoke",
  "sourceCoverage",
  "staleSeconds",
  "latestRunId",
  "fallbackUsed",
  "writeBudget",
  "retentionOk",
  "publishAllowed",
]) {
  if (!strategy1AutonomyVerifier.includes(marker)) issues.push(`verify-strategy1-autonomy-readonly.js missing Strategy1 autonomy source gate marker ${marker}`);
}
for (const marker of ["Write-OpenBuyReceipt", "scan-receipts", "refresh-desktop-route-snapshot.ps1"]) {
  if (!runOpenBuy.includes(marker)) issues.push(`run-open-buy.ps1 missing standalone receipt/snapshot marker ${marker}`);
}
for (const marker of ["Write-InstitutionReceipt", "/api/institution-latest", "Institution API-only"]) {
  if (!runInstitution.includes(marker)) issues.push(`run-institution.ps1 missing API-only receipt marker ${marker}`);
}
if (/INSTITUTION_SOURCE_PROVIDER\s*=\s*["']finmind["']/.test(runInstitution)) {
  issues.push("run-institution.ps1 must not force INSTITUTION_SOURCE_PROVIDER=finmind; official TWSE/TPEx should run first with FinMind as fallback");
}
if (/run-cache-sync|generate-slim-cache|Sync-InstitutionLocalCache|data\\institution|data\/institution/.test(runInstitution)) {
  issues.push("run-institution.ps1 must be API-only after scanner success: no slim generation, local mirror, cache sync, or static institution data publish");
}
const strategy5Scanner = read("scripts/scan-strategy5-cache.js");
for (const marker of ["STRATEGY5_MAX_FINMIND_CHIP_AGE_DAYS", "dateAgeDays", "v_chip_flows_latest"]) {
  if (!strategy5Scanner.includes(marker)) issues.push(`scan-strategy5-cache.js missing stale FinMind chip guard marker ${marker}`);
}
for (const marker of [
  "strategy5-unattended-api-20260630-01",
  "unattended",
  "status: ok ? \"YES\" : \"NO\"",
  "canRunUnattended",
  "dataFreshness",
  "priorityStaleBlocked",
  "staleStrategy5SnapshotReason",
  "snapshot_unattended_contract_missing",
  "v_institution_source_health",
  "latest_trade_date",
]) {
  if (!strategy5LatestApi.includes(marker)) issues.push(`api/strategy5-latest.js missing unattended API marker ${marker}`);
}
for (const marker of [
  "strategy5_unattended_not_yes",
  "strategy5_data_freshness_not_fresh",
  "unattended?.status === \"YES\"",
]) {
  if (!strategy5BattleVerifier.includes(marker)) issues.push(`verify-strategy5-battle-state.js missing unattended verifier marker ${marker}`);
}
if (/run-sync-after-output|generate-slim-cache|data\\strategy5|data\/strategy5/.test(runStrategy5) || !/api\/strategy5-latest/.test(runStrategy5) || !/Strategy5 API-only/.test(runStrategy5)) {
  issues.push("run-strategy5.ps1 must be API-only after scanner success: no slim generation, cache sync, or static strategy5 data publish");
}
if (/run-cache-sync|freshness:gate|release:daily|Start-Process/.test(runWarrantFlow) || !/api\/warrant-flow-latest/.test(runWarrantFlow) || !/Warrant flow API-only/.test(runWarrantFlow)) {
  issues.push("run-warrant-flow.ps1 must be API-only after scanner success: no cache sync, release/freshness gate, or background publish");
}
if (/run-cache-sync|freshness:gate|release:daily|sync-afterhours-supabase-status|Start-Process/.test(runCbDetect) || !/api\/cb-detect-latest/.test(runCbDetect) || !/CB detect API-only/.test(runCbDetect)) {
  issues.push("run-cb-detect.ps1 must be API-only after scanner success: no cache sync, afterhours static status, release/freshness gate, or background publish");
}
for (const marker of ["cb_detect_scan_runs", "cb_detect_scan_results", "publishCbDetectCompleteRunToSupabase", "verifyCbDetectSupabaseReadback"]) {
  if (!cbDetectScanner.includes(marker)) issues.push(`generate-cb-detect.js missing CB complete-run marker ${marker}`);
}
for (const marker of [
  "cb_detect_scan_runs",
  "cb_detect_scan_results",
  "readLatestCompleteRun",
  "cacheSource: \"supabase-api\"",
  "gate: \"run_id\"",
  "sourceCoverage",
  "staleSeconds",
  "latestRunId",
  "fallbackUsed",
  "writeBudget",
  "retentionOk",
]) {
  if (!cbDetectLatestApi.includes(marker)) issues.push(`api/cb-detect-latest.js missing CB complete-run API marker ${marker}`);
}
for (const marker of [
  "verify-cb-battle-state.js",
  "cb_battle_state_verify_failed",
  "scanner_resource_health_unreadable",
  "cb_alert_actual_smtp_receipt_missing_or_failed",
  "cb-watchdog-alert.json",
  "cb-battle-verify-alert.json",
]) {
  if (!cbAutonomyVerifier.includes(marker)) issues.push(`verify-cb-autonomy-readonly.js missing CB unattended blocker marker ${marker}`);
}
for (const marker of [
  "cb-alert-path-smoke",
  "run-cb-watchdog.ps1",
  "run-cb-battle-verify.ps1",
  "sendActual",
  "smtp:dry-run",
  "channel must be smtp",
]) {
  if (!cbAlertPathVerifier.includes(marker)) issues.push(`verify-cb-alert-path.js missing CB alert path marker ${marker}`);
}
for (const marker of [
  "v_fuman_cost_governance_audit_status",
  "cost-governance-before-after-v1",
  "has_before_after_audit",
  "before_total_bytes",
  "after_total_bytes",
]) {
  if (!costGovernanceAuditVerifier.includes(marker)) {
    issues.push(`verify-cost-governance-audit.js missing cleanup audit marker ${marker}`);
  }
}
for (const marker of [
  "alter table public.fuman_retention_cleanup_log",
  "before_rows",
  "after_rows",
  "before_total_bytes",
  "after_total_bytes",
  "audit_payload",
  "create or replace function public.fuman_retention_cleanup_once",
  "create or replace function public.fuman_cleanup_intraday_1m_3d_once",
  "create or replace view public.v_fuman_cost_governance_audit_status",
  "cost-governance-before-after-v1",
]) {
  if (!costGovernanceAuditPatch.includes(marker)) {
    issues.push(`SupabaseCostGovernanceAuditPatch_20260630.sql missing cleanup audit marker ${marker}`);
  }
}
for (const marker of [
  "assertStrategy2SourcePublishGate",
  "source_status fugle_shared_source",
  "fresh_quote_coverage_120s",
  "today_1m_symbols",
  "ready_ge_35",
  "intraday_1m_stale_seconds",
  "fallbackUsed=true",
  "PreserveLatest; do not write latest",
]) {
  if (!strategy2SourcePublishGate.includes(marker)) {
    issues.push(`strategy2-source-publish-gate.js missing source publish gate marker ${marker}`);
  }
}
for (const marker of [
  "verify-supabase-publish-hard-gate.js",
  "sourceCoverage",
  "staleSeconds",
  "latestRunId",
  "fallbackUsed",
  "writeBudget",
  "retentionOk",
  "publish_blocked; preserve previous complete run; do not write latest",
  "send-workflow-alert.js",
  "supabase-publish-hard-gate-alert.json",
]) {
  if (!supabasePublishHardGate.includes(marker)) {
    issues.push(`verify-supabase-publish-hard-gate.js missing source hard gate marker ${marker}`);
  }
}
for (const marker of [
  "verify-supabase-publish-hard-gate.js",
  "--dry-run-alert",
  "publisher_replay_bypass_marker_present",
  "publishAllowed",
  "publishBlocked",
  "writePolicy",
  "preservePreviousCompleteRun",
  "smtp:dry-run",
  "api_sourceCoverage",
]) {
  if (!strategy2SourcePublishGateVerifier.includes(marker)) {
    issues.push(`verify-strategy2-source-publish-gate.js missing unattended source gate marker ${marker}`);
  }
}
for (const marker of [
  "API Unattended Scorecard",
  "strategy1",
  "strategy2",
  "strategy3",
  "strategy4",
  "strategy5",
  "institution",
  "cb",
  "warrant",
  "realtime-radar",
  "/api/open-buy-latest",
  "/api/latest-strategy?key=strategy2",
  "/api/strategy2-latest",
  "/api/strategy3-latest",
  "/api/strategy4-latest",
  "/api/strategy5-latest",
  "/api/institution-latest",
  "/api/cb-detect-latest",
  "/api/warrant-flow-latest",
  "/api/realtime-radar-latest?full=1",
  "sourceCoverageFields",
  "fresh_quote_coverage_120s",
  "today_1m_symbols",
  "ready_ge_35",
  "intraday_1m_stale_seconds",
  "fallbackUsed",
  "writeBudget",
  "retentionOk",
  "rowsChecked",
  "blankCounts",
  "sampleMissingRows",
  "verifierResults",
  "needsHumanWatch",
]) {
  if (!apiUnattendedScorecard.includes(marker)) {
    issues.push(`verify-api-unattended-scorecard.js missing all-strategy unattended marker ${marker}`);
  }
}
for (const marker of [
  "verify:api-unattended-scorecard",
  "FUMAN_API_UNATTENDED_COMPUTER",
  "FUMAN_API_UNATTENDED_SCORECARD_FILE",
  "FUMAN_API_UNATTENDED_REPORT_FILE",
  "ComputerLabel",
  "ProductionUrl",
  "SkipVerifiers",
]) {
  if (!apiUnattendedRunner.includes(marker)) {
    issues.push(`run-api-unattended-scorecard.ps1 missing external-computer runner marker ${marker}`);
  }
}
for (const marker of [
  "Fuman API Unattended Scorecard",
  "run-api-unattended-scorecard.ps1",
  "21:35",
  "Register-ScheduledTask",
]) {
  if (!apiUnattendedInstaller.includes(marker)) {
    issues.push(`install-api-unattended-scorecard-task.ps1 missing schedule installer marker ${marker}`);
  }
}
for (const retiredEarlyTime of ["08:35", "09:10", "09:35", "12:05", "20:35"]) {
  if (apiUnattendedInstaller.includes(retiredEarlyTime)) {
    issues.push(`install-api-unattended-scorecard-task.ps1 must not install early all-strategy scorecard time ${retiredEarlyTime}`);
  }
}
for (const marker of [
  "assertStrategy2SourcePublishGate",
  "writeStrategy2BlockedReceipt",
  "preservedLatest",
  "publishBlocked",
  "sendStrategy2SourceGateAlert",
  "did not write latest",
  "strategy2-source-publish-gate-alert.json",
]) {
  if (!strategy2CompleteRunPublisher.includes(marker)) {
    issues.push(`publish-strategy2-complete-run.js missing source publish blocker marker ${marker}`);
  }
}
if (/readValidatedFullWindowReplayReport|source gate using validated full-window replay|LOCAL_COMPLETE_RUN_FILE|strategy2-full-window-1m-replay/.test(strategy2CompleteRunPublisher)) {
  issues.push("publish-strategy2-complete-run.js must fail closed when source gate blocks; replay/local complete-run bypass is not allowed");
}
if (/run-full-scan|run-daily-release|freshness:gate|release:daily|scan:full|run-strategy3|run-strategy4|run-strategy5|run-institution|run-warrant-flow|run-cb-detect|run-cache-sync/.test(productionHealthMonitor + "\n" + productionHealthMonitorRunner)) {
  issues.push("production health monitor must stay read-only: no full scan, daily release, freshness gate, scanner runner, or cache sync");
}
for (const marker of ["/api/release-manifest", "release-manifest deployId missing", "release-manifest gitSha missing", "FUMAN_RELEASE_SHA"]) {
  if (!productionHealthMonitor.includes(marker)) issues.push(`monitor-production-health.js missing release identity monitor marker ${marker}`);
}
for (const marker of ["Invoke-FailureAlert", "send-workflow-alert.js", "production-health-monitor-alert.json", "FUMAN_ALERT_RECEIPT_FILE", "FumanTerminalProductionHealthMonitor"]) {
  if (!productionHealthMonitorRunner.includes(marker)) issues.push(`run-production-health-monitor.ps1 missing SMTP alert receipt marker ${marker}`);
}
for (const marker of ["REPORT_EMAIL_TO", "SMTP_USER", "SMTP_PASS", "gmail-app-password.txt", "FUMAN_ALERT_KIND", "FUMAN_ALERT_RECEIPT_FILE", "writeReceipt"]) {
  if (!workflowAlertSender.includes(marker)) issues.push(`send-workflow-alert.js missing generic SMTP alert marker ${marker}`);
}
for (const marker of ["FUMAN_ALERT_DRY_RUN", "--dry-run", "smtp:dry-run"]) {
  if (!workflowAlertSender.includes(marker)) issues.push(`send-workflow-alert.js missing dry-run SMTP alert marker ${marker}`);
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
for (const marker of ["Write-Strategy3Receipt", "scan-receipts", "refresh-desktop-route-snapshot.ps1", "check-strategy3-session-readiness.js"]) {
  if (!runStrategy3Complete.includes(marker)) issues.push(`run-strategy3-complete-scan.ps1 missing standalone receipt/snapshot marker ${marker}`);
}
const deletedRunnerPattern = new RegExp([
  "check-strategy3-after" + "1300-readiness\\.js",
  "after" + "1300_ready_count",
  ["STRATEGY3_MIN", "AFTER", "1300_CANDIDATES"].join("_"),
].join("|"));
if (deletedRunnerPattern.test(runStrategy3Complete)) {
  issues.push("run-strategy3-complete-scan.ps1 must not call the deleted post-session readiness flow");
}
if (!/FUMAN_STRATEGY3_RECEIPT_WRITE_CODE_REPO/.test(runStrategy3Complete) || !/\$writeCodeRepoReceipts/.test(runStrategy3Complete) || !/runtime-only/.test(runStrategy3Complete)) {
  issues.push("run-strategy3-complete-scan.ps1 must write Strategy3 receipts to runtime only unless FUMAN_STRATEGY3_RECEIPT_WRITE_CODE_REPO=1 is explicitly set");
}
const strategy3Watchdog = read("run-strategy3-watchdog.ps1");
for (const marker of ["/api/strategy3-latest", "Cache-Control", "no-store", "runId", "complete"]) {
  if (!strategy3Watchdog.includes(marker)) issues.push(`run-strategy3-watchdog.ps1 missing API-only watchdog marker ${marker}`);
}
if (/strategy3-latest\.json|run-cache-sync\.ps1/.test(strategy3Watchdog)) {
  issues.push("run-strategy3-watchdog.ps1 must not read strategy3 static JSON or repair through cache sync");
}

const strategy5Watchdog = read("run-strategy5-watchdog.ps1");
for (const marker of ["/api/strategy5-latest", "Cache-Control", "no-store", "runId", "complete", "21:00"]) {
  if (!strategy5Watchdog.includes(marker)) issues.push(`run-strategy5-watchdog.ps1 missing API-only watchdog marker ${marker}`);
}
if (/strategy5-latest\.json|run-cache-sync\.ps1/.test(strategy5Watchdog)) {
  issues.push("run-strategy5-watchdog.ps1 must not read strategy5 static JSON or repair through cache sync");
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
    "STRATEGY2_ENTRY_START_MINUTES = 525",
    "STRATEGY2_ENTRY_END_MINUTES = 810",
    "STRATEGY2_SCAN_END_MINUTES = 810",
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
  "coverageBelowEntryGate",
  "technicalBlocksEntry",
  "quote universe will publish but A-zone technical upgrade is disabled",
  "1分K/技術確認未就緒",
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
      "README.md",
      ".vercelignore",
      "VERCEL-COST-UPLOAD-GUARD.md",
      "scripts/deploy-production-safe.js",
      "scripts/verify-vercel-cost-guard.js",
      "scripts/verify-vercel-project-inventory.js",
      "scripts/monitor-vercel-cost-health.js",
      "scripts/install-vercel-cost-health-monitor-task.ps1",
      "run-vercel-cost-health-monitor.ps1",
      "scripts/prepare-deploy.js",
      "scripts/verify-upload-gate.js",
      "AGENTS.md",
      "MOBILE_AGENTS.md",
      "post-scan-snapshot-refreshAGENTS.MD",
      "scorecardAGENTS.MD",
      "scripts/verify-publish-gate.js",
      "fuman-sw.js",
      "api/realtime-radar-latest.js",
      "api/terminal-home.js",
      "api/strategy2-latest.js",
      "terminal-runtime-config.js",
      "scripts/e2e-smoke.js",
      "scripts/verify-deployment.js",
      "scripts/verify-warrant-freshness.js",
      "legacy-entrypoint-guard.ps1",
      "run-full-scan.ps1",
      "run-live-freshness-gate.ps1",
      "run-strategy2-intraday.ps1",
      "scanner-resource-health.ps1",
      "run-chip-source-sync.ps1",
      "run-api-only-retired-cleanup.ps1",
      "run-cache-sync.ps1",
      "run-open-buy-sync-retry.ps1",
      "scripts/intraday-radar-rules.js",
      "scripts/patrol-intraday-signals.js",
      "scripts/scan-intraday-signals.js",
      "scripts/scan-institution-cache.js",
      "scripts/sync-official-chip-data.js",
      "scripts/verify-chip-source-health.js",
      "scripts/check-scanner-resource-health.js",
      "scripts/check-strategy2-readiness-gate.js",
      "scripts/check-strategy2-trading-day.js",
      "scripts/fuman-schedule-registry.json",
      "scripts/generate-cb-detect.js",
      "scripts/install-chip-source-sync-task.ps1",
      "scripts/fugle-websocket-collector.js",
      "scripts/sync-main-deploy-source.js",
      "scripts/verify-production-guard.js",
      "scripts/verify-live-version.js",
      "scripts/verify-scorecard-snapshot.js",
      "scripts/verify-scorecard-resource-chain.js",
      "scripts/verify-scorecard-no-rollback.js",
      "scripts/verify-scorecard-health.js",
      "scripts/verify-scorecard-strategy-rules.js",
      "scripts/verify-scorecard-ui-e2e.js",
      "scripts/export-scorecard-supabase-source.js",
      "scripts/generate-terminal-scorecard-source.js",
      "scripts/scorecard-source-supabase-ops.js",
      "scripts/export-scorecard-snapshot.py",
      "scripts/publish-scorecard-snapshot.js",
      "scripts/publish-mobile-update-event.js",
      "scripts/verify-source-sync.js",
      "scripts/cleanup-api-only-retired-artifacts.js",
      "scripts/verify-deploy-worktree-clean.js",
      "scripts/monitor-deploy-worktree-clean.js",
      "scripts/install-deploy-worktree-clean-monitor-task.ps1",
      "scripts/runtime-paths.js",
      "scripts/generate-consistency-report.js",
      "scripts/generate-data-quality-report.js",
      "scripts/generate-performance-report.js",
      "scripts/generate-signal-quality-report.js",
      "scripts/generate-stocks-slim.js",
      "scripts/generate-strategy-weight-report.js",
      "scripts/verify-mobile-health.js",
      "scripts/verify-terminal-ui-e2e.js",
      "scripts/verify-mobile-api-only.js",
      "scripts/verify-mobile-ai-fragment.js",
      "install-api-only-cleanup-task.ps1",
      "run-scorecard-daily-automation.ps1",
      "run-scorecard-snapshot.ps1",
      "run-main-release-pipeline.ps1",
      "run-daily-release.ps1",
      "run-full-scan.ps1",
      "run-publish-gate.ps1",
      "refresh-desktop-route-snapshot.ps1",
      "run-open-buy.ps1",
      "run-strategy2-intraday.ps1",
      "run-strategy3.ps1",
      "run-strategy3-complete-scan.ps1",
      "run-strategy4.ps1",
      "run-strategy5.ps1",
      "run-strategy5-watchdog.ps1",
      "run-institution.ps1",
      "run-warrant-flow.ps1",
      "run-cb-detect.ps1",
      "package.json",
      "vercel.json",
      "88.html",
      "api/scorecard.js",
      "api/scorecard-health.js",
      "api/release-manifest.js",
      "lib/desktop-route-snapshot-builder.js",
      "lib/desktop-route-snapshot-cache.js",
      "lib/scorecard-rule-locks.js",
      "api/open-buy-latest.js",
      "api/cb-detect-latest.js",
      "api/institution-latest.js",
      "api/market.js",
      "api/strategy4-latest.js",
      "api/strategy5-latest.js",
      "data/scorecard-latest.json",
      "scripts/generate-slim-cache.js",
      "scripts/generate-health-summary.js",
      "scripts/verify-terminal-field-completeness.js",
      "scripts/verify-terminal-resource-chain.js",
      "scripts/verify-terminal-source-contracts.js",
      "scripts/verify-fugle-source-contract.js",
      "scripts/verify-source-sync.js",
      "REALTIME-RADAR-FRESHNESS-GOVERNANCE.md",
      "STRATEGY5-FRESHNESS-GOVERNANCE.md",
      "STRATEGY2-FRESHNESS-GOVERNANCE.md",
      "lib/supabase-public-slot.js",
      "lib/scorecard-rule-locks.js",
      "scripts/scan-intraday-signals.js",
      "ops/public-slot/Watchdog-PublicSlotSharedSource.ps1",
      "ops/public-slot/Guard-PublicSlotSourceAntiRollback.ps1",
      "ops/public-slot/Run-PublicSlotSharedSource.ps1",
      "ops/public-slot/SupabasePublicSlotSource.ps1",
      "ops/public-slot/Start-PublicSlotSharedSource.cmd",
      "ops/public-slot/fugle-websocket-collector.js",
      "ops/public-slot/FugleSourceResourceContract.sql",
      "ops/public-slot/FugleSourceLiveRepairB6_Intraday1mCoverageStatsRpc_20260630.sql",
      "ops/public-slot/FugleSourceHistorical1mMaReadinessPatch_20260701.sql",
      "ops/public-slot/SharedSourceReadOnlyScorecardPatch_20260701.sql",
      "ops/public-slot/Test-PublicSlotSharedSourceReadOnly.ps1",
      "ops/public-slot/public-slot-shared-source.config.example.json",
      "ops/public-slot/Start-Strategy2ReadinessSource.cmd",
      "ops/public-slot/Install-Strategy2ReadinessSourceTask.ps1",
      "ops/public-slot/Strategy2ReadinessContractCache.sql",
      "ops/public-slot/Strategy2Readiness100SourcePatch.sql",
      "ops/public-slot/ScorecardSourceContract.sql",
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

