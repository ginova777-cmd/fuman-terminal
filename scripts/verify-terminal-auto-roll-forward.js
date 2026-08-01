"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_FILE = path.join(ROOT, "package.json");
const RUNNER_FILE = path.join(ROOT, "scripts", "run-terminal-auto-roll-forward.js");
const OUTPUT_FILE = path.join(ROOT, "outputs", "terminal-roll-forward", "terminal-auto-roll-forward.json");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function assert(condition, issues, issue, details = {}) {
  if (!condition) issues.push({ issue, details });
}

function verifyCurrentPlan(issues) {
  if (!fs.existsSync(OUTPUT_FILE)) {
    return { exists: false, contract: "", mode: "", decision: "", actionCount: 0 };
  }
  const plan = readJson(OUTPUT_FILE, {});
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  assert(plan.contract === "terminal-auto-roll-forward-v1", issues, "roll_forward_plan_contract_missing", {
    contract: plan.contract || "",
  });
  for (const action of actions) {
    assert(Boolean(action.idempotencyKey), issues, "roll_forward_action_idempotency_key_missing", {
      key: action.key || "",
    });
    assert(Boolean(action.receiptFile), issues, "roll_forward_action_receipt_missing", {
      key: action.key || "",
    });
  }
  const scannerScripts = [
    "run-strategy2-intraday.ps1",
    "run-strategy3-complete-scan.ps1",
    "run-strategy4.ps1",
    "run-strategy5.ps1",
    "run-institution.ps1",
    "run-cb-detect.ps1",
    "run-warrant-flow.ps1",
  ];
  for (const action of actions) {
    if (!String(action.state || "").includes("SCAN")) continue;
    if (action.executable !== true) continue;
    const commandText = JSON.stringify(action.commands || []);
    assert(!commandText.includes("npm run verify:"), issues, "current_plan_scanner_is_readback_only", {
      key: action.key || "",
      commands: action.commands || [],
    });
    assert(scannerScripts.some((scriptName) => commandText.includes(scriptName)), issues, "current_plan_scanner_runner_missing", {
      key: action.key || "",
      commands: action.commands || [],
    });
  }
  return {
    exists: true,
    contract: plan.contract || "",
    mode: plan.mode || "",
    decision: plan.decision?.state || "",
    actionCount: actions.length,
  };
}

function main() {
  const issues = [];
  const pkg = readJson(PACKAGE_FILE, {});
  const runnerExists = fs.existsSync(RUNNER_FILE);
  assert(runnerExists, issues, "roll_forward_runner_missing", { file: RUNNER_FILE });

  const verifyScript = String(pkg.scripts?.["verify:terminal-auto-roll-forward"] || "");
  assert(
    verifyScript === "node scripts/verify-terminal-auto-roll-forward.js",
    issues,
    "package_verify_script_missing_or_misaligned",
    { actual: verifyScript },
  );

  const runnerText = runnerExists ? fs.readFileSync(RUNNER_FILE, "utf8") : "";
  const requiredMarkers = [
    "terminal-idempotent-runner-v1",
    "auth_jobs_never_auto_execute",
    "scanner_jobs_require_water_root_and_apply_scanners",
    "scanner_jobs_require_current_water_root_ok",
    "completed_action_receipts_skip_reexecution",
    "publish_jobs_require_manifest_canary_gate",
    "--apply-scanners",
    "verify:terminal-water-root",
    "verify:daily-terminal-run-manifest",
    "verify:terminal-runid-closure",
    "safeRecoveryPreview",
    "idempotencyKey",
    "options.tradeDate || currentTradeDate()",
    "orchestrator.tradeDate || currentTradeDate()",
    "buildSafeRecoveryPreview(jobs, policy, tradeDate, displayTradeDate)",
    "manifestDerivedJobs(displayTradeDate)",
    "daily-terminal-run-latest.json",
    "rerun_idempotent_scanner_then_reverify_manifest_closure",
  ];
  for (const marker of requiredMarkers) {
    assert(runnerText.includes(marker), issues, "roll_forward_required_guard_missing", { marker });
  }

  const scannerScripts = [
    "run-strategy2-intraday.ps1",
    "run-strategy3-complete-scan.ps1",
    "run-strategy4.ps1",
    "run-strategy5.ps1",
    "run-institution.ps1",
    "run-cb-detect.ps1",
    "run-warrant-flow.ps1",
  ];
  assert(runnerText.includes("function scannerClosureStepsForKey"), issues, "scanner_closure_mapping_missing");
  assert(runnerText.includes("function scannerPostRunSteps"), issues, "scanner_post_run_closure_missing");
  assert(runnerText.includes("idempotent-skip-after-partial"), issues, "partial_action_idempotency_missing");
  for (const scriptName of scannerScripts) {
    assert(runnerText.includes(scriptName), issues, "scanner_runner_mapping_missing", { scriptName });
    assert(fs.existsSync(path.join(ROOT, scriptName)), issues, "scanner_script_missing", { scriptName });
  }
  for (const forbidden of [
    "verify:strategy2-e2e-closure",
    "verify:daytrade-strategy3-closure-live",
    "verify:strategy5-e2e-closure",
    "verify:institution-e2e-closure",
    "verify:cb-e2e-closure",
    "verify:warrant-e2e-closure",
  ]) {
    assert(runnerText.includes(forbidden), issues, "scanner_closure_mapping_missing", { forbidden });
  }
  let selfTest = { ok: false, exitCode: null, stdout: "", stderr: "" };
  if (runnerExists) {
    const result = spawnSync(process.execPath, [RUNNER_FILE, "--self-test"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
    });
    selfTest = {
      ok: result.status === 0,
      exitCode: result.status,
      stdout: String(result.stdout || "").slice(-3000),
      stderr: String(result.stderr || "").slice(-3000),
    };
    let payload = null;
    try {
      payload = JSON.parse(selfTest.stdout);
    } catch {
      payload = null;
    }
    assert(result.status === 0, issues, "roll_forward_runner_self_test_failed", {
      exitCode: result.status,
      stderr: selfTest.stderr,
    });
    assert(payload?.ok === true, issues, "roll_forward_runner_self_test_not_ok", {
      payload,
    });
  }

  const currentPlan = verifyCurrentPlan(issues);
  const output = {
    ok: issues.length === 0,
    contract: "terminal-auto-roll-forward-verifier-v1",
    checkedAt: new Date().toISOString(),
    runner: {
      file: RUNNER_FILE,
      exists: runnerExists,
      packageScript: verifyScript,
    },
    selfTest: {
      ok: selfTest.ok,
      exitCode: selfTest.exitCode,
    },
    currentPlan,
    issues,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main();


