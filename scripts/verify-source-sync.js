const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_SOURCE_DIR || "C:\\fuman-terminal";

const KEY_FILES = [
  "index.html",
  "index.github.html",
  "88.html",
  "styles.css",
  "terminal.js",
  "terminal-app.js",
  "terminal-core.js",
  "terminal-modules.js",
  "terminal-live-check.js",
  "fuman-sw.js",
  "api/version.js",
  "api/scorecard.js",
  "api/strategy5-latest.js",
  "api/terminal-home.js",
  "api/latest-signals.js",
  "api/strategy4-latest.js",
  "api/strategy3-latest.js",
  "api/latest-strategy.js",
  "api/market.js",
  "api/realtime-radar-latest.js",
  "api/institution-latest.js",
  "api/warrant-flow-latest.js",
  "api/scan-warrant-flow.js",
  "terminal-chip-flow.js",
  "terminal-warrant-flow.js",
  "terminal-watchlist-module.js",
  "terminal-watchlist.css",
  "lib/supabase-public-slot.js",
  "terminal-strategy-config.js",
  "version.json",
  "package.json",
  "scripts/bump-version.js",
  "scripts/generate-cb-detect.js",
  "scripts/sync-official-chip-data.js",
  "scripts/verify-chip-source-health.js",
  "scripts/check-scanner-resource-health.js",
  "scripts/install-chip-source-sync-task.ps1",
  "scripts/prepare-deploy.js",
  "scripts/runtime-paths.js",
  "scripts/generate-slim-cache.js",
  "scripts/generate-consistency-report.js",
  "scripts/generate-data-quality-report.js",
  "scripts/generate-performance-report.js",
  "scripts/generate-signal-quality-report.js",
  "scripts/generate-stocks-slim.js",
  "scripts/generate-strategy-weight-report.js",
  "scripts/scan-strategy3-cache.js",
  "scripts/scan-strategy5-cache.js",
  "scripts/scan-institution-cache.js",
  "scripts/scan-warrant-flow-cache.js",
  "scripts/verify-mobile-layout.js",
  "scripts/verify-production-guard.js",
  "scripts/verify-scorecard-snapshot.js",
  "scripts/verify-terminal-resource-chain.js",
  "scripts/verify-terminal-source-contracts.js",
  "scripts/verify-terminal-field-completeness.js",
  "scripts/sync-afterhours-supabase-status.js",
  "scripts/sync-main-deploy-source.js",
  "scripts/verify-deploy-worktree-clean.js",
  "scripts/monitor-deploy-worktree-clean.js",
  "scripts/install-deploy-worktree-clean-monitor-task.ps1",
  "scripts/verify-warrant-freshness.js",
  "scripts/verify-run-id-complete-gates.js",
  "scripts/publish-mobile-update-event.js",
  "scripts/verify-mobile-health.js",
  "scripts/verify-mobile-api-only.js",
  "scripts/verify-mobile-ai-fragment.js",
  "scripts/export-scorecard-snapshot.py",
  "scripts/publish-scorecard-snapshot.js",
  "legacy-entrypoint-guard.ps1",
  "scanner-resource-health.ps1",
  "run-chip-source-sync.ps1",
  "refresh-desktop-route-snapshot.ps1",
  "run-scorecard-snapshot.ps1",
  "run-full-scan.ps1",
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
  "data/chip-trade-exclusions.json",
  "data/scorecard-latest.json",
  "ops/public-slot/FinMindUnifiedQuoteViews.sql",
  "ops/public-slot/Strategy3QuoteReadyFugleFirstFix.sql",
  "ops/public-slot/Strategy5RunIdCompleteGate.sql",
  "ops/public-slot/InstitutionRunIdCompleteGate.sql",
  "ops/public-slot/WarrantFlowRunIdCompleteGate.sql",
];

const RETIRED_ARTIFACTS = [
  "run-open-buy-sync-retry.ps1",
  "data/strategy4-latest.json",
  "data/strategy4-backup.json",
  "data/strategy4-summary.json",
  "data/strategy4-score-top.json",
  "data/strategy4-slim.json",
  "data/strategy4-zone-a.json",
  "data/strategy4-zone-b.json",
  "data/strategy4-zone-c.json",
];

for (const prefix of [
  "strategy4",
  "strategy4-zone-a",
  "strategy4-zone-b",
  "strategy4-zone-c",
]) {
  for (let page = 1; page <= 24; page += 1) {
    RETIRED_ARTIFACTS.push(`data/${prefix}-page-${page}.json`);
  }
}

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".ps1",
  ".sql",
]);

function comparableContent(file) {
  if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    return fs.readFileSync(file);
  }
  return fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

function sha256(file) {
  return crypto.createHash("sha256").update(comparableContent(file)).digest("hex");
}

function relPath(root, file) {
  return path.join(root, file);
}

function isSamePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function detectVersion(root) {
  const core = relPath(root, "terminal-core.js");
  if (!fs.existsSync(core)) return "";
  return fs.readFileSync(core, "utf8").match(/const\s+version\s*=\s*"([^"]+)"/)?.[1] || "";
}

const issues = [];
if (!fs.existsSync(DEPLOY_ROOT)) {
  console.warn(`[source-sync] deploy source not found, skipped local compare: ${DEPLOY_ROOT}`);
  process.exit(0);
}

const sourceVersion = detectVersion(SOURCE_ROOT);
const deployVersion = detectVersion(DEPLOY_ROOT);
if (sourceVersion !== deployVersion) {
  issues.push(`version mismatch source=${sourceVersion || "unknown"} deploy=${deployVersion || "unknown"}`);
}

for (const file of KEY_FILES) {
  const sourceFile = relPath(SOURCE_ROOT, file);
  const deployFile = relPath(DEPLOY_ROOT, file);
  if (!fs.existsSync(sourceFile)) {
    issues.push(`source missing ${file}`);
    continue;
  }
  if (!fs.existsSync(deployFile)) {
    issues.push(`deploy source missing ${file}`);
    continue;
  }
  const sourceHash = sha256(sourceFile);
  const deployHash = sha256(deployFile);
  if (sourceHash !== deployHash) {
    issues.push(`hash mismatch ${file} source=${sourceHash.slice(0, 12)} deploy=${deployHash.slice(0, 12)}`);
  }
}

if (!isSamePath(SOURCE_ROOT, DEPLOY_ROOT)) {
  for (const file of RETIRED_ARTIFACTS) {
    const deployFile = relPath(DEPLOY_ROOT, file);
    if (fs.existsSync(deployFile)) {
      issues.push(`deploy source contains retired artifact ${file}`);
    }
  }
}

if (issues.length) {
  console.error("[source-sync] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log(`[source-sync] ok source=${SOURCE_ROOT} deploy=${DEPLOY_ROOT} version=${sourceVersion || "unknown"}`);













