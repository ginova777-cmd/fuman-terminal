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
  "api/latest-strategy.js",
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
  "scripts/verify-warrant-freshness.js",
  "scripts/verify-run-id-complete-gates.js",
  "data/data-consistency-report.json",
  "data/data-quality-report.json",
  "data/performance-report.json",
  "data/signal-quality-report.json",
  "data/stocks-index.json",
  "data/stocks-quotes-mobile-top.json",
  "data/stocks-quotes-slim.json",
  "data/stocks-slim.json",
  "data/strategy-match-index.json",
  "data/strategy-weight-report.json",
  "data/afterhours-supabase-status.json",
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













