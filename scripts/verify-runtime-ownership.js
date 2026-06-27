const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  const target = path.join(ROOT, file);
  if (!fs.existsSync(target)) {
    issues.push(`${file} is missing`);
    return "";
  }
  return fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
}

function requireIncludes(file, text, label = text) {
  if (!read(file).includes(text)) issues.push(`${file} missing ${label}`);
}

function indexOfOrIssue(file, text, label = text) {
  const index = read(file).indexOf(text);
  if (index < 0) issues.push(`${file} missing ${label}`);
  return index;
}

function assertOrder(file, entries) {
  let previous = -1;
  let previousLabel = "";
  for (const [text, label] of entries) {
    const index = indexOfOrIssue(file, text, label);
    if (index >= 0 && previous >= 0 && index <= previous) {
      issues.push(`${file} must load ${label} after ${previousLabel}`);
    }
    if (index >= 0) {
      previous = index;
      previousLabel = label;
    }
  }
}

function assertNoRegex(file, regex, label) {
  const match = read(file).match(regex);
  if (match) issues.push(`${file} must not contain ${label}: ${match[0]}`);
}

const indexHtml = read("index.html");
const hotfix = read("terminal-hotfix.js");
const fastShell = read("terminal-desktop-fast-shell.js");
const core = read("terminal-core.js");
const restore = read("terminal-market-overview-restore.js");
const serviceWorker = read("fuman-sw.js");
const packageJson = JSON.parse(read("package.json") || "{}");
const publishGate = read(path.join("scripts", "verify-publish-gate.js"));

assertOrder("index.html", [
  ["terminal-hotfix.js?", "terminal hotfix"],
  ["terminal-desktop-fast-shell.js?", "desktop fast shell"],
  ["terminal-core.js?", "terminal core"],
  ["terminal-market-overview-restore.js?", "market restore"],
]);

if (!/terminal-hotfix\.js\?[^"']+["']\s+data-fuman-terminal-hotfix=["']1["']/.test(indexHtml)) {
  issues.push("index.html must load terminal-hotfix.js with an explicit cache key before runtime scripts");
}
if (!/terminal-desktop-fast-shell\.js\?[^"']+["']\s+data-fuman-desktop-fast-shell=["']1["']/.test(indexHtml)) {
  issues.push("index.html must load terminal-desktop-fast-shell.js with an explicit cache key");
}
if (!/terminal-core\.js\?v=public-terminal-fast-20260623-09&runtime=desktop-fast-shell-core-\d{8}-\d{2}/.test(indexHtml)) {
  issues.push("index.html terminal-core runtime key must be desktop-fast-shell-core-* when fast shell owns runtime");
}

const realtimeNavCount = (indexHtml.match(/data-view=["']realtime-radar["']/g) || []).length;
if (realtimeNavCount !== 1) {
  issues.push(`index.html must contain exactly one realtime-radar nav entry; found ${realtimeNavCount}`);
}

assertNoRegex("terminal-hotfix.js", /__fumanDesktopFastShell\s*[!=]==?\s*["']20\d{6}[^"']*["']/g, "version-pinned fast shell ownership checks");
assertNoRegex("terminal-desktop-fast-shell.js", /__fumanDesktopFastShell\s*[!=]==?\s*["']20260623-09["']/g, "retired 20260623-09 ownership check");

for (const marker of [
  "installMarketDesktopModeHandlers",
  "fumanFastMarketModeReady",
  "selectMarketDesktopMode",
  "scheduleMarketDesktopModeHydrate",
]) {
  if (!fastShell.includes(marker)) issues.push(`terminal-desktop-fast-shell.js missing market mode ownership marker: ${marker}`);
}

for (const marker of [
  "if (window.__fumanDesktopFastShell) return;",
  "if (!window.__fumanDesktopFastShell) return false;",
  "Boolean(window.__fumanDesktopFastShell)",
]) {
  if (!hotfix.includes(marker)) issues.push(`terminal-hotfix.js missing fast-shell passive marker: ${marker}`);
}
if (/FUMAN_TERMINAL_LOAD_APP\("hotfix-warm-idle"\)/.test(hotfix) && !/if \(!window\.__fumanDesktopFastShell\) return false;/.test(hotfix)) {
  issues.push("terminal-hotfix.js must keep legacy LOAD_APP behind the fast-shell cold path");
}

const restoreFastShellGuard = restore.indexOf("if (window.__fumanDesktopFastShell)");
const restorePinnedCheck = restore.indexOf('__fumanDesktopFastShell === "20260623-09"');
if (restoreFastShellGuard < 0) {
  issues.push("terminal-market-overview-restore.js must exit immediately when desktop fast shell exists");
} else if (restorePinnedCheck >= 0 && restoreFastShellGuard > restorePinnedCheck) {
  issues.push("terminal-market-overview-restore.js fast-shell boolean guard must appear before any version-pinned branch");
}
const restoreGuardBlock = restore.slice(0, Math.max(0, restore.indexOf("if (window.__fumanDesktopFastShell)") + 220));
if (!/window\.__fumanMarketOverviewRestoreReady\s*=\s*true/.test(restoreGuardBlock) || !/return;/.test(restoreGuardBlock)) {
  issues.push("terminal-market-overview-restore.js fast-shell guard must mark ready and return");
}

for (const marker of [
  "desktopFastShellOwnsRuntime",
  "skipped-desktop-fast-shell",
  "legacy-main-skipped",
  "legacy",
]) {
  if (!core.includes(marker)) issues.push(`terminal-core.js missing fast-shell runtime ownership marker: ${marker}`);
}
const skipIndex = core.indexOf("if (desktopFastShellOwnsRuntime())");
const loadModulesIndex = core.indexOf("loadModuleRegistry();");
const loadMainIndex = core.indexOf("requestIdleCallback(loadMain");
if (skipIndex < 0) {
  issues.push("terminal-core.js must gate legacy runtime loading behind desktopFastShellOwnsRuntime()");
} else {
  if (loadModulesIndex >= 0 && skipIndex > loadModulesIndex) {
    issues.push("terminal-core.js must skip desktop fast shell before loadModuleRegistry()");
  }
  if (loadMainIndex >= 0 && skipIndex > loadMainIndex) {
    issues.push("terminal-core.js must skip desktop fast shell before scheduling loadMain()");
  }
}

if (!serviceWorker.includes("desktop-fast-shell-core-")) {
  issues.push("fuman-sw.js must cache the current desktop-fast-shell-core terminal-core asset");
}

if (!String(packageJson.scripts?.["verify:runtime-ownership"] || "").includes("verify-runtime-ownership.js")) {
  issues.push("package.json missing scripts.verify:runtime-ownership");
}
if (!publishGate.includes("verify-runtime-ownership.js")) {
  issues.push("scripts/verify-publish-gate.js must run verify-runtime-ownership.js");
}

if (issues.length) {
  console.error("[runtime-ownership] failed");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("[runtime-ownership] ok");
