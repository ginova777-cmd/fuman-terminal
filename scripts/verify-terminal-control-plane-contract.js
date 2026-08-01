const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CONTROL_SCRIPT = path.join(ROOT, "scripts", "write-terminal-control-plane.js");
const CONTROL_FILE = path.join(ROOT, "outputs", "terminal-control-plane", "terminal-control-plane.json");

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function runControlPlane() {
  return spawnSync(process.execPath, [
    "--use-system-ca",
    "scripts/write-terminal-control-plane.js",
    "--require-unattended",
    "--from-existing",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
  });
}

function main() {
  const issues = [];
  const source = readText(CONTROL_SCRIPT);

  if (!source.includes("const unattendedReady = decision.state === \"UNATTENDED_YES\" && decision.unattendedStatus === \"YES\"")) {
    issues.push("control_plane_missing_unattended_ready_guard");
  }
  if (!source.includes("const verifierOk = REQUIRE_UNATTENDED ? unattendedReady : operationallyValid")) {
    issues.push("control_plane_require_unattended_not_strict");
  }
  if (!source.includes("if (!verifierOk) process.exitCode = 1")) {
    issues.push("control_plane_missing_strict_exit_code");
  }

  const result = runControlPlane();
  const artifact = readJson(CONTROL_FILE) || {};
  const decision = artifact.decision || {};
  const master = artifact.masterController || {};
  if (master.contract !== "terminal-master-controller-v1") issues.push("master_controller_artifact_contract_missing");
  if (master.entrypoint !== "scripts/run-terminal-autonomous-ops.js") issues.push("master_controller_entrypoint_mismatch");
  if (master.decisionSource !== "scripts/write-terminal-control-plane.js") issues.push("master_controller_decision_source_mismatch");
  if (master.lockContract !== "terminal-orchestrator-lock-v1") issues.push("master_controller_lock_contract_mismatch");
  if (master.authority !== "single_decision_source_fail_closed") issues.push("master_controller_authority_not_fail_closed");
  if (master.strictUnattended !== true) issues.push("master_controller_strict_unattended_missing");
  if (master.decision?.state !== decision.state || master.decision?.unattendedStatus !== decision.unattendedStatus) issues.push("master_controller_decision_not_authoritative");
  const masterStages = Array.isArray(master.stageOrder) ? master.stageOrder : [];
  for (const required of ["market_calendar", "single_daily_orchestrator_lock", "water_root", "formal_entry_gate", "daily_manifest", "runid_closure", "autonomous_ops_policy", "unattended_final_audit"]) {
    if (!masterStages.includes(required)) issues.push("master_controller_stage_missing:" + required);
  }
  const shouldPass = decision.state === "UNATTENDED_YES" && decision.unattendedStatus === "YES";
  const didPass = result.status === 0;

  if (shouldPass !== didPass) {
    issues.push(`control_plane_exit_mismatch:shouldPass=${shouldPass}:exit=${result.status}`);
  }
  if (decision.unattendedStatus !== "YES" && didPass) {
    issues.push(`control_plane_false_pass_for_${decision.state || "unknown"}_${decision.unattendedStatus || "missing"}`);
  }

  const payload = {
    ok: issues.length === 0,
    contract: "terminal-control-plane-contract-v1",
    checkedAt: new Date().toISOString(),
    command: "node --use-system-ca scripts/write-terminal-control-plane.js --require-unattended --from-existing",
    exitCode: result.status ?? 1,
    currentState: decision.state || "",
    currentUnattendedStatus: decision.unattendedStatus || "",
    operationallyValid: /\"operationallyValid\"\s*:\s*true/.test(String(result.stdout || "")),
    strictUnattendedPass: didPass,
    stdoutTail: String(result.stdout || "").slice(-1200),
    stderrTail: String(result.stderr || "").slice(-1200),
    issues,
  };

  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main();
