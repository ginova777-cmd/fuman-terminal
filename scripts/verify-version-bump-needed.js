const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FRONTEND_FILES = [
  "index.html",
  "styles.css",
  "terminal-core.js",
  "terminal.js",
  "terminal-app.js",
  "terminal-modules.js",
  "terminal-sector-map.js",
  "terminal-strategy-config.js",
  "terminal-market-config.js",
  "terminal-ui-config.js",
  "terminal-runtime-config.js",
  "terminal-tuning-config.js",
  "terminal-realtime-radar.css",
  "terminal-intraday-radar.css",
  "terminal-utility.css",
  "terminal-theme.css",
  "terminal-watchlist.css",
  "terminal-watchlist-module.js",
  "fuman-sw.js",
];
const VERSION_FILES = new Set(["index.html", "terminal-core.js", "terminal.js", "terminal-modules.js", "fuman-sw.js"]);

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function detectVersionFromText(text) {
  return text.match(/heatmap-realtime-\d{8}-\d{2}/)?.[0] || "";
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

const changed = new Set();
for (const line of git(["diff", "--name-only"]).split(/\r?\n/).filter(Boolean)) changed.add(line.replace(/\\/g, "/"));
for (const line of git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean)) changed.add(line.replace(/\\/g, "/"));

const lastCommitFiles = git(["diff", "--name-only", "HEAD~1..HEAD"]).split(/\r?\n/).filter(Boolean).map((line) => line.replace(/\\/g, "/"));
for (const line of lastCommitFiles) changed.add(line);

const frontendChanged = [...changed].filter((file) => FRONTEND_FILES.includes(file));
if (!frontendChanged.length) {
  console.log("[version-bump] ok no frontend asset changes detected");
  process.exit(0);
}

const versionFilesChanged = [...changed].some((file) => VERSION_FILES.has(file));
const currentVersion = detectVersionFromText(read("terminal-core.js"));
let previousVersion = "";
const previousCore = git(["show", "HEAD~1:terminal-core.js"]);
if (previousCore) previousVersion = detectVersionFromText(previousCore);

if (!versionFilesChanged && currentVersion === previousVersion) {
  console.error("[version-bump] failed");
  console.error("Frontend assets changed without a version-bearing file change.");
  console.error("Run: npm run bump:version");
  console.error("Changed frontend files: " + frontendChanged.join(", "));
  process.exit(1);
}

if (previousVersion && currentVersion === previousVersion && lastCommitFiles.some((file) => FRONTEND_FILES.includes(file))) {
  console.error("[version-bump] failed");
  console.error(`Last commit changed frontend assets but version stayed at ${currentVersion}.`);
  console.error("Run: npm run bump:version and recommit.");
  process.exit(1);
}

console.log(`[version-bump] ok current=${currentVersion || "unknown"} changed=${frontendChanged.length}`);
