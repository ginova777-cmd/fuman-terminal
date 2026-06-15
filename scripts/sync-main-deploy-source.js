const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_SOURCE_DIR || "C:\\fuman-terminal";

const FILES = [
  "index.html",
  "index.github.html",
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
  "terminal-live-check.js",
  "terminal-modules.js",
  "terminal-warrant-flow.js",
  "terminal-watchlist-module.js",
  "terminal-watchlist.css",
  "lib/chip-trade-exclusions.js",
  "lib/supabase-public-slot.js",
  "fuman-sw.js",
  "api/version.js",
  "api/scan-strategy4.js",
  "terminal-strategy-config.js",
  "scripts/bump-version.js",
  "scripts/generate-cb-detect.js",
  "scripts/generate-chip-trade-exclusions.js",
  "scripts/generate-institution-tdcc-breakout.js",
  "scripts/intraday-radar-rules.js",
  "scripts/prepare-deploy.js",
  "scripts/guard-source-tree.js",
  "scripts/scan-institution-cache.js",
  "scripts/scan-realtime-radar-cache.js",
  "scripts/scan-strategy3-cache.js",
  "scripts/scan-strategy5-cache.js",
  "scripts/scan-strategy4-cache.js",
  "scripts/prewarm-strategy4-history-cache.js",
  "scripts/generate-slim-cache.js",
  "scripts/fuman-master-schedule.js",
  "scripts/fuman-schedule-registry.json",
  "scripts/patrol-schedules.js",
  "scripts/sync-afterhours-supabase-status.js",
  "scripts/sync-main-deploy-source.js",
  "scripts/verify-data-freshness.js",
  "scripts/verify-live-version.js",
  "scripts/verify-service-worker-smoke.js",
  "scripts/verify-source-sync.js",
  "scripts/verify-mobile-layout.js",
  "scripts/verify-supabase-json.js",
  "scripts/verify-version-bump-needed.js",
  "scripts/verify-version-consistency.js",
  "run-cache-sync.ps1",
  "run-auto-main-release.ps1",
  "install-auto-main-release-task.ps1",
  "run-cb-detect.ps1",
  "run-flow.ps1",
  "flow-health.ps1",
  "data/afterhours-supabase-status.json",
  "data/chip-trade-exclusions.json",
  "data/cb-detect-latest.json",
  "data/data-consistency-report.json",
  "data/data-quality-report.json",
  "data/data-manifest.json",
  "data/data-status-index.json",
  "data/live-freshness-ok.json",
  "data/market-summary.json",
  "data/mobile-home-summary.json",
  "data/performance-report.json",
  "data/signal-quality-report.json",
  "data/stocks-index.json",
  "data/stocks-quotes-mobile-top.json",
  "data/stocks-quotes-slim.json",
  "data/stocks-slim.json",
  "data/strategy-match-index.json",
  "data/strategy-weight-report.json",
  "data/strategy2-intraday-live-top.json",
  "data/strategy2-intraday-slim.json",
  "data/strategy2-intraday-top.json",
  "data/strategy4-latest.json",
  "data/strategy4-summary.json",
  "data/strategy4-slim.json",
  "data/strategy4-score-top.json",
  "data/strategy4-zone-a.json",
  "data/strategy4-zone-b.json",
  "data/strategy4-zone-c.json",
  "data/strategy5-latest.json",
  "data/strategy5-backup.json",
  "data/terminal-home-bundle.json",
  "data/institution-latest.json",
  "data/institution-slim.json",
  "data/institution-mobile-top.json",
  "data/institution-tdcc-breakout.json",
  "data/institution-tdcc-breakout-top.json",
  "data/tdcc-shareholding-1000-history.json",
  "data/warrant-flow-latest.json",
  "data/warrant-flow-slim.json",
  "data/warrant-flow-mobile-top.json",
  "data/warrant-priority-top.json",
  "data/warrant-single-signal-top.json",
  "data/flow-health-latest.json",
];

for (const zone of ["b", "c"]) {
  for (let page = 1; page <= 48; page += 1) {
    FILES.push(`data/strategy4-zone-${zone}-page-${page}.json`);
  }
}

if (!fs.existsSync(DEPLOY_ROOT)) {
  console.warn(`[sync-source] deploy root missing, skipped: ${DEPLOY_ROOT}`);
  process.exit(0);
}

let copied = 0;
for (const file of FILES) {
  const source = path.join(SOURCE_ROOT, file);
  const target = path.join(DEPLOY_ROOT, file);
  if (!fs.existsSync(source)) continue;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied += 1;
}

console.log(`[sync-source] ok copied=${copied} deploy=${DEPLOY_ROOT}`);
