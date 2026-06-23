const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_SOURCE_DIR || "C:\\fuman-terminal";

const FILES = [
  "index.html",
  "index.github.html",
  "mobile.html",
  "refresh.html",
  "version.json",
  "vercel.json",
  "package.json",
  "styles.css",
  "terminal.js",
  "terminal-app.js",
  "terminal-ai-risk-guard.js",
  "terminal-chip-flow.js",
  "terminal-core.js",
  "terminal-runtime-config.js",
  "terminal-live-check.js",
  "terminal-modules.js",
  "terminal-warrant-flow.js",
  "terminal-watchlist-module.js",
  "terminal-watchlist.css",
  "lib/chip-trade-exclusions.js",
  "lib/supabase-public-slot.js",
  "lib/strategy-cache-status.js",
  "fuman-sw.js",
  "api/version.js",
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
  "api/terminal-home.js",
  "api/refresh.js",
  "api/performance-report.js",
  "terminal-strategy-config.js",
  "scripts/bump-version.js",
  "scripts/generate-cb-detect.js",
  "scripts/generate-chip-trade-exclusions.js",
  "scripts/generate-institution-tdcc-breakout.js",
  "scripts/intraday-radar-rules.js",
  "scripts/prepare-deploy.js",
  "scripts/guard-source-tree.js",
  "scripts/scan-open-buy-cache.js",
  "scripts/scan-star-preopen.js",
  "scripts/scan-warrant-flow-cache.js",
  "scripts/cleanup-api-only-retired-artifacts.js",
  "scripts/scan-institution-cache.js",
  "scripts/scan-realtime-radar-cache.js",
  "scripts/scan-strategy3-cache.js",
  "scripts/publish-strategy2-complete-run.js",
  "scripts/publish-mobile-update-event.js",
  "scripts/scan-strategy5-cache.js",
  "scripts/scan-strategy4-cache.js",
  "scripts/strategy-api-capture.js",
  "scripts/publish-strategy-cache-status.js",
  "scripts/verify-strategy-runtime-chain.js",
  "scripts/prewarm-strategy4-history-cache.js",
  "scripts/generate-slim-cache.js",
  "scripts/fuman-master-schedule.js",
  "scripts/fuman-schedule-registry.json",
  "scripts/patrol-schedules.js",
  "scripts/sync-afterhours-supabase-status.js",
  "scripts/sync-main-deploy-source.js",
  "scripts/verify-desktop-api-only.js",
  "scripts/verify-publish-gate.js",
  "scripts/verify-warrant-freshness.js",
  "scripts/verify-live-version.js",
  "scripts/verify-service-worker-smoke.js",
  "scripts/verify-source-sync.js",
  "scripts/verify-mobile-layout.js",
  "scripts/verify-mobile-entry-redirect.js",
  "scripts/verify-mobile-ai-fragment.js",
  "scripts/verify-mobile-realtime.js",
  "scripts/verify-supabase-json.js",
  "scripts/verify-run-id-complete-gates.js",
  "scripts/verify-version-bump-needed.js",
  "scripts/verify-version-consistency.js",
  "ops/public-slot/Strategy1RunIdCompleteGate.sql",
  "ops/public-slot/StrategyCacheStatusAndLatestPayload.sql",
  "ops/public-slot/FinMindUnifiedQuoteViews.sql",
  "ops/public-slot/Strategy3QuoteReadyFugleFirstFix.sql",
  "ops/public-slot/Strategy5RunIdCompleteGate.sql",
  "ops/public-slot/InstitutionRunIdCompleteGate.sql",
  "ops/public-slot/WarrantFlowRunIdCompleteGate.sql",
  "ops/public-slot/MobileUpdateEventsMaintenance.sql",
  "run-live-freshness-gate.ps1",
  "run-api-only-retired-cleanup.ps1",
  "run-cache-sync.ps1",
  "run-auto-main-release.ps1",
  "install-auto-main-release-task.ps1",
  "install-api-only-cleanup-task.ps1",
  "run-cb-detect.ps1",
  "run-flow.ps1",
  "flow-health.ps1",
  "data/afterhours-supabase-status.json",
  "data/chip-trade-exclusions.json",
  "data/data-consistency-report.json",
  "data/data-quality-report.json",
  "data/data-manifest.json",
  "data/data-status-index.json",
  "data/market-summary.json",
  "data/heatmap-latest.json",
  "data/market-ai-breadth-latest.json",
  "data/market-ai-panel-latest.json",
  "data/market-ai-live.json",
  "data/mobile-boot.json",
  "data/mobile-runtime-config.json",
  "data/mobile-terminal-latest.json",
  "data/mobile-ai-latest.html",
  "data/mobile-ai-lite.html",
  "data/mobile-ai-ultra.html",
  "data/mobile-strategy1-ultra.html",
  "data/mobile-strategy2-ultra.html",
  "data/mobile-strategy3-ultra.html",
  "data/mobile-strategy4-ultra.html",
  "data/mobile-strategy5-ultra.html",
  "data/mobile-chip-ultra.html",
  "data/mobile-warrant-ultra.html",
  "data/mobile-digest.json",
  "data/mobile-home-summary.json",
  "data/performance-report.json",
  "data/signal-quality-report.json",
  "data/stocks-index.json",
  "data/stocks-quotes-mobile-top.json",
  "data/stocks-quotes-slim.json",
  "data/stocks-slim.json",
  "data/star-preopen-latest.json",
  "data/star-preopen-backup.json",
  "data/star-preopen-scorecard-source.json",
  "data/strategy-match-index.json",
  "data/strategy-weight-report.json",
  "data/terminal-home-bundle.json",
  "data/terminal-home-mobile-slim.json",
  "data/institution-tdcc-breakout.json",
  "data/institution-tdcc-breakout-top.json",
  "data/institution-tdcc-breakout.csv",
  "data/tdcc-shareholding-1000-history.json",
  "data/flow-health-latest.json",
];

const DIRECTORIES = [
  "data/mobile-analysis",
];

const STRATEGY4_KEY = "strategy" + "4";
const LEGACY_FRESHNESS_OK_FILE = path.join("data", "live-" + "freshness-ok.json");

const RETIRED_ARTIFACTS = [
  "run-open-buy-sync-retry.ps1",
  LEGACY_FRESHNESS_OK_FILE,
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
    if (prefix === "warrant-volume") {
      FILES.push(`data/${prefix}-page-${page}.json`);
    } else {
      RETIRED_ARTIFACTS.push(path.join("data", `${prefix}-page-${page}.json`));
    }
  }
}

if (!fs.existsSync(DEPLOY_ROOT)) {
  console.warn(`[sync-source] deploy root missing, skipped: ${DEPLOY_ROOT}`);
  process.exit(0);
}

let copied = 0;
let retiredDeleted = 0;

function isSamePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function deleteRetiredArtifacts() {
  if (isSamePath(SOURCE_ROOT, DEPLOY_ROOT)) return;
  for (const file of RETIRED_ARTIFACTS) {
    const target = path.join(DEPLOY_ROOT, file);
    if (!isInside(DEPLOY_ROOT, target) || !fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (!stat.isFile()) continue;
    fs.unlinkSync(target);
    retiredDeleted += 1;
  }
}

deleteRetiredArtifacts();

for (const file of FILES) {
  const source = path.join(SOURCE_ROOT, file);
  const target = path.join(DEPLOY_ROOT, file);
  if (!fs.existsSync(source)) continue;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied += 1;
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
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      copiedFromDirs += 1;
    }
  }
}

for (const directory of DIRECTORIES) {
  copyDirectory(path.join(SOURCE_ROOT, directory), path.join(DEPLOY_ROOT, directory));
}

console.log(`[sync-source] ok copied=${copied} copiedFromDirs=${copiedFromDirs} retiredDeleted=${retiredDeleted} deploy=${DEPLOY_ROOT}`);











