const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_SOURCE_DIR || "C:\\fuman-terminal";

const KEY_FILES = [
  "index.html",
  "index.github.html",
  "terminal-core.js",
  "terminal-modules.js",
  "fuman-sw.js",
  "terminal-chip-flow.js",
  "terminal-warrant-flow.js",
  "terminal-watchlist-module.js",
  "terminal-watchlist.css",
  "data/data-manifest.json",
  "data/terminal-home-bundle.json",
  "data/institution-latest.json",
  "data/institution-slim.json",
  "data/institution-mobile-top.json",
  "data/warrant-flow-latest.json",
  "data/warrant-flow-slim.json",
  "data/warrant-flow-mobile-top.json",
  "data/flow-health-latest.json",
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
