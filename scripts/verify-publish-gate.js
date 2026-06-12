const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

const issues = [];

const packageJson = JSON.parse(read("package.json"));
const gateScript = packageJson.scripts && packageJson.scripts["freshness:gate"];
if (!gateScript) {
  issues.push("package.json missing scripts.freshness:gate");
} else {
  if (!/\bpwsh\.exe\b/i.test(gateScript)) issues.push("freshness:gate must use PowerShell 7 pwsh.exe");
  if (!/run-live-freshness-gate\.ps1/i.test(gateScript)) issues.push("freshness:gate must run run-live-freshness-gate.ps1");
}
const fastGateScript = packageJson.scripts && packageJson.scripts["freshness:gate:fast"];
if (!fastGateScript) {
  issues.push("package.json missing scripts.freshness:gate:fast");
}

if (!fs.existsSync(path.join(ROOT, "run-freshness-gate-task.ps1"))) {
  issues.push("run-freshness-gate-task.ps1 missing scheduled task wrapper");
} else {
  const taskWrapper = read("run-freshness-gate-task.ps1");
  if (!/Set-Location -LiteralPath \$PSScriptRoot/.test(taskWrapper) || !/npm run freshness:gate/.test(taskWrapper)) {
    issues.push("run-freshness-gate-task.ps1 must only enter repo root and run npm run freshness:gate");
  }
}

const cacheSync = read("run-cache-sync.ps1");
if (!/if \(\$Scope -ne "all"\)/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must block every non-all scope");
}
if (/FUMAN_ALLOW_SCOPED_PUBLISH/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must not expose FUMAN_ALLOW_SCOPED_PUBLISH bypass");
}
if (/FUMAN_STRATEGY4_SCOPED_PUBLISH/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 must not expose strategy4 scoped publish bypass");
}
if (!/FUMAN_INSIDE_FRESHNESS_GATE/.test(cacheSync) || !/npm run freshness:gate/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 direct calls must redirect to npm run freshness:gate");
}
if (!/Verify live data freshness/.test(cacheSync) || !/--live/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 post-publish verifier must use live data freshness");
}
if (!/Pre-publish data freshness gate/.test(cacheSync)) {
  issues.push("run-cache-sync.ps1 missing pre-publish freshness gate");
}

const gate = read("run-live-freshness-gate.ps1");
for (const marker of [
  "realtime radar raw refresh",
  "strategy2 intraday raw refresh",
  "institution raw refresh",
  "warrant flow raw refresh",
  "open buy raw refresh",
  "strategy3 raw refresh",
  "strategy4 raw refresh",
  "strategy5 raw refresh",
  "cb detect raw refresh",
  "verify:data-freshness:live",
  "FUMAN_INSIDE_FRESHNESS_GATE",
  "Fast gate selected",
  "live-freshness-ok.json",
]) {
  if (!gate.includes(marker)) issues.push(`run-live-freshness-gate.ps1 missing ${marker}`);
}

if (!fs.existsSync(path.join(ROOT, "AGENTS.md"))) {
  issues.push("AGENTS.md missing Codex publish rule");
} else {
  const agents = read("AGENTS.md");
  if (!agents.includes("npm run freshness:gate")) issues.push("AGENTS.md must name npm run freshness:gate as the only publish entrypoint");
}

if (issues.length) {
  console.error("[publish-gate] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[publish-gate] ok");
