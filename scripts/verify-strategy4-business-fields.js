"use strict";

const fs = require("fs");
const path = require("path");
const { formalArtifacts } = require("./verify-strategy4-prewater-formal-payloads");

const MATRIX_FILE = path.join(__dirname, "..", "data", "fixtures", "strategy4-business-field-matrix.json");
const DECISION_GATE_MATRIX_FILE = path.join(__dirname, "..", "data", "fixtures", "strategy4-decision-gate-matrix.json");
const SOURCE_CONTRACT_MATRIX_FILE = path.join(__dirname, "..", "data", "fixtures", "strategy4-source-contract-matrix.json");
const REQUIRED_MATRIX_COLUMNS = [
  "fieldName",
  "payloadPath",
  "scannerPayloadPath",
  "writerPayloadPath",
  "sourceTableOrView",
  "businessPurpose",
  "required",
  "allowBlank",
  "blockLatestWhenBlank",
  "verifierRule",
  "blankCountsKey",
  "sampleMissingRowsKey",
];
const REQUIRED_DECISION_COLUMNS = [
  "gateName",
  "gatePayloadPath",
  "scannerPayloadPath",
  "apiPayloadPath",
  "writerPayloadPath",
  "sourceTableOrView",
  "businessPurpose",
  "requiredForScan",
  "requiredForPublish",
  "requiredForFormalEntry",
  "allowedStates",
  "blockedStates",
  "whenBlockedReason",
  "fallbackAllowed",
  "fallbackScopeAllowed",
  "blockLatestWhenFailed",
  "preservePreviousGoodWhenFailed",
  "verifierRule",
  "negativeTestName",
  "sampleFailureExpected",
];
const REQUIRED_SOURCE_COLUMNS = [
  "sourceName",
  "payloadPath",
  "sourceTableOrView",
  "requiredForScan",
  "requiredForPublish",
  "requiredForFormalEntry",
  "threshold",
  "staleLimitSeconds",
  "notRequiredReason",
  "verifierRule",
  "negativeTestName",
  "blockLatestWhenFailed",
];

function readMatrix() {
  return JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8"));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isBlank(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function valuesAt(object, expression) {
  const root = {
    scannerOutput: object.scannerOutput,
    run: object.writerRunRow,
    resultRows: object.resultRows,
    apiPayload: object.apiPayload,
    blockedReceipt: object.blockedReceiptPayload,
    degradedReceipt: object.degradedReceiptPayload,
  };
  const normalized = expression.startsWith("matches[]") || expression.startsWith("dataContractSource") || expression.startsWith("fallbackContract")
    ? `apiPayload.${expression}`
    : expression;
  const tokens = normalized.split(".");
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

function rulePass(fieldName, value) {
  if (isBlank(value)) return false;
  if (fieldName === "code") return /^\d{4}$/.test(String(value));
  if (["price", "volume", "score", "mutakiV17.entryPrice", "mutakiV17.stopPrice", "mutakiV17.targetPrice", "mutakiV17.riskReward"].includes(fieldName)) {
    return Number(value) > 0;
  }
  if (["wallet.mf", "wallet.syncScore", "mutakiV17.ma20", "mutakiV17.rsi14"].includes(fieldName)) {
    return Number.isFinite(Number(value));
  }
  if (fieldName === "wallet.strongBuy") return typeof value === "boolean";
  if (fieldName === "swingZone") return ["A", "B", "C"].includes(String(value));
  if (fieldName === "signals") return Array.isArray(value) && value.length > 0 && value.every((item) => item && typeof item === "object" && !isBlank(item.id));
  if (fieldName === "fallbackContract") return value === "strategy4-fallback-disclosure-v1";
  return !isBlank(value);
}

function missingRowsFor(field, values) {
  return values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => !rulePass(field.fieldName, value))
    .slice(0, 10)
    .map(({ index }) => ({
      index,
      code: "",
      name: "",
      missing: [field.fieldName],
    }));
}

function validateMatrixShape(matrix) {
  const issues = [];
  if (!Array.isArray(matrix) || matrix.length === 0) issues.push("matrix must be a non-empty array");
  matrix.forEach((row, index) => {
    for (const column of REQUIRED_MATRIX_COLUMNS) {
      if (!(column in row)) issues.push(`row ${index} missing column ${column}`);
    }
    if (Object.keys(row).some((key) => !REQUIRED_MATRIX_COLUMNS.includes(key))) {
      issues.push(`row ${index} has unknown columns`);
    }
    if (row.required === true && row.allowBlank === false && row.blockLatestWhenBlank !== true) {
      issues.push(`row ${index} ${row.fieldName} required nonblank must block latest`);
    }
  });
  return issues;
}

function validateRequiredColumns(rows, columns, label, nameKey) {
  const issues = [];
  if (!Array.isArray(rows) || rows.length === 0) issues.push(`${label} must be a non-empty array`);
  rows.forEach((row, index) => {
    for (const column of columns) {
      if (!(column in row)) issues.push(`${label} row ${index} missing column ${column}`);
    }
    if (Object.keys(row).some((key) => !columns.includes(key))) issues.push(`${label} row ${index} has unknown columns`);
    if (row.requiredForScan === false || row.requiredForPublish === false || row.requiredForFormalEntry === false) {
      if (!("notRequiredReason" in row) && !String(row[nameKey] || "").includes("preopen") && !String(row[nameKey] || "").includes("futopt")) {
        issues.push(`${label} row ${index} ${row[nameKey]} has not-required flag without explanation`);
      }
    }
  });
  return issues;
}

function validateDecisionGates(matrix, artifacts) {
  const requiredNames = new Set(["after_close_profile", "daily_volume_ready", "wallet_breakdown_ready", "mutaki_breakdown_ready", "schedule_recovered_complete_run"]);
  const names = new Set(matrix.map((row) => row.gateName));
  const issues = [...requiredNames].filter((name) => !names.has(name)).map((name) => `missing required Strategy4 decision gate ${name}`);
  for (const gate of matrix) {
    if (gate.requiredForPublish === true && gate.blockLatestWhenFailed !== true) issues.push(`${gate.gateName} publish gate must block latest when failed`);
    if (gate.requiredForPublish === true && gate.preservePreviousGoodWhenFailed !== true) issues.push(`${gate.gateName} publish gate must preserve previous good when failed`);
    if (gate.fallbackAllowed === true) issues.push(`${gate.gateName} fallbackAllowed must be false for formal Strategy4 publish`);
  }
  if (!artifacts.scannerOutput.runMode) issues.push("after_close_profile runMode missing from scannerOutput");
  if (artifacts.scannerOutput.supabaseCoverage?.qualityStatus !== "complete") issues.push("daily_volume_ready formal sample is not complete");
  if (artifacts.scannerOutput.matches.some((row) => !row.wallet)) issues.push("wallet_breakdown_ready missing wallet in scannerOutput");
  if (artifacts.scannerOutput.matches.some((row) => !row.mutakiV17)) issues.push("mutaki_breakdown_ready missing mutakiV17 in scannerOutput");
  if (artifacts.writerRunRow.complete !== true) issues.push("schedule_recovered_complete_run run.complete must be true in formal sample");
  return issues;
}

function validateSourceContracts(matrix, artifacts) {
  const requiredNames = new Set([
    "source_snapshot_captured_at",
    "source_status_at_run",
    "quote_coverage_at_run",
    "quote fresh coverage 120s",
    "quote_age_seconds",
    "intraday_1m_readiness_at_run",
    "intraday_1m_stale_seconds",
    "ma_readiness_at_run",
    "ready_ma20",
    "ready_ma35",
    "preopen_futopt_daily_readiness_at_run",
    "daily_volume_status",
    "preopen_status",
    "futopt_status",
    "permission_status",
    "run_quality_at_publish",
  ]);
  const names = new Set(matrix.map((row) => row.sourceName));
  const issues = [...requiredNames].filter((name) => !names.has(name)).map((name) => `missing source contract ${name}`);
  const payload = artifacts.writerRunRow.payload || {};
  if (!payload.source_snapshot_captured_at) issues.push("source_snapshot_captured_at missing in writer payload");
  if (payload.source_status_at_run?.ok !== true) issues.push("source_status_at_run ok must be true in formal sample");
  if (payload.quote_coverage_at_run?.ok !== true) issues.push("quote_coverage_at_run ok must be true in formal sample");
  if (Number(payload.quote_coverage_at_run?.fresh_quote_coverage_120s || 0) < 0.95) issues.push("quote fresh coverage below threshold in formal sample");
  if (Number(payload.quote_coverage_at_run?.quote_age_seconds || 999999) > 120) issues.push("quote age above threshold in formal sample");
  if (payload.intraday_1m_readiness_at_run?.ok !== true) issues.push("intraday readiness not ok in formal sample");
  if (payload.ma_readiness_at_run?.ok !== true) issues.push("MA readiness not ok in formal sample");
  if (!payload.run_quality_at_publish) issues.push("run_quality_at_publish missing in formal sample");
  for (const row of matrix) {
    if ((row.requiredForScan === false || row.requiredForPublish === false || row.requiredForFormalEntry === false) && !String(row.notRequiredReason || "").trim()) {
      issues.push(`${row.sourceName} notRequiredReason missing`);
    }
  }
  return issues;
}

function validateField(field, artifacts) {
  const apiValues = valuesAt(artifacts, field.payloadPath);
  const scannerValues = valuesAt(artifacts, field.scannerPayloadPath);
  const writerValues = valuesAt(artifacts, field.writerPayloadPath);
  const groups = [
    ["api", apiValues],
    ["scanner", scannerValues],
    ["writer", writerValues],
  ];
  const issues = [];
  const missingRows = [];
  for (const [label, values] of groups) {
    if (!values.length) {
      issues.push(`${field.fieldName} ${label} path ${label === "api" ? field.payloadPath : label === "scanner" ? field.scannerPayloadPath : field.writerPayloadPath} not found`);
      continue;
    }
    const missing = missingRowsFor(field, values);
    if (missing.length) {
      issues.push(`${field.fieldName} ${label} has ${missing.length} invalid/blank sample values`);
      missingRows.push(...missing.map((row) => ({ ...row, source: label })));
    }
  }
  const runPayload = artifacts.writerRunRow.payload || {};
  const blankCounts = runPayload.blankCounts || {};
  const expectedBlankCount = missingRows.length;
  if (!Object.prototype.hasOwnProperty.call(blankCounts, field.blankCountsKey)) {
    issues.push(`${field.fieldName} blankCounts missing key ${field.blankCountsKey}`);
  } else if (Number(blankCounts[field.blankCountsKey]) !== expectedBlankCount) {
    issues.push(`${field.fieldName} blankCounts ${field.blankCountsKey}=${blankCounts[field.blankCountsKey]} expected ${expectedBlankCount}`);
  }
  if (expectedBlankCount > 0 && !Array.isArray(runPayload.sampleMissingRows)) {
    issues.push(`${field.fieldName} sampleMissingRows missing`);
  }
  return {
    fieldName: field.fieldName,
    ok: issues.length === 0,
    blankCount: expectedBlankCount,
    issues,
  };
}

function validateReceipts(artifacts) {
  const receiptChecks = [
    ["blockedReceipt", artifacts.blockedReceiptPayload],
    ["degradedReceipt", artifacts.degradedReceiptPayload],
  ];
  const issues = [];
  for (const [label, payload] of receiptChecks) {
    if (!payload) {
      issues.push(`${label} missing`);
      continue;
    }
    if (payload.writeBudget?.allowLatestWrite !== false) issues.push(`${label} allowLatestWrite must be false`);
    if (payload.preservePreviousGood !== true) issues.push(`${label} preservePreviousGood must be true`);
    if (payload.degradedBlocksLatest !== true) issues.push(`${label} degradedBlocksLatest must be true`);
    if (payload.blockedReceiptWritten !== true) issues.push(`${label} blockedReceiptWritten must be true`);
    if (payload.unattendedStatus === "YES") issues.push(`${label} unattendedStatus must not be YES`);
    if (!payload.blockedReason && !payload.scanner_block_reason) issues.push(`${label} block reason missing`);
  }
  return issues;
}

function main() {
  const matrix = readMatrix();
  const decisionMatrix = readJson(DECISION_GATE_MATRIX_FILE);
  const sourceMatrix = readJson(SOURCE_CONTRACT_MATRIX_FILE);
  const artifacts = formalArtifacts();
  const shapeIssues = validateMatrixShape(matrix);
  const decisionShapeIssues = validateRequiredColumns(decisionMatrix, REQUIRED_DECISION_COLUMNS, "decision gate matrix", "gateName");
  const sourceShapeIssues = validateRequiredColumns(sourceMatrix, REQUIRED_SOURCE_COLUMNS, "source contract matrix", "sourceName");
  const decisionIssues = validateDecisionGates(decisionMatrix, artifacts);
  const sourceIssues = validateSourceContracts(sourceMatrix, artifacts);
  const fieldResults = matrix.map((field) => validateField(field, artifacts));
  const receiptIssues = validateReceipts(artifacts);
  const issues = [
    ...shapeIssues,
    ...decisionShapeIssues,
    ...sourceShapeIssues,
    ...decisionIssues,
    ...sourceIssues,
    ...fieldResults.flatMap((result) => result.issues.map((issue) => `${result.fieldName}: ${issue}`)),
    ...receiptIssues,
  ];
  const payload = {
    ok: issues.length === 0,
    matrixRows: matrix.length,
    decisionGateRows: decisionMatrix.length,
    sourceContractRows: sourceMatrix.length,
    checkedArtifacts: ["scannerOutput", "apiPayload", "writerRunRow", "resultRows", "blockedReceiptPayload", "degradedReceiptPayload"],
    matrixFiles: {
      businessFieldMatrix: MATRIX_FILE,
      decisionGateMatrix: DECISION_GATE_MATRIX_FILE,
      sourceContractMatrix: SOURCE_CONTRACT_MATRIX_FILE,
    },
    fieldResults,
    decisionIssues,
    sourceIssues,
    receiptIssues,
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  readMatrix,
  validateField,
  validateMatrixShape,
  validateReceipts,
};
