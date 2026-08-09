const fs = require("fs");
const path = require("path");
const { loadActiveModuleRegistry } = require("../lib/terminal-active-module-registry");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function extractVersion(text, name) {
  return text.match(new RegExp(`const\\s+${name}\\s*=\\s*["']([^"']+)["']`))?.[1] || "";
}

function jsonVersion(text) {
  try { return JSON.parse(text).version || ""; } catch { return ""; }
}

function extractBlock(text, startPattern, endPattern) {
  const start = text.search(startPattern);
  if (start < 0) return "";
  const rest = text.slice(start);
  const end = rest.search(endPattern);
  return end < 0 ? rest : rest.slice(0, end);
}

function sorted(values) { return [...new Set(values)].sort(); }

function assertSameSet(label, actual, expected) {
  const a = sorted(actual);
  const e = sorted(expected);
  if (a.join("|") !== e.join("|")) {
    issues.push(`${label} mismatch actual=${a.join(",") || "none"} expected=${e.join(",")}`);
  }
}

function assertNoRetired(label, text, retired) {
  for (const key of retired) {
    if (text.includes(key)) issues.push(`${label} contains retired official key ${key}`);
  }
}

function main() {
  const registry = loadActiveModuleRegistry();
  const active = Array.isArray(registry.active) ? registry.active : [];
  const retired = (Array.isArray(registry.retired) ? registry.retired : []).map((row) => String(row.key));
  const activeKeys = active.map((row) => String(row.key));
  if (!activeKeys.length) issues.push("active module registry is empty");

  const modules = read("terminal-modules.js");
  const core = read("terminal-core.js");
  const versionJson = read("version.json");
  const coreVersion = extractVersion(core, "version");
  const moduleVersion = extractVersion(modules, "VERSION");
  const jsonVer = jsonVersion(versionJson);
  if (!moduleVersion) issues.push("terminal-modules.js missing VERSION literal");
  if (moduleVersion && coreVersion && moduleVersion !== coreVersion) issues.push(`terminal-modules.js VERSION ${moduleVersion} must match terminal-core.js ${coreVersion}`);
  if (jsonVer && coreVersion && jsonVer !== coreVersion) issues.push(`version.json ${jsonVer} must match terminal-core.js ${coreVersion}`);

  for (const [name, src] of [
    ["chipSnapshot", "terminal-chip-snapshot-module.js"],
    ["chipFlow", "terminal-chip-snapshot-module.js"],
    ["warrantFlow", "terminal-chip-snapshot-module.js"],
    ["market", "terminal-market-snapshot-module.js"],
    ["strategy", "terminal-strategy-module.js"],
    ["watchlist", "terminal-watchlist-shell.js"],
    ["member", "terminal-member-module.js"],
  ]) {
    const escaped = src.replaceAll(".", "\\.");
    if (!new RegExp(`${name}\\s*:\\s*\\{[^}]*src\\s*:\\s*["']${escaped}["']`, "m").test(modules)) {
      issues.push(`terminal-modules.js missing module marker ${name} -> ${src}`);
    }
  }
  for (const marker of ["this.preload(\"chipSnapshot\")", "this.preload(\"chipFlow\")", "this.preload(\"warrantFlow\")"]) {
    if (!modules.includes(marker)) issues.push(`terminal-modules.js missing preload marker ${marker}`);
  }

  const mobile = read("api/mobile-fragment.js");
  const mobileBlock = extractBlock(mobile, /const\s+TAB_CONFIG\s*=\s*\{/, /\n\};/);
  const mobileTabs = [...mobileBlock.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]);
  assertSameSet("mobile TAB_CONFIG official tabs", mobileTabs, ["ai", "strategy2", "strategy3", "strategy4", "strategy5", "chip", "cb", "warrant"]);
  assertNoRetired("mobile TAB_CONFIG", mobileBlock, retired);

  const resource = read("scripts/verify-terminal-resource-chain.js");
  const resourceBlock = extractBlock(resource, /const\s+STRATEGIES\s*=\s*\[/, /\n\];/);
  const resourceKeys = [...resourceBlock.matchAll(/key:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assertSameSet("resource-chain STRATEGIES", resourceKeys, ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant", "market"]);
  assertNoRetired("resource-chain STRATEGIES", resourceBlock, retired);

  const manifest = read("scripts/write-daily-terminal-run-manifest.js");
  const expectedDueKeys = ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant"];
  const dynamicManifest = /ACTIVE_MODULE_REGISTRY\.active\.map\s*\(/.test(manifest) && manifest.includes("loadActiveModuleRegistry");
  if (!dynamicManifest) {
    const dueBlock = extractBlock(manifest, /const\s+STRATEGY_DUE_TIMES\s*=\s*\{/, /\n\};/);
    const dueKeys = [...dueBlock.matchAll(/^\s{2}([a-z0-9_]+):\s*["']/gm)].map((m) => m[1]);
    assertSameSet("Daily Manifest STRATEGY_DUE_TIMES", dueKeys, expectedDueKeys);
    assertNoRetired("Daily Manifest STRATEGY_DUE_TIMES", dueBlock, retired);
  } else {
    const registryKeys = active.filter((row) => expectedDueKeys.includes(String(row.key))).map((row) => String(row.key));
    assertSameSet("Daily Manifest active registry strategy keys", registryKeys, expectedDueKeys);
    if (!manifest.includes("Object.fromEntries") || !manifest.includes("row.dueTime")) {
      issues.push("Daily Manifest dynamic due-time map missing active registry row.dueTime wiring");
    }
  }

  if (issues.length) {
    console.error("[terminal-modules-contract] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exitCode = 1;
    return;
  }
  console.log(`[terminal-modules-contract] ok version=${moduleVersion || coreVersion} registry=${registry.contract}`);
}

main();
