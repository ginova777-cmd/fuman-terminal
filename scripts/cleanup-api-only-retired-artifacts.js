const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ROOTS = [
  process.env.FUMAN_TERMINAL_ROOT || "C:\\fuman-terminal",
  process.env.FUMAN_SYNC_ROOT || "C:\\fuman-terminal-sync",
].filter(Boolean);
const DEFAULT_RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";

const EXACT_RETIRED = [
  "scan-intraday-signals.js",
  "intraday-radar-rules.js",
  ".vercel/output/static/scan-intraday-signals.js",
  ".vercel/output/static/intraday-radar-rules.js",
  "run-open-buy-sync-retry.ps1",
  "data/live-freshness-ok.json",
  "data/open-buy-latest.json",
  "data/open-buy-backup.json",
  "data/open-buy-scorecard-source.json",
  "data/realtime-radar-latest.json",
  "data/strategy2-intraday-latest.json",
  "data/strategy2-intraday-live-top.json",
  "data/strategy2-intraday-slim.json",
  "data/strategy2-intraday-top.json",
  "data/strategy3-latest.json",
  "data/strategy3-backup.json",
  "data/strategy3-summary.json",
  "data/strategy4-latest.json",
  "data/strategy4-backup.json",
  "data/strategy4-summary.json",
  "data/strategy4-score-top.json",
  "data/strategy4-slim.json",
  "data/strategy4-zone-a.json",
  "data/strategy4-zone-b.json",
  "data/strategy4-zone-c.json",
  "data/strategy5-latest.json",
  "data/strategy5-backup.json",
  "data/strategy5-summary.json",
  "data/institution-latest.json",
  "data/institution-slim.json",
  "data/warrant-flow-latest.json",
  "data/warrant-flow-slim.json",
  "data/warrant-flow-mobile-top.json",
  "data/warrant-priority-top.json",
  "data/warrant-single-signal-top.json",
  "data/cb-detect-latest.json",
  "data/cb-detect-backup.json",
  "data/cb-detect-summary.json",
];

const RETIRED_PREFIXES = [
  "open-buy-page-",
  "strategy2-intraday-page-",
  "strategy3-page-",
  "strategy4-page-",
  "strategy4-score-page-",
  "strategy4-zone-a-page-",
  "strategy4-zone-b-page-",
  "strategy4-zone-c-page-",
  "strategy5-page-",
  "institution-page-",
  "warrant-flow-page-",
  "warrant-priority-page-",
  "warrant-single-signal-page-",
  "cb-detect-page-",
];

const RUNTIME_RETENTION_DAYS = Number(process.env.FUMAN_API_ONLY_CLEANUP_RUNTIME_RETENTION_DAYS || 14);
const LOG_RETENTION_DAYS = Number(process.env.FUMAN_API_ONLY_CLEANUP_LOG_RETENTION_DAYS || 30);

function parseArgs(argv) {
  const args = { dryRun: false, roots: [], runtimeRoot: DEFAULT_RUNTIME_ROOT, json: false, writeStatus: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--no-status") args.writeStatus = false;
    else if (arg === "--root") args.roots.push(argv[++i]);
    else if (arg.startsWith("--root=")) args.roots.push(arg.slice("--root=".length));
    else if (arg === "--runtime-root") args.runtimeRoot = argv[++i];
    else if (arg.startsWith("--runtime-root=")) args.runtimeRoot = arg.slice("--runtime-root=".length);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/cleanup-api-only-retired-artifacts.js [--dry-run] [--root PATH] [--runtime-root PATH] [--json]");
      process.exit(0);
    }
  }
  if (!args.roots.length) args.roots = DEFAULT_ROOTS;
  args.roots = [...new Set(args.roots.map((item) => path.resolve(item)).filter(Boolean))];
  return args;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rmFile(root, rel, result, dryRun) {
  const target = path.resolve(root, rel);
  if (!isInside(root, target)) {
    result.skipped.push({ path: target, reason: "outside-root" });
    return;
  }
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    result.skipped.push({ path: target, reason: "not-file" });
    return;
  }
  if (!dryRun) fs.unlinkSync(target);
  result.deleted.push(target);
}

function listRetiredDataFiles(root) {
  const dataDir = path.join(root, "data");
  if (!fs.existsSync(dataDir)) return [];
  const files = fs.readdirSync(dataDir, { withFileTypes: true });
  const matched = [];
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (RETIRED_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
      matched.push(path.join("data", entry.name));
    }
  }
  return matched;
}

function pruneOldFiles(dir, maxAgeDays, result, dryRun) {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pruneOldFiles(target, maxAgeDays, result, dryRun);
      try {
        if (!dryRun && fs.existsSync(target) && fs.readdirSync(target).length === 0) fs.rmdirSync(target);
      } catch {}
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(target);
    if (stat.mtimeMs > cutoff) continue;
    if (!dryRun) fs.unlinkSync(target);
    result.deleted.push(target);
  }
}

function cleanupRoot(root, args) {
  const result = { root, exists: fs.existsSync(root), deleted: [], skipped: [] };
  if (!result.exists) return result;
  for (const rel of [...EXACT_RETIRED, ...listRetiredDataFiles(root)]) {
    rmFile(root, rel, result, args.dryRun);
  }
  return result;
}

function writeStatus(runtimeRoot, payload) {
  const statusDir = path.join(runtimeRoot, "status");
  fs.mkdirSync(statusDir, { recursive: true });
  fs.writeFileSync(path.join(statusDir, "api-only-retired-cleanup-status.json"), JSON.stringify(payload, null, 2), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const rootResults = args.roots.map((root) => cleanupRoot(root, args));
  const runtimeResult = { root: args.runtimeRoot, deleted: [], skipped: [] };
  pruneOldFiles(path.join(args.runtimeRoot, "archive", "strategy2-intraday", "static-latest"), RUNTIME_RETENTION_DAYS, runtimeResult, args.dryRun);
  pruneOldFiles(path.join(args.runtimeRoot, "logs"), LOG_RETENTION_DAYS, runtimeResult, args.dryRun);

  const payload = {
    ok: true,
    dryRun: args.dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    source: "api-only-retired-artifact-cleanup",
    repoRoot: REPO_ROOT,
    roots: rootResults,
    runtime: runtimeResult,
    deletedCount: rootResults.reduce((sum, item) => sum + item.deleted.length, 0) + runtimeResult.deleted.length,
  };
  if (args.writeStatus && !args.dryRun) writeStatus(args.runtimeRoot, payload);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`[api-only-cleanup] ok dryRun=${args.dryRun} deleted=${payload.deletedCount}`);
    for (const root of rootResults) console.log(`[api-only-cleanup] root=${root.root} deleted=${root.deleted.length}`);
    console.log(`[api-only-cleanup] runtime=${args.runtimeRoot} deleted=${runtimeResult.deleted.length}`);
  }
}

main().catch((error) => {
  console.error(`[api-only-cleanup] failed: ${error?.stack || error?.message || error}`);
  process.exit(1);
});

