"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  apiLatestPayload,
  scannerRunPayload,
  blockedReceiptPayload,
  verifyCanonical,
  negativeCases,
} = require("./verify-institution-prewater-strict");

const ROOT = path.resolve(__dirname, "..");
const ALLOWED_ACTIONS = new Set(["block scan", "block publish", "preserve previous good", "write blocked receipt", "display degraded", "fail closed"]);
const REQUIRED_TESTS = [
  "missing required field",
  "blank fields",
  "source not ready",
  "source timeout / 522",
  "stale data",
  "fallback display-only",
  "formal source fallback",
  "empty result",
  "readback mismatch",
  "fake YES",
  "latest pointer update error",
  "previous good not preserved",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function assertActions(actions, label) {
  assert(Array.isArray(actions) && actions.length > 0, `${label} actions missing`);
  for (const action of actions) assert(ALLOWED_ACTIONS.has(action), `${label} invalid action ${action}`);
}

function main() {
  const requirements = readJson("fixtures/institution-strategy-requirements.json");
  const business = readJson("fixtures/institution-business-field-matrix.json");
  const decision = readJson("fixtures/institution-decision-gate-matrix.json");
  const source = readJson("fixtures/institution-source-contract-matrix.json");
  const ui = readJson("fixtures/institution-ui-display-matrix.json");

  assert.strictEqual(requirements.strategy, "institution", "requirements strategy mismatch");
  assert(requirements.strategyPurpose, "strategyPurpose missing");
  assert(requirements.formalPublishDefinition, "formalPublishDefinition missing");
  for (const key of ["pattern", "scanAllowedWhen", "scanBlockedWhen", "publishAllowedWhen", "preservePreviousGoodWhen"]) {
    assert(requirements.plainLanguage?.[key], `plainLanguage.${key} missing`);
  }
  assert(requirements.conditions.length >= 11, "conditions incomplete");
  for (const row of requirements.conditions) assertActions(row.failureActions, `condition ${row.conditionId}`);
  assert(requirements.sources.some((row) => row.sourceName === "chip / institutional health" && row.necessity === "required"), "required chip/institutional source missing");
  assert(requirements.sources.some((row) => row.sourceName === "intraday_1m" && row.tableViewApi === "not_required"), "intraday_1m not_required row missing");
  assert(requirements.sources.some((row) => row.sourceName === "MA / 技術指標" && row.tableViewApi === "not_required"), "MA not_required row missing");

  const businessFields = new Set(business.fields.map((field) => field.fieldName));
  const requirementOutputs = new Set(requirements.outputFields);
  const missingBusinessOutputs = [...businessFields].filter((field) => !requirementOutputs.has(field));
  assert.strictEqual(missingBusinessOutputs.length, 0, `requirements outputFields missing business fields: ${missingBusinessOutputs.join(", ")}`);

  for (const gate of requirements.decisionGates) assertActions(gate.failureActions, `gate ${gate.gateName}`);
  for (const fallback of requirements.fallbackRules) {
    assertActions(fallback.failureActions, `fallback ${fallback.fallbackName}`);
    if (fallback.fallbackScope === "display-only") assert.strictEqual(fallback.canPublish, false, `${fallback.fallbackName} display-only canPublish must be false`);
  }
  assert.strictEqual(requirements.emptyResultRules.sourceNotReadyAllowed, false, "source not ready empty result must not be allowed");
  assert.strictEqual(requirements.emptyResultRules.canOverwriteLatest, false, "empty result must not overwrite latest by default");
  assert.strictEqual(requirements.emptyResultRules.preservePreviousGoodWhenBlocked, true, "blocked empty result must preserve previous good");

  const testNames = new Set(requirements.verifierTests.map((test) => test.testName));
  const missingTests = REQUIRED_TESTS.filter((name) => !testNames.has(name));
  assert.strictEqual(missingTests.length, 0, `missing verifier tests: ${missingTests.join(", ")}`);
  for (const [key, value] of Object.entries(requirements.selfAssessment)) {
    assert.strictEqual(value, "YES", `selfAssessment ${key} must be YES`);
  }
  assert.strictEqual(requirements.postWaterLiveRunbook[0]?.command, "npm run supabase:probe:light", "first post-water command must be light probe");
  assert(requirements.postWaterLiveRunbook.some((step) => step.command.includes("verify-institution-battle-state.js")), "battle verifier command missing");
  assert(requirements.postWaterLiveRunbook.some((step) => step.command === "npm run guard:production"), "production guard command missing");

  const api = apiLatestPayload();
  const scanner = scannerRunPayload();
  const blocked = blockedReceiptPayload();
  assert.strictEqual(verifyCanonical("api-latest-payload", api, "api").ok, true, "actual API payload contract failed");
  assert.strictEqual(verifyCanonical("scanner-run-payload", scanner, "scanner").ok, true, "actual scanner payload contract failed");
  assert.strictEqual(verifyCanonical("blocked-receipt", blocked, "receipt").ok, true, "blocked receipt contract failed");
  const negativeNames = new Set(negativeCases(api).map((item) => item.name));
  for (const requiredNegative of [
    "missing-source-snapshot-captured-at",
    "supabase-522-evidence-complete",
    "fallback-display-only-updates-latest",
    "empty-result-updates-latest-pointer",
    "blocked-run-preservePreviousGood-false",
  ]) {
    assert(negativeNames.has(requiredNegative), `negative case missing ${requiredNegative}`);
  }

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    strategy: "institution",
    contract: requirements.contract,
    supabaseRead: false,
    supabaseWrite: false,
    deploy: false,
    usesStrategyRequirementsFile: true,
    matrixRows: {
      requirementsConditions: requirements.conditions.length,
      requirementsSources: requirements.sources.length,
      requirementsOutputFields: requirements.outputFields.length,
      requirementsDecisionGates: requirements.decisionGates.length,
      requirementsFallbackRules: requirements.fallbackRules.length,
      businessFields: business.fields.length,
      sourceContracts: source.sources.length,
      decisionGates: decision.gates.length,
      uiSurfaces: ui.surfaces.length,
    },
    postWaterFirstCommand: requirements.postWaterLiveRunbook[0].command,
    actualPayloadsChecked: ["api-latest-payload", "scanner-run-payload", "blocked-receipt"],
    negativeCasesChecked: [...negativeNames],
    selfAssessment: requirements.selfAssessment,
  }, null, 2));
}

main();
