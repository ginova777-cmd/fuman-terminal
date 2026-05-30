const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, dataPath } = require("./runtime-paths");

const nodeExe = process.execPath;
const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";

function run(label, command, args, options = {}) {
  console.log(`[repair] ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    ...options,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (output) console.log(output.split(/\r?\n/).slice(-30).join("\n"));
  if (result.status !== 0) {
    console.log(`[repair] ${label} failed exit=${result.status}`);
    return false;
  }
  return true;
}

function readHealth() {
  const file = [dataPath("health-summary.json"), path.join(ROOT, "data", "health-summary.json")].find((item) => fs.existsSync(item));
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  run("refresh health summary", nodeExe, ["scripts/generate-health-summary.js"]);
  run("refresh slim/preset files", nodeExe, ["scripts/generate-slim-cache.js"]);
  const health = readHealth();
  if (!health) {
    console.log("[repair] health summary missing after refresh");
    process.exitCode = 1;
    return;
  }
  const risks = Array.isArray(health.risks) ? health.risks : [];
  const needsSync = risks.some((risk) => ["github", "runtime", "freshness"].includes(risk.area)) || health.githubSync?.pendingCount > 0;
  if (needsSync) {
    run("cache sync all", pwsh, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(ROOT, "run-cache-sync.ps1"), "-Scope", "all"]);
    run("refresh health summary after sync", nodeExe, ["scripts/generate-health-summary.js"]);
  }
  const finalHealth = readHealth();
  console.log(`[repair] final ok=${Boolean(finalHealth?.ok)} risk=${finalHealth?.risk || "unknown"} badTasks=${finalHealth?.schedule?.badCount ?? "?"}`);
  if (!finalHealth?.ok) process.exitCode = 1;
}

main();
