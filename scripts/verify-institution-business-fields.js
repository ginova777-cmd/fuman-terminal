"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  apiLatestPayload,
  scannerRunPayload,
  scanReceiptPayload,
  blockedReceiptPayload,
  sampleOutput,
} = require("./verify-institution-prewater-strict");
const {
  buildInstitutionRunRow,
  buildInstitutionResultRows,
} = require("./scan-institution-cache");

const ROOT = path.resolve(__dirname, "..");
const MATRIX_FILE = path.join(ROOT, "fixtures", "institution-business-field-matrix.json");
const REQUIREMENTS_FILE = path.join(ROOT, "fixtures", "institution-strategy-requirements.json");
const REQUIRED_COLUMNS = [
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPath(object, dotted) {
  return String(dotted || "").split(".").filter(Boolean).reduce((cursor, part) => cursor?.[part], object);
}

function nonBlank(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function rowsFromPayload(payload) {
  return Array.isArray(payload.rows) ? payload.rows : [];
}

function rowValue(row, fieldName) {
  if (fieldName === "source") return row.source;
  if (fieldName === "dataContractSource") return row.dataContractSource || row.data_contract_source;
  return row[fieldName];
}

function runValue(payload, fieldName) {
  const quality = payload.run_quality_at_publish || {};
  const source = payload.institution_source_status_at_run || payload.chip_source_status_at_run || {};
  const coverage = payload.sourceCoverage || {};
  const map = {
    runId: payload.runId || payload.latestRunId,
    usedDate: payload.usedDate,
    coverageStatus: coverage.coverageStatus || source.coverageStatus,
    institutionalRows: source.institutionalRows || source.sourceRows || coverage.institutionalRows,
    validAfterExclusionRows: source.validAfterExclusionRows || source.resultRows || coverage.validAfterExclusionRows,
    fallbackUsed: payload.fallbackUsed ?? quality.fallbackUsed,
    fallbackScope: payload.fallbackScope ?? quality.fallbackScope ?? [],
    fallbackDetails: payload.fallbackDetails ?? quality.fallbackDetails ?? [],
    fallbackContract: payload.fallbackContract || quality.fallbackContract,
    evidenceStatus: payload.evidenceStatus || quality.evidenceStatus,
    unattendedStatus: payload.unattendedStatus || quality.unattendedStatus,
    source_snapshot_captured_at: payload.source_snapshot_captured_at || quality.source_snapshot_captured_at,
    institution_source_status_at_run: payload.institution_source_status_at_run || quality.institution_source_status_at_run,
    chip_source_status_at_run: payload.chip_source_status_at_run || quality.chip_source_status_at_run,
    requiredFields: quality.requiredFields || payload.requiredFields || [],
    blankCounts: quality.blankCounts || payload.blankCounts || {},
    sampleMissingRows: quality.sampleMissingRows ?? payload.sampleMissingRows ?? [],
    writeBudget: payload.writeBudget || quality.writeBudget,
    blockedReason: payload.blockedReason || quality.blockedReason || payload.reason || "not_blocked",
    scanner_block_reason: payload.scanner_block_reason || quality.scanner_block_reason || payload.reason || "not_blocked",
  };
  return map[fieldName];
}

function expectedRule(fieldName, value) {
  if (fieldName === "code") return /^\d{4}$/.test(String(value || ""));
  if (fieldName === "source") return /TWSE T86|TPEx 3itrade/i.test(String(value || ""));
  if (["close", "percent", "tradeVolume", "value", "foreign", "trust", "dealer", "total", "foreignNet", "trustNet", "dealerNet", "totalNet", "institutionTotalNet", "foreignTrustBuyVolumePct", "foreignStreak", "trustStreak", "jointStreak"].includes(fieldName)) {
    return Number.isFinite(Number(value));
  }
  if (fieldName === "rank") return Number.isInteger(Number(value)) && Number(value) > 0;
  if (fieldName === "usedDate") return /^\d{8}$/.test(String(value || ""));
  if (fieldName === "coverageStatus") return String(value || "").length > 0;
  if (fieldName === "institutionalRows" || fieldName === "validAfterExclusionRows") return Number(value) >= 1500;
  if (fieldName === "fallbackUsed") return typeof value === "boolean";
  if (fieldName === "fallbackScope") return value !== undefined && value !== null;
  if (fieldName === "fallbackDetails") return Array.isArray(value);
  if (fieldName === "institution_source_status_at_run" || fieldName === "chip_source_status_at_run" || fieldName === "blankCounts" || fieldName === "writeBudget") return isObject(value);
  if (fieldName === "requiredFields") return Array.isArray(value) ? value.length > 0 : isObject(value);
  if (fieldName === "sampleMissingRows") return Array.isArray(value);
  return nonBlank(value);
}

function verifyRequirementsAlignment(matrix, requirements) {
  const issues = [];
  const matrixNames = new Set(matrix.fields.map((field) => field.fieldName));
  const requirementNames = new Set(requirements.outputFields || []);
  const missingFromMatrix = [...requirementNames].filter((fieldName) => !matrixNames.has(fieldName));
  const extraInMatrix = [...matrixNames].filter((fieldName) => !requirementNames.has(fieldName));
  for (const fieldName of missingFromMatrix) issues.push({ id: "requirements_output_field_missing_from_business_matrix", fieldName });
  for (const fieldName of extraInMatrix) issues.push({ id: "business_matrix_field_not_in_requirements_outputFields", fieldName });
  return {
    issues,
    requirementsOutputFields: requirementNames.size,
    businessMatrixFields: matrixNames.size,
    matrixMatchesRequirements: missingFromMatrix.length === 0 && extraInMatrix.length === 0,
  };
}

function verifyMatrixShape(matrix) {
  const issues = [];
  assert.strictEqual(matrix.strategy, "institution");
  assert(Array.isArray(matrix.fields), "matrix.fields must be array");
  const names = new Set();
  for (const [index, field] of matrix.fields.entries()) {
    for (const column of REQUIRED_COLUMNS) {
      if (!(column in field)) issues.push({ id: "matrix_column_missing", index, fieldName: field.fieldName || "", column });
    }
    if (names.has(field.fieldName)) issues.push({ id: "matrix_duplicate_field", fieldName: field.fieldName });
    names.add(field.fieldName);
    if (field.required === true && field.allowBlank === false && field.blockLatestWhenBlank !== true) {
      issues.push({ id: "required_nonblank_must_block_latest", fieldName: field.fieldName });
    }
  }
  return issues;
}

function verifyRows(label, rows, fields) {
  const blankCounts = {};
  const sampleMissingRows = [];
  for (const field of fields) {
    blankCounts[field.blankCountsKey] = 0;
  }
  rows.forEach((row, index) => {
    const missing = [];
    for (const field of fields) {
      const value = rowValue(row, field.fieldName);
      if (field.required && !field.allowBlank && !expectedRule(field.fieldName, value)) {
        blankCounts[field.blankCountsKey] += 1;
        missing.push(field.fieldName);
      }
    }
    if (missing.length) {
      sampleMissingRows.push({ source: label, index, code: row.code || "", name: row.name || "", missing });
    }
  });
  return { blankCounts, sampleMissingRows };
}

function verifyRunPayload(label, payload, fields) {
  const blankCounts = {};
  const sampleMissingRows = [];
  for (const field of fields) {
    const value = runValue(payload, field.fieldName);
    const missing = field.required && !field.allowBlank && !expectedRule(field.fieldName, value);
    blankCounts[field.blankCountsKey] = missing ? 1 : 0;
    if (missing) sampleMissingRows.push({ source: label, runId: payload.runId || "", missing: [field.fieldName] });
  }
  return { blankCounts, sampleMissingRows };
}

function main() {
  const matrix = readJson(MATRIX_FILE);
  const requirements = readJson(REQUIREMENTS_FILE);
  const issues = verifyMatrixShape(matrix);
  const alignment = verifyRequirementsAlignment(matrix, requirements);
  issues.push(...alignment.issues);
  const rowFields = matrix.fields.filter((field) => String(field.payloadPath).startsWith("rows[]"));
  const runFields = matrix.fields.filter((field) => !String(field.payloadPath).startsWith("rows[]"));

  const output = sampleOutput();
  const writerRun = buildInstitutionRunRow(output, output.runId, "complete");
  const writerResults = buildInstitutionResultRows(output, output.runId);
  const payloads = [
    { label: "api-latest-payload", payload: apiLatestPayload() },
    { label: "scanner-run-payload", payload: scannerRunPayload() },
    { label: "scan-receipt", payload: scanReceiptPayload() },
  ];
  for (const { label, payload } of payloads) {
    const rowAudit = verifyRows(label, rowsFromPayload(payload), rowFields);
    const runAudit = verifyRunPayload(label, payload, runFields);
    for (const [key, value] of Object.entries({ ...rowAudit.blankCounts, ...runAudit.blankCounts })) {
      if (value !== 0) issues.push({ id: "business_field_blank", label, key, value });
    }
    if (rowAudit.sampleMissingRows.length || runAudit.sampleMissingRows.length) {
      issues.push({ id: "sampleMissingRows_not_empty", label, sampleMissingRows: [...rowAudit.sampleMissingRows, ...runAudit.sampleMissingRows].slice(0, 10) });
    }
  }
  const writerRows = writerResults.map((row) => ({ ...row.payload, rank: row.rank, dataContractSource: row.data_contract_source }));
  const writerRowAudit = verifyRows("writer-result-row-payload", writerRows, rowFields);
  for (const [key, value] of Object.entries(writerRowAudit.blankCounts)) {
    if (value !== 0) issues.push({ id: "writer_business_field_blank", key, value });
  }
  const writerRunAudit = verifyRunPayload("writer-run-payload", writerRun.payload, runFields);
  for (const [key, value] of Object.entries(writerRunAudit.blankCounts)) {
    if (value !== 0) issues.push({ id: "writer_run_field_blank", key, value });
  }
  const blocked = blockedReceiptPayload();
  assert.strictEqual(blocked.evidenceStatus, "insufficient");
  assert.strictEqual(blocked.unattendedStatus, "NO");
  assert.strictEqual(blocked.writeBudget.allowed, false);

  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    strategy: "institution",
    contract: matrix.contract,
    matrixFields: matrix.fields.length,
    requirementsOutputFields: alignment.requirementsOutputFields,
    matrixMatchesRequirements: alignment.matrixMatchesRequirements,
    formalPayloadsChecked: ["api-latest-payload", "scanner-run-payload", "scan-receipt", "writer-run-payload", "writer-result-row-payload", "blocked-receipt"],
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = { verifyMatrixShape, verifyRequirementsAlignment, verifyRows, verifyRunPayload };
