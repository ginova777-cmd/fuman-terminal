"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch (error) {
    issues.push(`${file} missing or unreadable: ${error.message}`);
    return "";
  }
}

function requireIncludes(file, marker, message) {
  const text = read(file);
  if (!text.includes(marker)) issues.push(`${file} ${message || `must include ${marker}`}`);
}

function requirePattern(file, pattern, message) {
  const text = read(file);
  if (!pattern.test(text)) issues.push(`${file} ${message}`);
}

const helper = "scripts/e2e-membership-closure-utils.js";
const runner = "scripts/protected-e2e-closure-runner.js";
const closureScripts = [
  "scripts/verify-strategy2-e2e-closure.js",
  "scripts/verify-strategy5-e2e-closure.js",
  "scripts/verify-institution-e2e-closure.js",
  "scripts/verify-cb-e2e-closure.js",
  "scripts/verify-warrant-e2e-closure.js",
];

requireIncludes(helper, "function isMembershipProtected", "must define membership protected detection");
requireIncludes(helper, "payload?.error === \"membership_required\"", "must only treat explicit membership_required as protected");
requireIncludes(helper, "fumanInternalVerify: true", "must provide internal verify request path for compute layer");
requireIncludes(helper, "callInternalApi", "must expose internal API caller for computation readback");

requireIncludes(runner, "computeLayer", "must write computeLayer evidence separately from display layer");
requireIncludes(runner, "displayLayer", "must write displayLayer evidence separately from compute layer");
requireIncludes(runner, "callInternalApi", "must read formal payload through internal API, not guest production access");
requireIncludes(runner, "endpointAccessibleOrProtected", "must accept production data visibility or explicit membership protection");
requireIncludes(runner, "data-membership-required=\"1\"", "must recognize locked mobile HTML as display-layer membership protection");
requireIncludes(runner, "membership gates only protect production display/data access", "must document that membership never defines scanner/source computation state");
requirePattern(runner, /internalLatest\s*=\s*await\s+callInternalApi/, "must assign compute latest from internal API payload");
requirePattern(runner, /display_latest_endpoint_public_or_membership_protected/, "must classify production latest as display/permission layer");

for (const file of closureScripts) {
  requireIncludes(file, "runProtectedE2EClosure", "must delegate to protected membership-aware e2e runner");
  requireIncludes(file, "apiModule", "must identify the real API module for internal compute readback");
  requireIncludes(file, "productionLatestPath", "must identify production display endpoint separately");
  const text = read(file);
  if (/fetchJson\(|fetchText\(|membership_required/.test(text)) {
    issues.push(`${file} must not directly fetch unauthenticated production data or classify membership_required itself; use protected-e2e-closure-runner`);
  }
}

const packageJson = JSON.parse(read("package.json") || "{}");
if (!String(packageJson.scripts?.["verify:membership-e2e-layering"] || "").includes("scripts/verify-membership-e2e-layering.js")) {
  issues.push("package.json must expose verify:membership-e2e-layering");
}

if (issues.length) {
  console.error("[membership-e2e-layering] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[membership-e2e-layering] ok");
