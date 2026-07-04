"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  apiLatestPayload,
  scannerRunPayload,
  scanReceiptPayload,
  blockedReceiptPayload,
  battleOutputPayload,
  verifyCanonical,
  negativeCases,
} = require("./verify-institution-prewater-strict");

const ROOT = path.resolve(__dirname, "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertMatrix(file, arrayKey, requiredColumns) {
  const fullPath = path.join(ROOT, "fixtures", file);
  const matrix = readJson(fullPath);
  assert(Array.isArray(matrix[arrayKey]), `${file} missing ${arrayKey}`);
  assert(matrix[arrayKey].length > 0, `${file} ${arrayKey} empty`);
  for (const [index, row] of matrix[arrayKey].entries()) {
    for (const column of requiredColumns) {
      assert(column in row, `${file} row ${index} missing ${column}`);
    }
  }
  return { file, rows: matrix[arrayKey].length, contract: matrix.contract };
}

function expectPass(name, payload, type) {
  const result = verifyCanonical(name, payload, type);
  assert.strictEqual(result.ok, true, `${name} expected PASS: ${JSON.stringify(result.issues)}`);
  return result;
}

function expectFail(item) {
  const result = verifyCanonical(item.name, item.payload, "negative");
  assert.strictEqual(result.ok, false, `${item.name} expected FAIL`);
  assert(result.issues.some((issue) => issue.id === item.expected), `${item.name} expected ${item.expected}, got ${JSON.stringify(result.issues)}`);
  return { ...result, expectedIssue: item.expected };
}

function main() {
  const businessMatrix = assertMatrix("institution-business-field-matrix.json", "fields", [
    "fieldName", "payloadPath", "scannerPayloadPath", "writerPayloadPath", "businessPurpose", "required", "allowBlank", "blockLatestWhenBlank", "verifierRule", "blankCountsKey", "sampleMissingRowsKey",
  ]);
  const decisionMatrix = assertMatrix("institution-decision-gate-matrix.json", "gates", [
    "gateName", "gatePayloadPath", "scannerPayloadPath", "apiPayloadPath", "writerPayloadPath", "sourceTableOrView", "businessPurpose", "requiredForScan", "requiredForPublish", "requiredForFormalEntry", "allowedStates", "blockedStates", "whenBlockedReason", "fallbackAllowed", "fallbackScopeAllowed", "blockLatestWhenFailed", "preservePreviousGoodWhenFailed", "verifierRule", "negativeTestName", "sampleFailureExpected",
  ]);
  const sourceMatrix = assertMatrix("institution-source-contract-matrix.json", "sources", [
    "sourceName", "payloadPath", "sourceTableOrView", "requiredForScan", "requiredForPublish", "requiredForFormalEntry", "threshold", "staleLimitSeconds", "notRequiredReason", "verifierRule", "negativeTestName", "blockLatestWhenFailed",
  ]);
  const uiMatrix = assertMatrix("institution-ui-display-matrix.json", "surfaces", [
    "uiSurface", "routeOrEndpoint", "rendererFile", "apiEndpointUsed", "forbiddenStaticPaths", "displayedFields", "requiredDisplayedFields", "uiBlankHandling", "degradedDisplayRule", "fallbackDisplayRule", "previousGoodDisplayRule", "verifierCommand", "negativeTest",
  ]);
  const strategyRequirements = readJson(path.join(ROOT, "fixtures", "institution-strategy-requirements.json"));
  assert.strictEqual(strategyRequirements.strategy, "institution", "institution-strategy-requirements.json strategy mismatch");
  assert(Array.isArray(strategyRequirements.conditions) && strategyRequirements.conditions.length > 0, "strategy requirements conditions empty");
  assert(Array.isArray(strategyRequirements.outputFields) && strategyRequirements.outputFields.length > 0, "strategy requirements outputFields empty");
  const api = apiLatestPayload();
  const results = [
    expectPass("api-latest-payload", api, "api"),
    expectPass("scanner-run-payload", scannerRunPayload(), "scanner"),
    expectPass("scan-receipt", scanReceiptPayload(), "receipt"),
    expectPass("blocked-receipt", blockedReceiptPayload(), "receipt"),
    expectPass("battle-output", battleOutputPayload(), "battle-output"),
    ...negativeCases(api).map(expectFail),
  ];
  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    strategy: "institution",
    contract: "institution-formal-payloads-v1",
    supabaseRead: false,
    supabaseWrite: false,
    deploy: false,
    importsActualScanner: true,
    importsActualApiBuilder: true,
    importsActualWriterOrReceiptBuilder: true,
    usesBusinessFieldMatrixFile: true,
    usesDecisionGateMatrixFile: true,
    usesSourceContractMatrix: true,
    usesUiDisplayMatrixFile: true,
    usesStrategyRequirementsFile: true,
    matrices: { businessMatrix, decisionMatrix, sourceMatrix, uiMatrix, strategyRequirements: { file: "institution-strategy-requirements.json", conditions: strategyRequirements.conditions.length, outputFields: strategyRequirements.outputFields.length, contract: strategyRequirements.contract } },
    testedPayloadTypes: ["scanner actual payload", "API actual payload", "writer run payload", "blocked receipt", "latest pointer guard"],
    negativeMutationsCovered: negativeCases(api).map((item) => item.name),
    results,
  }, null, 2));
}

main();
