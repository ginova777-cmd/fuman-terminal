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

if (issues.length) {
  console.error("[terminal-modules-contract] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log(`[terminal-modules-contract] ok version=${moduleVersion || coreVersion}`);
