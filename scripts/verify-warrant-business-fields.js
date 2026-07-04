"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MATRIX_FILE = path.join(ROOT, "fixtures", "warrant-business-fields.json");
const matrix = JSON.parse(fs.readFileSync(MATRIX_FILE, "utf8"));

const REQUIRED_COLUMNS = ["fieldName","payloadPath","scannerPayloadPath","writerPayloadPath","sourceTableOrView","businessPurpose","required","allowBlank","blockLatestWhenBlank","verifierRule","blankCountsKey","sampleMissingRowsKey"];

function main() {
  const issues = [];
  const seen = new Set();
  if (!Array.isArray(matrix) || !matrix.length) issues.push("business field matrix is empty");
  matrix.forEach((row, index) => {
    const missing = REQUIRED_COLUMNS.filter((key) => !Object.prototype.hasOwnProperty.call(row, key));
    if (missing.length) issues.push(`row ${index} missing columns: ${missing.join(",")}`);
    if (seen.has(row.fieldName)) issues.push(`duplicate fieldName: ${row.fieldName}`);
    seen.add(row.fieldName);
    if (row.required === true && row.allowBlank === false && row.blockLatestWhenBlank !== true) issues.push(`${row.fieldName}: required nonblank field must block latest`);
    if (row.required === true && !String(row.blankCountsKey || "").trim()) issues.push(`${row.fieldName}: blankCountsKey missing`);
    if (row.required === true && !String(row.sampleMissingRowsKey || "").includes("missing")) issues.push(`${row.fieldName}: sampleMissingRowsKey must include missing[]`);
    for (const key of ["payloadPath","scannerPayloadPath","writerPayloadPath","sourceTableOrView","businessPurpose","verifierRule"]) {
      if (!String(row[key] || "").trim()) issues.push(`${row.fieldName}: ${key} blank`);
    }
  });
  for (const field of ["underlyingCode","underlyingName","warrantCode","warrantName","finalScore","score","reason","actionLabel","signalGrade","stockRisk","callValue","putValue","callPutRatio","warrantHeatScore","stockSetupScore","branchPowerScore","branchStatus","volumeMultiple","thirtyMinuteVolume","floatingUnits","quoteSource","source_snapshot_captured_at","fallbackUsed"]) {
    if (!seen.has(field)) issues.push(`core business field missing from matrix: ${field}`);
  }
  if (issues.length) {
    console.error("[warrant-business-fields] FAIL");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log(`[warrant-business-fields] PASS fields=${matrix.length}`);
}

if (require.main === module) main();

module.exports = { matrix, REQUIRED_COLUMNS };
