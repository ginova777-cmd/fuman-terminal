"use strict";

const assert = require("assert");
const matrix = require("../fixtures/strategy5-business-field-matrix.json");
const {
  buildStrategy5RunRow,
  buildStrategy5ResultRows,
} = require("./scan-strategy5-cache");
const strategy5Api = require("../api/strategy5-latest");
const { verifyCanonical } = require("./verify-strategy5-prewater-fixtures");
const { adaptStrategy5Payload } = require("./strategy5-prewater-payload-adapter");
const { sampleOutput } = require("./verify-strategy5-prewater-formal-payloads");

const MATRIX_KEYS = [
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function splitAlternatives(path) {
  return String(path || "").split("|").map((part) => part.trim()).filter(Boolean);
}

function pathValues(root, path) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursors = [root];
  for (const rawPart of parts) {
    const arrayPart = rawPart.endsWith("[]");
    const part = arrayPart ? rawPart.slice(0, -2) : rawPart;
    const next = [];
    for (const cursor of cursors) {
      if (cursor === null || cursor === undefined) continue;
      const value = part ? cursor[part] : cursor;
      if (arrayPart) {
        if (Array.isArray(value)) next.push(...value);
      } else {
        next.push(value);
      }
    }
    cursors = next;
  }
  return cursors;
}

function firstNonBlankValues(root, alternatives) {
  for (const path of splitAlternatives(alternatives)) {
    const values = pathValues(root, path);
    if (values.some((value) => !isBlank(value))) return values;
  }
  return [];
}

function allNonBlank(values) {
  return values.length > 0 && values.every((value) => !isBlank(value));
}

function allFourDigit(values) {
  return values.length > 0 && values.every((value) => /^\d{4}$/.test(String(value || "")));
}

function allFinite(values) {
  return values.length > 0 && values.every((value) => Number.isFinite(Number(value)));
}

function allPositive(values) {
  return values.length > 0 && values.every((value) => Number(value) > 0);
}

function allPositiveInt(values) {
  return values.length > 0 && values.every((value) => Number.isInteger(Number(value)) && Number(value) > 0);
}

function checkRule(fieldName, values) {
  if (["code"].includes(fieldName)) return allFourDigit(values);
  if (["price", "volume", "score"].includes(fieldName)) return allPositive(values);
  if (["changePercent", "institutionTotalNet", "foreignNet", "trustNet", "dealerNet"].includes(fieldName)) return allFinite(values);
  if (fieldName === "rank") return allPositiveInt(values);
  if (fieldName === "signals") return values.length > 0 && values.every((value) => Array.isArray(value) && value.length > 0);
  if (fieldName === "fallbackUsed") return values.length > 0 && values.every((value) => typeof value === "boolean");
  return allNonBlank(values);
}

function blankField(row, key) {
  if (!row || typeof row !== "object") return;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  if (key === "code") {
    row.code = "";
    payload.code = "";
  } else if (key === "name") {
    row.name = "";
    payload.name = "";
  } else if (key === "price") {
    row.price = 0;
    row.close = 0;
    payload.price = 0;
    payload.close = 0;
  } else if (key === "changePercent") {
    row.change_percent = "";
    payload.percent = "";
    payload.changePercent = "";
    payload.change_percent = "";
  } else if (key === "volume") {
    row.volume = 0;
    row.trade_volume = 0;
    payload.volume = 0;
    payload.tradeVolume = 0;
    payload.trade_volume = 0;
  } else if (key === "score") {
    row.score = 0;
    payload.score = 0;
  } else if (key === "reason") {
    row.reason = "";
    payload.reason = "";
    if (payload.activeMatch) payload.activeMatch.reason = "";
    if (Array.isArray(payload.matches)) payload.matches.forEach((signal) => { if (signal) signal.reason = ""; });
  } else if (key === "signals") {
    row.signals = [];
    payload.matches = [];
  }
  row.payload = payload;
}

function buildFormal() {
  const scannerOutput = sampleOutput();
  scannerOutput.matches = scannerOutput.matches.map((row, index) => ({
    ...row,
    inst: {
      total: index === 0 ? 1600 : 1180,
      foreign: index === 0 ? 900 : 650,
      trust: index === 0 ? 500 : 330,
      dealer: index === 0 ? 200 : 200,
    },
    institutionTotalNet: index === 0 ? 1600 : 1180,
    foreignNet: index === 0 ? 900 : 650,
    trustNet: index === 0 ? 500 : 330,
    dealerNet: index === 0 ? 200 : 200,
  }));
  scannerOutput.fallbackUsed = false;
  scannerOutput.fallbackContract = "strategy5-fallback-disallowed-for-publish";
  scannerOutput.evidenceStatus = "complete";
  scannerOutput.unattendedStatus = "YES";
  const runRow = buildStrategy5RunRow(scannerOutput, scannerOutput.runId, "complete");
  const resultRows = buildStrategy5ResultRows(scannerOutput, scannerOutput.runId);
  const run = {
    ...runRow,
    readback_count: resultRows.length,
    payload: runRow.payload,
  };
  const apiPayload = strategy5Api._test.buildPayload(resultRows, run, {
    canvas: true,
    chipSourceHealth: {
      coverage_status: "ready",
      latest_trade_date: "2026-07-04",
      institutional_rows: 1800,
      margin_rows: 1800,
      unified_rows: 1800,
      valid_after_exclusion_rows: 1800,
      min_required_rows: 1500,
      stale_days: 0,
      reason: "formal sample chip source ready",
    },
  });
  return { scannerOutput, runRow, resultRows, apiPayload };
}

function assertMatrixShape(row, index) {
  for (const key of MATRIX_KEYS) assert(Object.prototype.hasOwnProperty.call(row, key), `matrix row ${index} missing ${key}`);
  assert.strictEqual(typeof row.required, "boolean", `${row.fieldName} required must be boolean`);
  assert.strictEqual(typeof row.allowBlank, "boolean", `${row.fieldName} allowBlank must be boolean`);
  assert.strictEqual(typeof row.blockLatestWhenBlank, "boolean", `${row.fieldName} blockLatestWhenBlank must be boolean`);
  assert(row.fieldName && row.payloadPath && row.scannerPayloadPath && row.writerPayloadPath, `matrix row ${index} path missing`);
  assert(row.sourceTableOrView && !/unknown|未查到/i.test(row.sourceTableOrView), `${row.fieldName} sourceTableOrView missing`);
  assert(row.businessPurpose, `${row.fieldName} businessPurpose missing`);
  assert(row.verifierRule, `${row.fieldName} verifierRule missing`);
  if (row.required && row.allowBlank === false) {
    assert.strictEqual(row.blockLatestWhenBlank, true, `${row.fieldName} required nonblank must block latest`);
  }
}

function verifyBusinessFields() {
  const formal = buildFormal();
  const root = {
    scannerOutput: formal.scannerOutput,
    runRow: formal.runRow,
    resultRows: formal.resultRows,
    ...formal.apiPayload,
  };
  const fieldChecks = matrix.map((row, index) => {
    assertMatrixShape(row, index);
    const apiValues = firstNonBlankValues(root, row.payloadPath);
    const scannerValues = firstNonBlankValues(root, row.scannerPayloadPath);
    const writerValues = firstNonBlankValues(root, row.writerPayloadPath);
    if (row.required && row.allowBlank === false) {
      assert(checkRule(row.fieldName, apiValues), `${row.fieldName} API payload rule failed at ${row.payloadPath}`);
      assert(checkRule(row.fieldName, scannerValues), `${row.fieldName} scanner payload rule failed at ${row.scannerPayloadPath}`);
      assert(checkRule(row.fieldName, writerValues), `${row.fieldName} writer payload rule failed at ${row.writerPayloadPath}`);
    }
    if (row.blankCountsKey) {
      const apiBlank = formal.apiPayload.run_quality_at_publish?.blankCounts?.[row.blankCountsKey];
      const runBlank = formal.runRow.payload.run_quality_at_publish?.blankCounts?.[row.blankCountsKey];
      assert.strictEqual(apiBlank, 0, `${row.fieldName} API blankCounts.${row.blankCountsKey} must be 0`);
      assert.strictEqual(runBlank, 0, `${row.fieldName} run blankCounts.${row.blankCountsKey} must be 0`);
      const mutatedRows = clone(formal.resultRows);
      blankField(mutatedRows[0], row.blankCountsKey);
      const mutatedRun = {
        ...formal.runRow,
        readback_count: mutatedRows.length,
        payload: formal.runRow.payload,
      };
      const mutatedApi = strategy5Api._test.buildPayload(mutatedRows, mutatedRun, {
        canvas: true,
        chipSourceHealth: {
          coverage_status: "ready",
          latest_trade_date: "2026-07-04",
          institutional_rows: 1800,
          margin_rows: 1800,
          unified_rows: 1800,
          valid_after_exclusion_rows: 1800,
          min_required_rows: 1500,
          stale_days: 0,
          reason: "formal sample chip source ready",
        },
      });
      assert(mutatedApi.run_quality_at_publish.blankCounts[row.blankCountsKey] > 0, `${row.fieldName} mutation did not increment blankCounts.${row.blankCountsKey}`);
      assert(
        mutatedApi.run_quality_at_publish.sampleMissingRows.some((missing) => Array.isArray(missing.missingGroups) && missing.missingGroups.includes(row.blankCountsKey)),
        `${row.fieldName} mutation did not populate sampleMissingRows`
      );
      const canonical = adaptStrategy5Payload({
        ...mutatedApi,
        latestPointerUpdated: true,
        blockedReceiptWritten: false,
        blockedReason: `business_field_blank:${row.blankCountsKey}`,
        scanner_block_reason: `business_field_blank:${row.blankCountsKey}`,
      }, { type: "api" });
      const canonicalResult = verifyCanonical(`business-field-mutation-${row.blankCountsKey}`, canonical);
      assert.strictEqual(canonicalResult.ok, false, `${row.fieldName} blank mutation must not pass canonical verifier`);
    }
    return {
      fieldName: row.fieldName,
      apiValues: apiValues.length,
      scannerValues: scannerValues.length,
      writerValues: writerValues.length,
      blankCountsKey: row.blankCountsKey,
    };
  });
  return { ok: true, checkedAt: new Date().toISOString(), matrixRows: matrix.length, fieldChecks };
}

function main() {
  console.log(JSON.stringify(verifyBusinessFields(), null, 2));
}

if (require.main === module) main();

module.exports = {
  MATRIX_KEYS,
  buildFormal,
  verifyBusinessFields,
};
