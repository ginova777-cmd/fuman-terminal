"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MATRIX = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "warrant-ui-display-matrix.json"), "utf8"));
const BUSINESS = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "warrant-business-field-matrix.json"), "utf8"));

const REQUIRED_COLUMNS = ["surface","fieldName","payloadPath","purpose","required","allowBlank","blankAction","sourceDisclosure","degradedDisplay"];
const ALLOWED_ACTIONS = new Set(["block latest","preserve previous good","evidenceStatus=insufficient","unattendedStatus=NO","display degraded"]);

const issues = [];
if (!Array.isArray(MATRIX) || MATRIX.length === 0) issues.push("ui matrix empty");
const businessNames = new Set(BUSINESS.map((row) => row.fieldName));
MATRIX.forEach((row, index) => {
  for (const key of REQUIRED_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(row, key) || String(row[key] ?? "").trim() === "") issues.push("row " + index + " missing " + key);
  }
  if (row.required === true && row.allowBlank === false && !ALLOWED_ACTIONS.has(row.blankAction)) issues.push(row.fieldName + " invalid blankAction");
  if (row.required === true && !businessNames.has(row.fieldName) && !["evidenceStatus","unattendedStatus","fallbackUsed","blockedReason","scanner_block_reason"].includes(row.fieldName)) {
    issues.push(row.fieldName + " missing from business matrix");
  }
});
for (const field of ["underlyingCode","underlyingName","warrantCode","warrantName","finalScore","reason","evidenceStatus","unattendedStatus","fallbackUsed"]) {
  if (!MATRIX.some((row) => row.fieldName === field)) issues.push("core ui field missing: " + field);
}
if (issues.length) {
  console.error("[warrant-ui-display] FAIL");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}
console.log("[warrant-ui-display] PASS fields=" + MATRIX.length);
