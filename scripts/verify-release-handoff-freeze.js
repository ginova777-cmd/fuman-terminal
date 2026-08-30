"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "data", "contracts", "release_handoff_freeze_v1.json");
const CHECK_REMOTE = process.argv.includes("--check-remote");

function argValue(name) {
  const prefix = `${name}=`;
  const raw = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return {
    ok: result.status === 0,
    value: String(result.stdout || "").trim(),
    error: String(result.stderr || result.error?.message || "").trim(),
  };
}

function normalizedFile(value) {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function staticChecks(contract) {
  const checks = [];
  const add = (ok, code, detail = "") => checks.push({ ok: Boolean(ok), code, detail });
  const agents = read("AGENTS.md");
  const packageJson = read("package.json");
  const uploadGate = read("scripts/verify-upload-gate.js");
  const publishGate = read("scripts/verify-publish-gate.js");

  add(contract.contract === "release_handoff_freeze_v1", "contract_version");
  add(contract.policy?.handoffStopsFurtherPushes === true, "handoff_stops_further_pushes");
  add(contract.policy?.newChangesRequireNewBranchAndPr === true, "new_changes_require_new_branch_pr");
  add(contract.policy?.movingPrHeadIsBlocked === true, "moving_pr_head_is_blocked");
  add(agents.includes("Release Handoff Freeze"), "agents_handoff_freeze_section");
  add(agents.includes("BLOCKED_PR_HEAD_DRIFT"), "agents_pr_head_drift_status");
  add(packageJson.includes('"verify:release-handoff-freeze"'), "package_command_wired");
  add(uploadGate.includes("verify-release-handoff-freeze.js"), "upload_gate_wired");
  add(publishGate.includes("verify-release-handoff-freeze.js"), "publish_gate_wired");
  return checks;
}

function validateManifest(manifest, contract) {
  const checks = [];
  const add = (ok, code, detail = "") => checks.push({ ok: Boolean(ok), code, detail });
  for (const field of contract.requiredFields || []) add(manifest[field] !== undefined && manifest[field] !== null, `required_${field}`);
  add(manifest.contract === contract.contract, "manifest_contract");
  add(typeof manifest.releaseId === "string" && manifest.releaseId.trim().length >= 6, "release_id_valid");
  add(typeof manifest.repository === "string" && manifest.repository.includes("/"), "repository_valid");
  add(Number.isInteger(Number(manifest.prNumber)) && Number(manifest.prNumber) > 0, "pr_number_valid");
  const branch = String(manifest.branch || "").trim();
  add((contract.branchPatterns || []).some((pattern) => new RegExp(pattern).test(branch)), "branch_pattern_valid", branch);
  const approved = String(manifest.approvedCommitSha || "").trim().toLowerCase();
  add(/^[0-9a-f]{40}$/.test(approved) && !/^0+$/.test(approved), "approved_commit_sha_valid", approved);
  const files = Array.isArray(manifest.changedFiles) ? manifest.changedFiles.map(normalizedFile).filter(Boolean) : [];
  add(files.length > 0, "changed_files_nonempty");
  add(new Set(files).size === files.length, "changed_files_unique");
  add(files.every((file) => !file.startsWith("../") && !path.isAbsolute(file)), "changed_files_repo_relative");
  add(manifest.verifier?.passed === true, "verifier_passed");
  add(Array.isArray(manifest.verifier?.commands) && manifest.verifier.commands.length > 0, "verifier_commands_present");
  add(Array.isArray(manifest.verifier?.failedChecks) && manifest.verifier.failedChecks.length === 0, "verifier_failed_checks_empty");
  add(manifest.verifier?.firstBlocker == null, "verifier_first_blocker_null");
  for (const key of ["supabase", "runtime", "cache", "schedules"]) add(typeof manifest.writes?.[key] === "boolean", `writes_${key}_declared`);

  const head = git(["rev-parse", "HEAD"]);
  const currentBranch = git(["branch", "--show-current"]);
  add(head.ok && head.value.toLowerCase() === approved, "local_head_matches_approved", head.value);
  add(currentBranch.ok && currentBranch.value === branch, "local_branch_matches_handoff", currentBranch.value);

  let remoteHead = null;
  if (CHECK_REMOTE) {
    const remote = git(["ls-remote", "origin", `refs/heads/${branch}`]);
    remoteHead = remote.ok ? String(remote.value).split(/\s+/)[0].toLowerCase() : "";
    add(remote.ok && /^[0-9a-f]{40}$/.test(remoteHead), "remote_branch_head_readable", remote.error);
    add(remoteHead === approved, "remote_head_matches_approved", `approved=${approved} remote=${remoteHead}`);
  }
  return { checks, approvedCommitSha: approved, localHead: head.value, localBranch: currentBranch.value, remoteHead };
}

function main() {
  const contract = readJson(CONTRACT_PATH);
  const checks = staticChecks(contract);
  const handoffArg = argValue("--handoff");
  let handoff = null;
  if (handoffArg) {
    const handoffPath = path.resolve(ROOT, handoffArg);
    handoff = validateManifest(readJson(handoffPath), contract);
    checks.push(...handoff.checks);
  }
  const failedChecks = checks.filter((item) => !item.ok);
  const prHeadDrift = failedChecks.some((item) => item.code === "remote_head_matches_approved");
  const report = {
    ok: failedChecks.length === 0,
    contract: contract.contract,
    checkedAt: new Date().toISOString(),
    mode: handoffArg ? (CHECK_REMOTE ? "handoff_remote_freeze" : "handoff_local_freeze") : "static_wiring",
    status: failedChecks.length === 0 ? (handoffArg ? "FROZEN" : "PASS") : (prHeadDrift ? contract.driftStatus : "BLOCKED"),
    handoff,
    checks,
    failedChecks: failedChecks.map((item) => item.code),
    firstBlocker: failedChecks[0]?.code || null,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
