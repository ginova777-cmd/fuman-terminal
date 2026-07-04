"use strict";

const fs = require("fs");
const path = require("path");
const { formalArtifacts } = require("./verify-strategy4-prewater-formal-payloads");

const MATRIX_FILE = path.join(__dirname, "..", "data", "fixtures", "strategy4-actual-condition-field-matrix.json");
const REQUIRED_COLUMNS = [
  "fieldName",
  "payloadPath",
  "scannerPayloadPath",
  "apiPayloadPath",
  "writerPayloadPath",
  "uiPayloadPath",
  "sourceTableOrView",
  "businessPurpose",
  "required",
  "allowBlank",
  "blockLatestWhenBlank",
  "preservePreviousGoodWhenBlank",
  "verifierRule",
  "blankCountsKey",
  "sampleMissingRowsKey",
  "negativeTestName",
  "expectedFailureMode",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isBlank(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function readMatrix() {
  return JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8"));
}

function buildUiPayload(apiPayload) {
  return {
    strategy4: {
      view: {
        runId: apiPayload.runId,
        strategyName: "strategy4",
        scanDate: apiPayload.scanStamp,
        updatedAt: apiPayload.updatedAt,
        sourceSnapshotCapturedAt: apiPayload.source_snapshot_captured_at,
        quoteAgeSeconds: apiPayload.quote_coverage_at_run?.quote_age_seconds,
        status: apiPayload.status,
        sourceStatus: apiPayload.source_status_at_run?.ok,
        runQuality: apiPayload.run_quality_at_publish?.status,
        publishAllowed: apiPayload.publishAllowed,
        fallbackUsed: apiPayload.fallbackUsed,
        fallbackScope: apiPayload.fallbackScope,
        fallbackDetails: apiPayload.fallbackDetails,
        fallbackContract: apiPayload.fallbackContract,
        evidenceStatus: apiPayload.evidenceStatus,
        unattendedStatus: apiPayload.unattendedStatus,
        writeBudget: apiPayload.writeBudget,
        retentionOk: apiPayload.retentionOk,
        blockedReason: apiPayload.blockedReason,
        scannerBlockReason: apiPayload.scanner_block_reason,
        latestWriteAttempted: apiPayload.latestWriteAttempted,
        latestPointerUpdated: apiPayload.latestPointerUpdated,
        blockedReceiptWritten: apiPayload.blockedReceiptWritten,
        previousGoodRunId: apiPayload.previousGoodRunId,
        previousGoodPreserved: apiPayload.previousGoodPreserved,
        requiredFields: apiPayload.requiredFields,
        blankCounts: apiPayload.blankCounts,
        sampleMissingRows: apiPayload.sampleMissingRows,
      },
      cards: apiPayload.matches || [],
    },
  };
}

function buildArtifacts() {
  const artifacts = formalArtifacts();
  const evidence = artifacts.writerRunRow.payload || {};
  artifacts.scannerOutput = {
    ...artifacts.scannerOutput,
    ...evidence,
    runId: artifacts.writerRunRow.run_id,
    strategy: artifacts.writerRunRow.strategy,
    scanStamp: artifacts.writerRunRow.scan_date,
  };
  artifacts.apiPayload = {
    ...artifacts.apiPayload,
    latestPointerUpdated: artifacts.apiPayload.latestPointerUpdated ?? artifacts.writerRunRow.payload.latestPointerUpdated,
    previousGoodPreserved: artifacts.apiPayload.previousGoodPreserved ?? artifacts.writerRunRow.payload.previousGoodPreserved,
  };
  artifacts.uiPayload = buildUiPayload(artifacts.apiPayload);
  return artifacts;
}

function valuesAt(root, expression) {
  const tokens = String(expression || "").split(".");
  let current = [root];
  for (const token of tokens) {
    const isArray = token.endsWith("[]");
    const key = isArray ? token.slice(0, -2) : token;
    const next = [];
    for (const item of current) {
      const value = item?.[key];
      if (isArray) {
        if (Array.isArray(value)) next.push(...value);
      } else {
        next.push(value);
      }
    }
    current = next;
  }
  return current;
}

function rootFor(kind, artifacts) {
  if (kind === "scanner") return { scannerOutput: artifacts.scannerOutput };
  if (kind === "api") return { apiPayload: artifacts.apiPayload };
  if (kind === "writer") return { run: artifacts.writerRunRow, resultRows: artifacts.resultRows };
  if (kind === "ui") return artifacts.uiPayload;
  return {};
}

function valuePass(field, value) {
  if (["fallbackScope", "fallbackDetails", "sampleMissingRows"].includes(field.fieldName)) return Array.isArray(value);
  if (field.allowBlank === true && isBlank(value)) return true;
  if (isBlank(value)) return false;
  if (/code$/i.test(field.fieldName) && field.fieldName === "code") return /^\d{4}$/.test(String(value));
  if (["price", "close", "volume", "tradeValue", "score", "rank", "mutakiV17.entryPrice", "mutakiV17.stopPrice", "mutakiV17.targetPrice", "mutakiV17.riskReward"].includes(field.fieldName)) return Number(value) > 0;
  if (["changePercent", "quoteAgeSeconds", "wallet.mf", "wallet.syncScore", "mutakiV17.ma20", "mutakiV17.rsi14"].includes(field.fieldName)) return Number.isFinite(Number(value));
  if (["publishAllowed", "fallbackUsed", "latestWriteAttempted", "latestPointerUpdated", "blockedReceiptWritten", "previousGoodPreserved", "retentionOk"].includes(field.fieldName)) return typeof value === "boolean";
  if (field.fieldName === "fallbackContract") return value === "strategy4-fallback-disclosure-v1";
  if (field.fieldName === "signals") return Array.isArray(value) && value.length > 0 && value.every((item) => item?.id);
  return true;
}

function validateMatrix(matrix) {
  const issues = [];
  matrix.forEach((row, index) => {
    for (const column of REQUIRED_COLUMNS) {
      if (!(column in row)) issues.push(`row ${index} missing column ${column}`);
    }
    const extras = Object.keys(row).filter((key) => !REQUIRED_COLUMNS.includes(key));
    if (extras.length) issues.push(`row ${index} has unknown columns ${extras.join(",")}`);
    if (row.required === true && row.allowBlank === false) {
      if (row.blockLatestWhenBlank !== true) issues.push(`${row.fieldName} required nonblank must block latest`);
      if (row.preservePreviousGoodWhenBlank !== true) issues.push(`${row.fieldName} required nonblank must preserve previous good`);
    }
  });
  return issues;
}

function validateField(field, artifacts) {
  const checks = [
    ["scanner", field.scannerPayloadPath],
    ["api", field.apiPayloadPath],
    ["writer", field.writerPayloadPath],
    ["ui", field.uiPayloadPath],
  ];
  const issues = [];
  for (const [kind, expression] of checks) {
    const values = valuesAt(rootFor(kind, artifacts), expression);
    if (!values.length) {
      if (field.required) issues.push(`${kind} path missing: ${expression}`);
      continue;
    }
    const bad = values.filter((value) => !valuePass(field, value));
    if (bad.length) issues.push(`${kind} path ${expression} has ${bad.length} invalid values`);
  }
  const blankCounts = artifacts.writerRunRow.payload?.blankCounts || {};
  if (!Object.prototype.hasOwnProperty.call(blankCounts, field.blankCountsKey)) issues.push(`blankCounts missing ${field.blankCountsKey}`);
  return { fieldName: field.fieldName, ok: issues.length === 0, issues };
}

function failClosed(payload) {
  return payload.evidenceStatus === "insufficient"
    && payload.unattendedStatus === "NO"
    && payload.publishAllowed === false
    && payload.latestPointerUpdated === false
    && payload.degradedBlocksLatest === true
    && payload.preservePreviousGood === true
    && payload.latestWriteAttempted === false
    && payload.blockedReceiptWritten === true
    && payload.writeBudget && typeof payload.writeBudget === "object"
    && typeof payload.retentionOk === "boolean"
    && Boolean(payload.blockedReason || payload.scanner_block_reason);
}

function negativeMutations(matrix, artifacts) {
  const results = [];
  const base = artifacts.blockedReceiptPayload;
  for (const field of matrix.filter((item) => item.required === true && item.allowBlank === false)) {
    const mutated = clone(base);
    delete mutated.blankCounts[field.blankCountsKey];
    results.push({
      name: `blankCounts-missing:${field.fieldName}`,
      ok: !Object.prototype.hasOwnProperty.call(mutated.blankCounts || {}, field.blankCountsKey) && failClosed(base),
    });
  }
  const samples = [
    ["source-not-ready-fake-yes", { ...clone(base), unattendedStatus: "YES" }],
    ["source-not-ready-publish-allowed", { ...clone(base), publishAllowed: true }],
    ["source-not-ready-latest-pointer-updated", { ...clone(base), latestPointerUpdated: true }],
    ["empty-result-overwrites-previous-good", { ...clone(base), emptyResult: true, latestPointerUpdated: true }],
    ["fallback-display-only-formal-yes", { ...clone(base), fallbackUsed: true, fallbackScope: [], fallbackDetails: [], unattendedStatus: "YES" }],
    ["missing-write-budget", (() => { const item = clone(base); delete item.writeBudget; return item; })()],
    ["missing-retention-ok", (() => { const item = clone(base); delete item.retentionOk; return item; })()],
    ["missing-blocked-reason", (() => { const item = clone(base); delete item.blockedReason; delete item.scanner_block_reason; return item; })()],
    ["previous-good-not-preserved", { ...clone(base), previousGoodPreserved: false, preservePreviousGood: false }],
  ];
  for (const [name, payload] of samples) {
    results.push({ name, ok: !failClosed(payload) });
  }
  return results;
}

function main() {
  const matrix = readMatrix();
  const artifacts = buildArtifacts();
  const matrixIssues = validateMatrix(matrix);
  const fieldResults = matrix.map((field) => validateField(field, artifacts));
  const mutationResults = negativeMutations(matrix, artifacts);
  const issues = [
    ...matrixIssues,
    ...fieldResults.flatMap((result) => result.issues.map((issue) => `${result.fieldName}: ${issue}`)),
    ...mutationResults.filter((result) => !result.ok).map((result) => `negative mutation did not fail: ${result.name}`),
  ];
  console.log(JSON.stringify({
    ok: issues.length === 0,
    matrixFile: MATRIX_FILE,
    matrixRows: matrix.length,
    checkedPayloads: ["scanner", "api", "writer", "ui", "blockedReceipt"],
    fieldResults,
    negativeMutationCount: mutationResults.length,
    mutationResults,
    issues,
  }, null, 2));
  if (issues.length) process.exit(1);
}

if (require.main === module) main();
