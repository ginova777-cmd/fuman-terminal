const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function extractVersionFromCore(text) {
  return text.match(/const\s+version\s*=\s*["']([^"']+)["']/)?.[1] || "";
}

function extractVersionFromModules(text) {
  return text.match(/const\s+VERSION\s*=\s*["']([^"']+)["']/)?.[1] || "";
}

function extractVersionFromJson(text) {
  try {
    return JSON.parse(text).version || "";
  } catch {
    return "";
  }
}

const issues = [];
const modules = read("terminal-modules.js");
const core = read("terminal-core.js");
const versionJson = read("version.json");

const coreVersion = extractVersionFromCore(core);
const moduleVersion = extractVersionFromModules(modules);
const jsonVersion = extractVersionFromJson(versionJson);

if (!moduleVersion) issues.push("terminal-modules.js missing VERSION literal");
if (moduleVersion && coreVersion && moduleVersion !== coreVersion) {
  issues.push(`terminal-modules.js VERSION ${moduleVersion} must match terminal-core.js ${coreVersion}`);
}
if (jsonVersion && coreVersion && jsonVersion !== coreVersion) {
  issues.push(`version.json ${jsonVersion} must match terminal-core.js ${coreVersion}`);
}

for (const [name, src] of [
  ["chipSnapshot", "terminal-chip-snapshot-module.js"],
  ["chipFlow", "terminal-chip-snapshot-module.js"],
  ["warrantFlow", "terminal-chip-snapshot-module.js"],
  ["market", "terminal-market-snapshot-module.js"],
  ["strategy", "terminal-strategy-module.js"],
  ["watchlist", "terminal-watchlist-shell.js"],
  ["member", "terminal-member-module.js"],
]) {
  const escapedSrc = src.replaceAll(".", "\\.");
  const re = new RegExp(`${name}\\s*:\\s*\\{[^}]*src\\s*:\\s*["']${escapedSrc}["']`, "m");
  if (!re.test(modules)) issues.push(`terminal-modules.js missing module marker ${name} -> ${src}`);
}

for (const marker of [
  'this.preload("chipSnapshot")',
  'this.preload("chipFlow")',
  'this.preload("warrantFlow")',
]) {
  if (!modules.includes(marker)) issues.push(`terminal-modules.js missing preload marker ${marker}`);
}


function extractBlock(text, startPattern, endPattern) {
  const start = text.search(startPattern);
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.search(endPattern);
  return end < 0 ? rest : rest.slice(0, end);
}

function sortedValues(values) {
  return [...new Set(values)].sort();
}

function assertSameSet(label, actual, expected) {
  const a = sortedValues(actual);
  const e = sortedValues(expected);
  if (a.join("|") !== e.join("|")) {
    issues.push(`${label} mismatch actual=${a.join(",") || "none"} expected=${e.join(",")}`);
  }
}

function assertNoRetiredOfficialKeys(label, text) {
  for (const retired of ["strategy1", "open-buy", "open_buy", "realtime-radar", "realtimeRadar", "heatmap"]) {
    if (text.includes(retired)) issues.push(`${label} contains retired official key ${retired}`);
  }
}

const mobileFragment = read("api/mobile-fragment.js");
const resourceChain = read("scripts/verify-terminal-resource-chain.js");
const dailyManifest = read("scripts/write-daily-terminal-run-manifest.js");

const mobileTabBlock = extractBlock(mobileFragment, /const\s+TAB_CONFIG\s*=\s*\{/, /\n\};/);
const mobileTabs = [...mobileTabBlock.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)].map((match) => match[1]);
assertSameSet("mobile TAB_CONFIG official tabs", mobileTabs, ["ai", "strategy2", "strategy3", "strategy4", "strategy5", "chip", "cb", "warrant"]);
assertNoRetiredOfficialKeys("mobile TAB_CONFIG", mobileTabBlock);

const resourceStrategiesBlock = extractBlock(resourceChain, /const\s+STRATEGIES\s*=\s*\[/, /\n\];/);
const resourceKeys = [...resourceStrategiesBlock.matchAll(/key:\s*"([^"]+)"/g)].map((match) => match[1]);
assertSameSet("resource-chain STRATEGIES", resourceKeys, ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant", "market"]);
assertNoRetiredOfficialKeys("resource-chain STRATEGIES", resourceStrategiesBlock);

const manifestDueBlock = extractBlock(dailyManifest, /const\s+STRATEGY_DUE_TIMES\s*=\s*\{/, /\n\};/);
const manifestDueKeys = [...manifestDueBlock.matchAll(/^\s{2}([a-z0-9_]+):\s*"/gm)].map((match) => match[1]);
assertSameSet("Daily Manifest STRATEGY_DUE_TIMES", manifestDueKeys, ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant"]);
assertNoRetiredOfficialKeys("Daily Manifest STRATEGY_DUE_TIMES", manifestDueBlock);
if (issues.length) {
  console.error("[terminal-modules-contract] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log(`[terminal-modules-contract] ok version=${moduleVersion || coreVersion}`);