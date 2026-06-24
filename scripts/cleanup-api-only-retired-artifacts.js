const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ROOTS = [
  process.env.FUMAN_TERMINAL_ROOT || "C:\\fuman-terminal",
  process.env.FUMAN_SYNC_ROOT || "C:\\fuman-terminal-sync",
].filter(Boolean);
const DEFAULT_RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";

const EXACT_RETIRED = [
  "scan-intraday-signals.js",
  "intraday-radar-rules.js",
  "scan-institution-cache.js",
  "scan-open-buy-cache.js",
  "scan-open-buy.js",
  "scan-strategy4-cache.js",
  "scan-strategy4.js",
  "scan-strategy5-cache.js",
  "scan-warrant-flow-cache.js",
  "scan-warrant-flow.js",
  ".vercel/output/static/scan-intraday-signals.js",
  ".vercel/output/static/intraday-radar-rules.js",
  ".vercel/output/static/scan-institution-cache.js",
  ".vercel/output/static/scan-open-buy-cache.js",
  ".vercel/output/static/scan-open-buy.js",
  ".vercel/output/static/scan-strategy4-cache.js",
  ".vercel/output/static/scan-strategy4.js",
  ".vercel/output/static/scan-strategy5-cache.js",
  ".vercel/output/static/scan-warrant-flow-cache.js",
  ".vercel/output/static/scan-warrant-flow.js",
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
  "run-freshness-gate-task.ps1",
  "run-local-freshness-repair.ps1",
  "run-verify-data-freshness.ps1",
  "run-open-buy-sync-retry.ps1",
  "data/chip-trade-health-latest.json",
  "data/data-freshness-report.json",
  "data/fugle-open-rebound-latest.json",
  "data/heatmap-latest.json",
  "data/institution-mobile-top.json",
  "data/market-summary.json",
  "data/market-ai-breadth-latest.json",
  "data/market-ai-panel-latest.json",
  "data/market-ai-live.json",
  "data/mobile-ai-latest.html",
  "data/mobile-ai-lite.html",
  "data/mobile-ai-ultra.html",
  "data/mobile-home-summary.json",
  "data/mobile-stock-analysis-latest.json",
  "data/mobile-strategy1-ultra.html",
  "data/mobile-strategy2-ultra.html",
  "data/mobile-strategy3-ultra.html",
  "data/mobile-strategy4-ultra.html",
  "data/mobile-strategy5-ultra.html",
  "data/mobile-chip-ultra.html",
  "data/mobile-warrant-ultra.html",
  "data/mobile-digest.json",
  "data/terminal-home-bundle.json",
  "data/terminal-theme-css.css",
  "data/flow-health-latest.json",
  "data/health-summary.json",
  "data/scan-receipts/scan-summary.json",
  "data/scan-receipts/strategy2.json",
  "data/institution-tdcc-breakout.json",
  "data/institution-tdcc-breakout-top.json",
  "data/institution-tdcc-breakout.csv",
  "data/tdcc-shareholding-1000-history.json",
  "data/star-preopen-latest.json",
  "data/star-preopen-backup.json",
  "data/star-preopen-scorecard-source.json",
  "data/mobile-boot.json",
  "data/mobile-terminal-latest.json",
  "data/terminal-home-mobile-slim.json",
  "data/data-manifest.json",
  "data/data-status-index.json",
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
  "warrant-volume-page-",
  "cb-detect-page-",
];

const RETIRED_DIRECTORIES = [
  ".vercel/output",
];

const RUNTIME_RETENTION_DAYS = Number(process.env.FUMAN_API_ONLY_CLEANUP_RUNTIME_RETENTION_DAYS || 14);
const RUNTIME_HISTORY_RETENTION_DAYS = Number(process.env.FUMAN_API_ONLY_CLEANUP_HISTORY_RETENTION_DAYS || 3);
const LOG_RETENTION_DAYS = Number(process.env.FUMAN_API_ONLY_CLEANUP_LOG_RETENTION_DAYS || 30);
const RUNTIME_STALE_FRONT_PAGE_FILES = [
  "data/heatmap-latest.json",
  "data/market-summary.json",
  "data/mobile-boot.json",
  "data/mobile-terminal-latest.json",
  "data/terminal-home-mobile-slim.json",
  "data/data-manifest.json",
  "data/data-status-index.json",
  "data/terminal-theme-css.css",
];
const RETIRED_THEME_MARKERS = [
  "terminal-theme-css-runtime",
  "terminal-theme-css-snapshot-first",
  "allowRuntimeThemeCss: true",
  "allowRuntimeThemeCss = true",
];
const THEME_MARKER_FILES = [
  "terminal-core.js",
  "fuman-sw.js",
  "index.html",
  "index.github.html",
  "styles.css",
];
const RETIRED_ENTRYPOINT_MARKERS = [
  "FMN://strategy.scan",
  "綜合策略選股",
  "等待官方股票資料",
  "載入全台股股票池",
];
const ENTRYPOINT_MARKER_FILES = [
  "index.html",
  "index.github.html",
  "terminal-live-check.js",
];
const RETIRED_STRATEGY1_MARKERS = [
  "latest-payload",
  "loadPreopenStrengthCodes",
  "loadStockFutureStrengthCodes",
  "strategy1-preopen-* runs being selected as latest complete base run",
  "fuman-terminal-sync.vercel.app",
  "readOptional(\"data/open-buy-latest.json\"",
  "readOptional(\"data/open-buy-page-1.json\"",
];
const STRATEGY1_MARKER_FILES = [
  "api/open-buy-latest.js",
  "api/terminal-home.js",
  "api/mobile-fragment.js",
  "scripts/generate-slim-cache.js",
  "run-open-buy-preopen.ps1",
  "run-open-buy.ps1",
  "run-open-buy-sync-retry.ps1",
  "terminal-app.js",
  "terminal-live-check.js",
  "terminal-runtime-config.js",
];

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

function rmDirectory(root, rel, result, dryRun) {
  const target = path.resolve(root, rel);
  if (!isInside(root, target)) {
    result.skipped.push({ path: target, reason: "outside-root" });
    return;
  }
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) {
    result.skipped.push({ path: target, reason: "not-directory" });
    return;
  }
  if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
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

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function parseBranchLine(line) {
  const text = String(line || "").trim();
  const match = text.match(/^##\s+([^\s.]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.+)\])?/);
  if (!match) return { branch: "", upstream: "", ahead: 0, behind: 0 };
  const state = String(match[3] || "");
  const ahead = Number((state.match(/ahead\s+(\d+)/) || [])[1] || 0);
  const behind = Number((state.match(/behind\s+(\d+)/) || [])[1] || 0);
  return { branch: match[1] || "", upstream: match[2] || "", ahead, behind };
}

function scanGitWorktreeHealth(root, result) {
  if (!fs.existsSync(path.join(root, ".git"))) return;
  const branch = runGit(root, ["status", "-sb"]);
  const porcelain = runGit(root, ["status", "--porcelain=v1"]);
  const git = {
    ok: branch.ok && porcelain.ok,
    branch: "",
    upstream: "",
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    untrackedCount: 0,
    sample: [],
    error: "",
  };
  if (!branch.ok || !porcelain.ok) {
    git.error = branch.stderr || porcelain.stderr || "git status failed";
    result.issues.push({ path: root, reason: "git-status-failed", message: git.error });
    result.git = git;
    return;
  }
  Object.assign(git, parseBranchLine(branch.stdout.split(/\r?\n/)[0] || ""));
  const dirty = porcelain.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  git.dirtyCount = dirty.length;
  git.deletedCount = dirty.filter((line) => line.startsWith("D ") || line.startsWith(" D")).length;
  git.untrackedCount = dirty.filter((line) => line.startsWith("??")).length;
  git.modifiedCount = dirty.filter((line) => /^.{0,2}M/.test(line) || /^M/.test(line)).length;
  git.sample = dirty.slice(0, 80);
  if (git.behind > 0) {
    result.issues.push({
      path: root,
      reason: "git-behind-origin-main",
      branch: git.branch,
      upstream: git.upstream,
      behind: git.behind,
      message: `worktree is behind ${git.upstream || "upstream"} by ${git.behind} commit(s)`,
    });
  }
  if (git.ahead > 0) {
    result.issues.push({
      path: root,
      reason: "git-ahead-origin-main",
      branch: git.branch,
      upstream: git.upstream,
      ahead: git.ahead,
      message: `worktree is ahead of ${git.upstream || "upstream"} by ${git.ahead} commit(s)`,
    });
  }
  if (git.dirtyCount > 0) {
    result.issues.push({
      path: root,
      reason: "git-worktree-dirty",
      dirtyCount: git.dirtyCount,
      modifiedCount: git.modifiedCount,
      deletedCount: git.deletedCount,
      untrackedCount: git.untrackedCount,
      message: `worktree has ${git.dirtyCount} dirty file(s)`,
    });
  }
  result.git = git;
}

function pruneMatchingDirectories(parentDir, predicate, result, dryRun) {
  if (!fs.existsSync(parentDir)) return;
  for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !predicate(entry.name)) continue;
    const target = path.join(parentDir, entry.name);
    if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
    result.deleted.push(target);
  }
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

function taipeiDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function extractDateKeys(value, keys = new Set()) {
  if (!value || typeof value !== "object") return keys;
  for (const [key, item] of Object.entries(value)) {
    if (/date/i.test(key) && typeof item === "string") {
      const compact = item.replace(/[^0-9]/g, "");
      if (/^20[0-9]{6}$/.test(compact)) keys.add(compact.slice(0, 4) + "-" + compact.slice(4, 6) + "-" + compact.slice(6, 8));
      else if (/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(item)) keys.add(item.slice(0, 10));
    } else if (item && typeof item === "object") {
      extractDateKeys(item, keys);
    }
  }
  return keys;
}

function isRuntimeFrontPageStale(file, todayKey) {
  const stat = fs.statSync(file);
  if (taipeiDateKey(stat.mtime) < todayKey) return true;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const keys = extractDateKeys(parsed);
    if (keys.size && !keys.has(todayKey) && [...keys].every((key) => key < todayKey)) return true;
  } catch {}
  return false;
}

function pruneStaleRuntimeFrontPageFiles(runtimeRoot, result, dryRun) {
  const todayKey = taipeiDateKey(new Date());
  for (const rel of RUNTIME_STALE_FRONT_PAGE_FILES) {
    const target = path.join(runtimeRoot, rel);
    if (!fs.existsSync(target)) continue;
    if (!isInside(runtimeRoot, target)) {
      result.skipped.push({ path: target, reason: "outside-runtime-root" });
      continue;
    }
    if (!fs.statSync(target).isFile()) continue;
    if (!isRuntimeFrontPageStale(target, todayKey)) continue;
    if (!dryRun) fs.unlinkSync(target);
    result.deleted.push(target);
  }
}

function cleanupRoot(root, args) {
  const result = { root, exists: fs.existsSync(root), deleted: [], skipped: [], issues: [], git: null };
  if (!result.exists) return result;
  for (const rel of [...EXACT_RETIRED, ...listRetiredDataFiles(root)]) {
    rmFile(root, rel, result, args.dryRun);
  }
  for (const rel of RETIRED_DIRECTORIES) {
    rmDirectory(root, rel, result, args.dryRun);
  }
  scanRetiredEntrypointMarkers(root, result);
  scanRetiredStrategy1Markers(root, result);
  scanRetiredThemeMarkers(root, result);
  scanGitWorktreeHealth(root, result);
  return result;
}

function scanRetiredEntrypointMarkers(root, result) {
  for (const rel of ENTRYPOINT_MARKER_FILES) {
    const target = path.join(root, rel);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    const content = fs.readFileSync(target, "utf8");
    for (const marker of RETIRED_ENTRYPOINT_MARKERS) {
      if (content.includes(marker)) {
        result.issues.push({ path: target, marker, reason: "retired-entrypoint-marker" });
      }
    }
  }
}

function scanRetiredStrategy1Markers(root, result) {
  for (const rel of STRATEGY1_MARKER_FILES) {
    const target = path.join(root, rel);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    const content = fs.readFileSync(target, "utf8");
    for (const marker of RETIRED_STRATEGY1_MARKERS) {
      if (content.includes(marker)) {
        result.issues.push({ path: target, marker, reason: "retired-strategy1-static-or-gate-marker" });
      }
    }
  }
}

function scanRetiredThemeMarkers(root, result) {
  for (const rel of THEME_MARKER_FILES) {
    const target = path.join(root, rel);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
    const content = fs.readFileSync(target, "utf8");
    for (const marker of RETIRED_THEME_MARKERS) {
      if (content.includes(marker)) {
        result.issues.push({ path: target, marker, reason: "retired-runtime-theme-css-marker" });
      }
    }
  }
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
  pruneOldFiles(path.join(args.runtimeRoot, "archive", "strategy2-intraday", "history"), RUNTIME_HISTORY_RETENTION_DAYS, runtimeResult, args.dryRun);
  pruneMatchingDirectories(path.join(args.runtimeRoot, "cache", "fugle"), (name) => /^historical-legacy-mixed-units-/i.test(name), runtimeResult, args.dryRun);
  pruneOldFiles(path.join(args.runtimeRoot, "logs"), LOG_RETENTION_DAYS, runtimeResult, args.dryRun);
  pruneStaleRuntimeFrontPageFiles(args.runtimeRoot, runtimeResult, args.dryRun);

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

