const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_SOURCE_DIR || "C:\\fuman-terminal";
const RESERVED_PRODUCTION_ROUTES = [
  "/88",
];
const RESERVED_ROUTE_ARTIFACTS = new Set(RESERVED_PRODUCTION_ROUTES.flatMap((route) => {
  const slug = String(route || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!slug) return [];
  return [
    slug,
    `${slug}.html`,
    path.join(slug, "index.html"),
    path.join("api", `${slug}.js`),
    path.join(".vercel", "output", "static", slug),
    path.join(".vercel", "output", "static", `${slug}.html`),
    path.join(".vercel", "output", "static", slug, "index.html"),
  ].map((item) => item.replace(/\\/g, "/").toLowerCase());
}));

const FILES = [
  "index.html",
  "index.github.html",
  "88.html",
  "mobile.html",
  "refresh.html",
  "version.json",
  "vercel.json",
  "package.json",
  "AGENTS.md",
  "MOBILE_AGENTS.md",
  "post-scan-snapshot-refreshAGENTS.MD",
  "scorecardAGENTS.MD",
  "check-fuman-schedules.ps1",
  "styles.css",
  "terminal.js",
  "terminal-app.js",
  "terminal-ai-risk-guard.js",
  "terminal-chip-flow.js",
  "terminal-core.js",
  "terminal-desktop-fast-shell.js",
  "terminal-runtime-config.js",
  "terminal-live-check.js",
  "terminal-market-ai-live-watchdog.js",
  "terminal-modules.js",
  "terminal-warrant-flow.js",
  "terminal-watchlist-module.js",
  "terminal-watchlist.css",
  "lib/desktop-route-snapshot-builder.js",
  "lib/desktop-route-snapshot-cache.js",
  "lib/chip-trade-exclusions.js",
  "lib/scorecard-rule-locks.js",
  "lib/supabase-public-slot.js",
  "lib/strategy2-source-publish-gate.js",
  "lib/strategy-cache-status.js",
  "fuman-sw.js",
  "api/release-manifest.js",
  "api/version.js",
  "api/scorecard.js",
  "api/scorecard-health.js",
  "api/mobile-boot.js",
  "api/open-buy-latest.js",
  "api/strategy5-latest.js",
  "api/strategy3-latest.js",
  "api/strategy2-latest.js",
  "api/institution-latest.js",
  "api/warrant-flow-latest.js",
  "api/scan-warrant-flow.js",
  "api/scan-strategy4.js",
  "api/strategy4-latest.js",
  "api/cb-detect-latest.js",
  "api/desktop-static-disabled.js",
  "api/latest-signals.js",
  "api/latest-strategy.js",
  "api/market.js",
  "api/heatmap.js",
  "api/market-ai-live.js",
  "api/realtime-radar-latest.js",
  "api/terminal-home.js",
  "api/refresh.js",
  "api/performance-report.js",
  "terminal-strategy-config.js",
  "scripts/bump-version.js",
  "scripts/runtime-paths.js",
  "scripts/generate-cb-detect.js",
  "scripts/generate-consistency-report.js",
  "scripts/generate-data-quality-report.js",
  "scripts/generate-performance-report.js",
  "scripts/generate-signal-quality-report.js",
  "scripts/generate-stocks-slim.js",
  "scripts/generate-strategy-weight-report.js",
  "scripts/generate-chip-trade-exclusions.js",
  "scripts/generate-institution-tdcc-breakout.js",
  "scripts/intraday-radar-rules.js",
  "scripts/scan-intraday-signals.js",
  "scripts/fugle-websocket-collector.js",
  "scripts/sync-official-chip-data.js",
  "scripts/verify-chip-source-health.js",
  "scripts/check-scanner-resource-health.js",
  "scripts/check-publish-source-gate.js",
  "scripts/check-strategy2-readiness-gate.js",
  "scripts/check-strategy2-trading-day.js",
  "scripts/install-chip-source-sync-task.ps1",
  "scripts/prepare-deploy.js",
  "scripts/deploy-production-with-release-env.js",
  "scripts/guard-source-tree.js",
  "scripts/scan-open-buy-cache.js",
  "scripts/scan-star-preopen.js",
  "scripts/scan-warrant-flow-cache.js",
  "scripts/cleanup-api-only-retired-artifacts.js",
  "scripts/verify-deploy-worktree-clean.js",
  "scripts/monitor-deploy-worktree-clean.js",
  "scripts/monitor-production-health.js",
  "scripts/send-workflow-alert.js",
  "scripts/install-deploy-worktree-clean-monitor-task.ps1",
  "scripts/scan-institution-cache.js",
  "scripts/scan-realtime-radar-cache.js",
  "scripts/scan-strategy3-cache.js",
  "scripts/publish-strategy2-complete-run.js",
  "scripts/publish-strategy2-latest-snapshot.js",
  "scripts/publish-mobile-update-event.js",
  "scripts/scan-strategy5-cache.js",
  "scripts/scan-strategy4-cache.js",
  "scripts/strategy-api-capture.js",
  "scripts/publish-strategy-cache-status.js",
  "scripts/verify-strategy-runtime-chain.js",
  "scripts/prewarm-strategy4-history-cache.js",
  "scripts/generate-slim-cache.js",
  "scripts/fuman-schedule-registry.json",
  "scripts/migrate-fuman-freshness-gate-2010-task.ps1",
  "scripts/remove-fuman-retired-schedule-tasks.ps1",
  "scripts/sync-afterhours-supabase-status.js",
  "scripts/sync-main-deploy-source.js",
  "scripts/verify-desktop-api-only.js",
  "scripts/verify-production-guard.js",
  "scripts/verify-publish-gate.js",
  "scripts/verify-terminal-ui-e2e.js",
  "scripts/verify-cb-autonomy-readonly.js",
  "scripts/verify-cb-battle-state.js",
  "scripts/verify-cb-alert-path.js",
  "scripts/verify-cost-governance-audit.js",
  "scripts/verify-supabase-publish-hard-gate.js",
  "scripts/verify-strategy5-battle-state.js",
  "scripts/verify-heatmap-realtime.js",
  "scripts/verify-market-ai-freshness-guard.js",
  "scripts/verify-market-surfaces-chain.js",
  "scripts/verify-terminal-resource-chain.js",
  "scripts/verify-terminal-source-contracts.js",
  "scripts/verify-terminal-field-completeness.js",
  "scripts/verify-terminal-cold-start-performance.js",
  "scripts/verify-scorecard-snapshot.js",
  "scripts/verify-scorecard-resource-chain.js",
  "scripts/verify-scorecard-no-rollback.js",
  "scripts/verify-scorecard-health.js",
  "scripts/verify-scorecard-strategy-rules.js",
  "scripts/verify-scorecard-ui-e2e.js",
  "scripts/verify-warrant-freshness.js",
  "scripts/verify-live-version.js",
  "scripts/verify-service-worker-smoke.js",
  "scripts/verify-source-sync.js",
  "scripts/verify-sync-hard-gate.js",
  "scripts/verify-production-mirror-guard.js",
  "scripts/verify-final-readonly.js",
  "scripts/verify-retired-artifacts-clean.js",
  "scripts/verify-mobile-health.js",
  "scripts/verify-mobile-layout.js",
  "scripts/verify-mobile-entry-redirect.js",
  "scripts/verify-mobile-api-only.js",
  "scripts/verify-mobile-ai-fragment.js",
  "scripts/verify-mobile-realtime.js",
  "scripts/verify-run-id-complete-gates.js",
  "scripts/verify-version-bump-needed.js",
  "scripts/verify-version-consistency.js",
  "scripts/export-scorecard-supabase-source.js",
  "scripts/generate-terminal-scorecard-source.js",
  "scripts/scorecard-source-supabase-ops.js",
  "scripts/export-scorecard-snapshot.py",
  "scripts/publish-scorecard-snapshot.js",
  "scripts/verify-post-scan-snapshot-refresh-contract.js",
  "ops/public-slot/Strategy1RunIdCompleteGate.sql",
  "ops/public-slot/Strategy2ReadinessContractCache.sql",
  "ops/public-slot/Strategy2Readiness100SourcePatch.sql",
  "ops/public-slot/FugleSourceLiveRepairB6_Intraday1mCoverageStatsRpc_20260630.sql",
  "ops/public-slot/StrategyCacheStatusAndLatestPayload.sql",
  "ops/public-slot/FinMindUnifiedQuoteViews.sql",
  "ops/public-slot/Strategy3QuoteReadyFugleFirstFix.sql",
  "ops/public-slot/Strategy5RunIdCompleteGate.sql",
  "ops/public-slot/SupabaseCostGovernanceAuditPatch_20260630.sql",
  "ops/public-slot/InstitutionRunIdCompleteGate.sql",
  "ops/public-slot/ScorecardSourceContract.sql",
  "ops/public-slot/WarrantFlowRunIdCompleteGate.sql",
  "ops/public-slot/Watchdog-PublicSlotSharedSource.ps1",
  "ops/public-slot/Guard-PublicSlotSourceAntiRollback.ps1",
  "ops/public-slot/Run-PublicSlotSharedSource.ps1",
  "ops/public-slot/SupabasePublicSlotSource.ps1",
  "ops/public-slot/public-slot-shared-source.config.example.json",
  "ops/public-slot/Start-Strategy2ReadinessSource.cmd",
  "ops/public-slot/Install-Strategy2ReadinessSourceTask.ps1",
  "ops/public-slot/Install-PublicSlotSharedSourceWatchdog.ps1",
  "ops/public-slot/MobileUpdateEventsMaintenance.sql",
  "legacy-entrypoint-guard.ps1",
  "run-live-freshness-gate.ps1",
  "scanner-resource-health.ps1",
  "run-chip-source-sync.ps1",
  "refresh-desktop-route-snapshot.ps1",
  "run-post-scan-snapshot-refresh-verify.ps1",
  "run-scorecard-daily-automation.ps1",
  "run-scorecard-snapshot.ps1",
  "run-api-only-retired-cleanup.ps1",
  "run-full-scan.ps1",
  "run-publish-gate.ps1",
  "run-cache-sync.ps1",
  "run-production-health-monitor.ps1",
  "install-api-only-cleanup-task.ps1",
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
  "run-realtime-radar.ps1",
  "run-flow.ps1",
  "flow-health.ps1",
  "data/chip-trade-exclusions.json",
  "data/scorecard-latest.json",
];

const DIRECTORIES = [];

const STRATEGY4_KEY = "strategy" + "4";
const LEGACY_FRESHNESS_OK_FILE = path.join("data", "live-" + "freshness-ok.json");

const RETIRED_ARTIFACTS = [
  "run-open-buy-sync-retry.ps1",
  "run-freshness-gate-task.ps1",
  "run-local-freshness-repair.ps1",
  "open-buy-latest.json",
  "open-buy-backup.json",
  "institution-latest.json",
  "institution-backup.json",
  "strategy4-latest.json",
  "strategy4-backup.json",
  "strategy5-latest.json",
  "strategy5-backup.json",
  "warrant-flow-latest.json",
  "warrant-flow-backup.json",
  "scan-institution-cache.js",
  "scan-open-buy-cache.js",
  "scan-open-buy.js",
  "scan-strategy4-cache.js",
  "scan-strategy4.js",
  "scan-strategy5-cache.js",
  "scan-warrant-flow-cache.js",
  "scan-warrant-flow.js",
  LEGACY_FRESHNESS_OK_FILE,
  path.join("data", "chip-trade-health-latest.json"),
  path.join("data", "fugle-open-rebound-latest.json"),
  path.join("data", "institution-mobile-top.json"),
  path.join("data", `${STRATEGY4_KEY}-latest.json`),
  path.join("data", `${STRATEGY4_KEY}-backup.json`),
  path.join("data", `${STRATEGY4_KEY}-summary.json`),
  path.join("data", `${STRATEGY4_KEY}-score-top.json`),
  path.join("data", `${STRATEGY4_KEY}-slim.json`),
  path.join("data", `${STRATEGY4_KEY}-zone-a.json`),
  path.join("data", `${STRATEGY4_KEY}-zone-b.json`),
  path.join("data", `${STRATEGY4_KEY}-zone-c.json`),
];

for (const prefix of [
  STRATEGY4_KEY,
  `${STRATEGY4_KEY}-zone-a`,
  `${STRATEGY4_KEY}-zone-b`,
  `${STRATEGY4_KEY}-zone-c`,
  "warrant-volume",
]) {
  for (let page = 1; page <= 24; page += 1) {
    RETIRED_ARTIFACTS.push(path.join("data", `${prefix}-page-${page}.json`));
  }
}

if (!fs.existsSync(DEPLOY_ROOT)) {
  console.warn(`[sync-source] deploy root missing, skipped: ${DEPLOY_ROOT}`);
  process.exit(0);
}

let copied = 0;
let retiredDeleted = 0;

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".md",
  ".ps1",
  ".sql",
]);

function isSamePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isReservedRouteArtifact(rel) {
  const key = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  return RESERVED_ROUTE_ARTIFACTS.has(key);
}

function isGitTracked(root, rel) {
  if (!fs.existsSync(path.join(root, ".git"))) return false;
  const result = require("child_process").spawnSync("git", ["ls-files", "--error-unmatch", "--", rel.replace(/\\/g, "/")], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}

function deleteRetiredArtifacts() {
  if (isSamePath(SOURCE_ROOT, DEPLOY_ROOT)) return;
  for (const file of RETIRED_ARTIFACTS) {
    if (isReservedRouteArtifact(file)) continue;
    const target = path.join(DEPLOY_ROOT, file);
    if (!isInside(DEPLOY_ROOT, target) || !fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (!stat.isFile()) continue;
    if (isGitTracked(DEPLOY_ROOT, file)) continue;
    fs.unlinkSync(target);
    retiredDeleted += 1;
  }
}

function comparableContent(file) {
  if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    return fs.readFileSync(file);
  }
  return fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

function shouldCopy(source, target) {
  if (!fs.existsSync(target)) return true;
  return comparableContent(source) !== comparableContent(target);
}

function copyFileIfChanged(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!shouldCopy(source, target)) return false;
  fs.copyFileSync(source, target);
  return true;
}

deleteRetiredArtifacts();

for (const file of FILES) {
  const source = path.join(SOURCE_ROOT, file);
  const target = path.join(DEPLOY_ROOT, file);
  if (!fs.existsSync(source)) continue;
  if (copyFileIfChanged(source, target)) copied += 1;
}

let copiedFromDirs = 0;
function copyDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, target);
    } else if (entry.isFile()) {
      if (copyFileIfChanged(source, target)) copiedFromDirs += 1;
    }
  }
}

for (const directory of DIRECTORIES) {
  copyDirectory(path.join(SOURCE_ROOT, directory), path.join(DEPLOY_ROOT, directory));
}

console.log(`[sync-source] ok copied=${copied} copiedFromDirs=${copiedFromDirs} retiredDeleted=${retiredDeleted} deploy=${DEPLOY_ROOT}`);












