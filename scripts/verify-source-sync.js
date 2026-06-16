const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_SOURCE_DIR || "C:\\fuman-terminal";

const KEY_FILES = [
  "index.html",
  "index.github.html",
  "styles.css",
  "terminal.js",
  "terminal-app.js",
  "terminal-core.js",
  "terminal-modules.js",
  "terminal-live-check.js",
  "fuman-sw.js",
  "api/version.js",
  "api/strategy5-latest.js",
  "api/terminal-home.js",
  "api/latest-signals.js",
  "api/strategy4-latest.js",
  "api/strategy3-latest.js",
  "api/strategy2-latest.js",
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
  "scripts/prepare-deploy.js",
  "scripts/scan-strategy3-cache.js",
  "scripts/scan-strategy5-cache.js",
  "scripts/scan-institution-cache.js",
  "scripts/scan-warrant-flow-cache.js",
  "scripts/verify-mobile-layout.js",
  "scripts/sync-afterhours-supabase-status.js",
  "scripts/sync-main-deploy-source.js",
  "scripts/verify-data-freshness.js",
  "scripts/verify-warrant-freshness.js",
  "scripts/verify-supabase-json.js",
  "scripts/verify-run-id-complete-gates.js",
  "data/data-consistency-report.json",
  "data/data-quality-report.json",
  "data/data-manifest.json",
  "data/data-status-index.json",
  "data/cb-detect-latest.json",
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
  "data/strategy5-latest.json",
  "data/strategy5-backup.json",
  "data/terminal-home-bundle.json",
  "data/institution-latest.json",
  "data/institution-slim.json",
  "data/institution-mobile-top.json",
  "data/institution-tdcc-breakout.json",
  "data/institution-tdcc-breakout-top.json",
  "data/warrant-flow-latest.json",
  "data/warrant-flow-slim.json",
  "data/warrant-flow-mobile-top.json",
  "data/warrant-priority-top.json",
  "data/warrant-single-signal-top.json",
  "data/flow-health-latest.json",
  "data/afterhours-supabase-status.json",
  "ops/public-slot/FinMindUnifiedQuoteViews.sql",
  "ops/public-slot/Strategy3QuoteReadyFugleFirstFix.sql",
  "ops/public-slot/Strategy5RunIdCompleteGate.sql",
  "ops/public-slot/InstitutionRunIdCompleteGate.sql",
  "ops/public-slot/WarrantFlowRunIdCompleteGate.sql",
];

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relPath(root, file) {
  return path.join(root, file);
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

if (issues.length) {
  console.error("[source-sync] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log(`[source-sync] ok source=${SOURCE_ROOT} deploy=${DEPLOY_ROOT} version=${sourceVersion || "unknown"}`);












