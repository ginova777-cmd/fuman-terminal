"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_FILE = path.join(ROOT, "data", "contracts", "release_root_authority_v1.json");
const REQUIRE_PRODUCTION_ROOT = process.argv.includes("--require-production-root");

function normalize(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+$/, "").toLowerCase();
}

function git(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    value: String(result.stdout || "").trim(),
    error: String(result.stderr || result.error?.message || "").trim(),
  };
}

function main() {
  const issues = [];
  let contract = null;
  try {
    contract = JSON.parse(fs.readFileSync(CONTRACT_FILE, "utf8"));
  } catch (error) {
    issues.push(`authority_contract_unreadable:${error.message}`);
  }

  const sourceRoot = contract?.sourceRoot || "";
  const productionRoot = contract?.productionRoot || "";
  const runtimeRoot = contract?.runtimeRoot || "";
  const approvedProductionSha = String(contract?.approvedProductionSha || "").toLowerCase();
  const policy = contract?.policy || {};

  if (contract?.contract !== "release_root_authority_v1") issues.push("authority_contract_version_invalid");
  if (!sourceRoot || normalize(ROOT) !== normalize(sourceRoot)) issues.push("source_root_mismatch");
  if (!productionRoot || normalize(productionRoot) === normalize(sourceRoot)) issues.push("production_root_not_isolated");
  if (!runtimeRoot || [sourceRoot, productionRoot].some((root) => normalize(root) === normalize(runtimeRoot))) issues.push("runtime_root_not_isolated");
  if (!/^[0-9a-f]{40}$/.test(approvedProductionSha)) issues.push("approved_production_sha_invalid");

  const wiringChecks = [
    ["package.json", '"verify:release-root-authority"'],
    ["scripts/verify-upload-gate.js", 'run("verify:release-root-authority"'],
    ["scripts/verify-publish-gate.js", '["release_root_authority"'],
    ["AGENTS.md", "FAIL_CLOSED: RELEASE_ROOT_DRIFT"],
    ["AGENTS.md", "npm run verify:release-root-authority"],
  ];
  const wiringEvidence = [];
  for (const [relative, marker] of wiringChecks) {
    const file = path.join(ROOT, relative);
    let present = false;
    try {
      present = fs.readFileSync(file, "utf8").includes(marker);
    } catch {}
    wiringEvidence.push({ file: relative, marker, present });
    if (!present) issues.push(`release_root_authority_wiring_missing:${relative}`);
  }

  const requiredPolicy = {
    sourceRootIsOnlyEditableAuthority: true,
    productionRootIsDetachedReadOnlyRelease: true,
    runtimeRootContainsNoCodeAuthority: true,
    productionRootMustBeClean: true,
    productionHeadMustMatchApprovedSha: true,
    rootDriftVerdict: "FAIL_CLOSED",
    rootDriftReasonCode: "RELEASE_ROOT_DRIFT",
    directProductionEditsForbidden: true,
  };
  for (const [key, expected] of Object.entries(requiredPolicy)) {
    if (policy[key] !== expected) issues.push(`authority_policy_invalid:${key}`);
  }

  const productionExists = productionRoot ? fs.existsSync(productionRoot) : false;
  let productionHead = "";
  let productionStatus = "";
  let productionTopLevel = "";
  if (!productionExists) {
    if (REQUIRE_PRODUCTION_ROOT) issues.push("production_root_missing");
  } else {
    const head = git(productionRoot, ["rev-parse", "HEAD"]);
    const status = git(productionRoot, ["status", "--porcelain"]);
    const topLevel = git(productionRoot, ["rev-parse", "--show-toplevel"]);
    productionHead = head.value.toLowerCase();
    productionStatus = status.value;
    productionTopLevel = topLevel.value;
    if (!head.ok) issues.push("production_head_unreadable");
    if (!status.ok) issues.push("production_status_unreadable");
    if (!topLevel.ok) issues.push("production_git_root_unreadable");
    if (head.ok && productionHead !== approvedProductionSha) issues.push("production_head_not_approved");
    if (status.ok && productionStatus) issues.push("production_root_dirty");
    if (topLevel.ok && normalize(productionTopLevel) === normalize(sourceRoot)) issues.push("production_root_not_separate_worktree");
  }

  const report = {
    ok: issues.length === 0,
    verdict: issues.length === 0 ? "PASS" : "FAIL_CLOSED",
    firstBlocker: issues[0] || "",
    reasonCode: issues.length === 0 ? "" : "RELEASE_ROOT_DRIFT",
    contract: contract?.contract || "release_root_authority_v1",
    checkedAt: new Date().toISOString(),
    sourceRoot,
    productionRoot,
    runtimeRoot,
    approvedProductionSha,
    productionRootPresent: productionExists,
    productionHead,
    productionClean: productionExists ? productionStatus === "" : null,
    productionGitTopLevel: productionTopLevel,
    productionValidationRequired: REQUIRE_PRODUCTION_ROOT,
    wiringEvidence,
    issues,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
