const fs = require("fs");
const path = require("path");
const { CONTRACT, REGISTRY_FILE, loadActiveModuleRegistry, validateActiveModuleRegistry } = require("../lib/terminal-active-module-registry");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-active-module-registry");

function main() {
  const issues = [];
  let registry = {};
  try {
    registry = loadActiveModuleRegistry();
  } catch (error) {
    issues.push(error.message);
    try { registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")); } catch {}
  }
  issues.push(...validateActiveModuleRegistry(registry));
  const active = Array.isArray(registry.active) ? registry.active : [];
  const retired = Array.isArray(registry.retired) ? registry.retired : [];
  const payload = {
    ok: issues.length === 0,
    contract: CONTRACT,
    checkedAt: new Date().toISOString(),
    registryFile: REGISTRY_FILE,
    activeModules: active.map((row) => row.key),
    retiredModules: retired.map((row) => row.key),
    issues: [...new Set(issues)],
    rules: {
      retiredCannotEnterScanQueue: true,
      retiredCannotPublish: true,
      activeModuleRunIdsRequiredForClosure: true,
    },
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "terminal-active-module-registry.json"), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();
