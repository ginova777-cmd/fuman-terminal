const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadActiveModuleRegistry } = require("../lib/terminal-active-module-registry");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_FILE = path.join(ROOT, "package.json");
const OUTPUT_DIR = path.join(ROOT, "outputs", "terminal-dream-publish-gate");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FUMAN_PUBLISH_GATE_MODE: "terminal-dream-v1" },
    shell: process.platform === "win32" && /\.cmd$/i.test(command),
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    command: [command, ...args].join(" "),
    exitCode: typeof result.status === "number" ? result.status : 1,
    signal: result.signal || "",
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error ? String(result.error.message || result.error) : "",
  };
}

function tail(text, lineCount) {
  return String(text || "").split(/\r?\n/).slice(-lineCount).join("\n").trim();
}

function loadPackage() {
  return JSON.parse(fs.readFileSync(PACKAGE_FILE, "utf8"));
}

function main() {
  const issues = [];
  let registry = null;
  let packageJson = null;
  try {
    registry = loadActiveModuleRegistry();
  } catch (error) {
    issues.push("active_module_registry_unreadable:" + error.message);
  }
  try {
    packageJson = loadPackage();
  } catch (error) {
    issues.push("package_json_unreadable:" + error.message);
  }

  const activeModules = Array.isArray(registry && registry.active) ? registry.active.map((row) => row.key) : [];
  const retiredModules = Array.isArray(registry && registry.retired) ? registry.retired.map((row) => row.key) : [];
  if (activeModules.length === 0) issues.push("active_module_registry_empty");

  const unattendedRoot = String(packageJson && packageJson.scripts && packageJson.scripts["verify:terminal-unattended-root"] || "");
  const requiredRootStages = [
    "verify:terminal-retired-formal-entrypoints",
    "verify:terminal-active-module-registry",
    "verify:terminal-formal-entry-gate",
    "verify:terminal-water-root",
    "verify:daytrade-warmup-nine-day",
    "verify:strategy-scan-formal-gate",
    "verify:terminal-idempotent-runner",
    "verify:strategy-scan-receipt-contract",
    "verify:terminal-runid-closure",
    "verify:terminal-autonomous-completion-audit",
    "verify:terminal-ops-production-live",
    "verify:production-unattended-readiness-report",
  ];
  for (const stage of requiredRootStages) {
    if (!unattendedRoot.includes(stage)) issues.push("unattended_root_missing_stage:" + stage);
  }

  const node = process.execPath;
  const checks = [
    ["desktop_api_only", node, ["scripts/verify-desktop-api-only.js"]],
    ["membership_e2e_layering", node, ["scripts/verify-membership-e2e-layering.js"]],
    ["membership_ui_state", node, ["scripts/verify-membership-ui-state.js"]],
    ["buySellNoRollbackGuard", node, ["scripts/guard-buy-sell-no-rollback.js"]],
    ["buySellFieldContractGuard", node, ["--use-system-ca", "scripts/verify-buy-sell-field-contract.js"]],
    ["verify:unified-source-gate", node, ["scripts/verify-unified-source-gate-contract.js"]],
    ["terminal_modules_contract", node, ["scripts/verify-terminal-modules-contract.js"]],
    ["runtime_ownership", node, ["scripts/verify-runtime-ownership.js"]],
    ["fast_shell_self_contained", node, ["scripts/verify-fast-shell-self-contained.js"]],
    ["terminal_no_fake_unattended", node, ["scripts/verify-terminal-no-fake-unattended.js"]],
    ["deploy_worktree_clean", node, ["scripts/verify-deploy-worktree-clean.js"]],
    ["scorecard_no_rollback", node, ["scripts/verify-scorecard-no-rollback.js", "--no-live", "--no-output", "--skip-schedule"]],
    ["scorecard_strategy_rules", node, ["scripts/verify-scorecard-strategy-rules.js", "--no-live", "--no-output"]],
    ["fugle_source_contract_static", node, ["--use-system-ca", "scripts/verify-fugle-source-contract.js", "--static-only"]],
    ["terminal_ui_state_acceptance", node, ["scripts/verify-terminal-ui-state-acceptance.js"]],
    ["terminal_unattended_root", "npm.cmd", ["run", "verify:terminal-unattended-root"]],
    ["terminal_autonomous_completion_audit", node, ["scripts/verify-terminal-autonomous-completion-audit.js"]],
    ["terminal_runid_closure", node, ["scripts/verify-terminal-runid-closure-contract.js"]],
    ["terminal_ops_production_live", node, ["--use-system-ca", "scripts/verify-terminal-ops-production-live.js"]],
    ["production_unattended_readiness", node, ["scripts/write-production-unattended-readiness-report.js", "--verify-only"]],
  ];

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const results = [];
  for (const [name, command, args] of checks) {
    const result = run(command, args);
    const log = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    fs.writeFileSync(path.join(OUTPUT_DIR, name + ".log"), log + "\n");
    const item = {
      name,
      command: result.command,
      exitCode: result.exitCode,
      signal: result.signal,
      error: result.error,
    };
    results.push(item);
    console.log("[dream-gate] " + name + " exit=" + result.exitCode);
    if (result.exitCode !== 0) {
      issues.push("check_failed:" + name);
      const diagnostic = tail(log || result.error, 28);
      if (diagnostic) console.log(diagnostic);
    }
  }

  const failedChecks = results.filter((row) => row.exitCode !== 0).map((row) => row.name);
  const payload = {
    ok: issues.length === 0 && failedChecks.length === 0,
    contract: "terminal-dream-publish-gate-v1",
    checkedAt: new Date().toISOString(),
    activeModuleRegistry: registry && registry.contract || "",
    activeModules,
    retiredModules,
    requiredRootStages,
    checks: results,
    failedChecks,
    issues,
    policy: {
      natural0700_0845_0900Required: true,
      productionReadbackRequired: true,
      dailyManifestRequired: true,
      runIdClosureRequired: true,
      retiredModulesExcludedFromScanPublishClosure: true,
      noPreviousGoodAsTodaySuccess: true,
      uiStatesRequired: ["empty", "blocked", "degraded", "0-result"],
    },
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, "terminal-dream-publish-gate.json"), JSON.stringify(payload, null, 2) + "\n");
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();
