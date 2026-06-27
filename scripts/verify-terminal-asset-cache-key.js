const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INDEX_FILE = "index.html";
const SHELL_FILE = "terminal-desktop-fast-shell.js";
const RETIRED_QUERY_MARKERS = [
  "strategy2-history=20260626-01",
];
const REQUIRED_REASONED_QUERY_RE = /(?:desktop-hotfix|desktop-shell|terminal-shell|cache-fix)=\d{8}-\d{2}/;

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

const issues = [];
const indexHtml = read(INDEX_FILE);
const shell = read(SHELL_FILE);
const scriptMatches = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']*terminal-desktop-fast-shell\.js[^"']*)["'][^>]*>/gi)];

if (scriptMatches.length !== 1) {
  issues.push(`${INDEX_FILE} must load exactly one ${SHELL_FILE}; found ${scriptMatches.length}`);
}

const src = scriptMatches[0]?.[1] || "";
const query = src.includes("?") ? src.slice(src.indexOf("?") + 1) : "";

if (!query) {
  issues.push(`${INDEX_FILE} ${SHELL_FILE} src must include a reasoned cache key query`);
}

for (const marker of RETIRED_QUERY_MARKERS) {
  if (src.includes(marker)) {
    issues.push(`${INDEX_FILE} must not use retired desktop shell cache key ${marker}`);
  }
}

if (query && !REQUIRED_REASONED_QUERY_RE.test(query)) {
  issues.push(`${INDEX_FILE} ${SHELL_FILE} query must use a reasoned key such as desktop-hotfix=YYYYMMDD-##, not a generic bump; current=${query}`);
}

if (!/function\s+normalizeArray\s*\(\s*value\s*\)/.test(shell)) {
  issues.push(`${SHELL_FILE} must define normalizeArray(value) before market shell render helpers use it`);
}

if (/normalizeArray\s+is\s+not\s+defined/.test(shell)) {
  issues.push(`${SHELL_FILE} must not contain unresolved normalizeArray error text`);
}

if (!/\/api\/(?:heatmap|market-ai-live)/.test(shell) || !/fast=1/.test(shell)) {
  issues.push(`${SHELL_FILE} must keep fast=1 for heatmap and market-ai-live snapshot-first routes`);
}

if (issues.length) {
  console.error("[terminal-asset-cache-key] failed");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`[terminal-asset-cache-key] ok shellSrc=${src}`);
