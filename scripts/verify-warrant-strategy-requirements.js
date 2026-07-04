"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REQUIREMENTS_FILE = path.join(ROOT, "fixtures", "warrant-strategy-requirements.json");
const BUSINESS_FIELDS_FILE = path.join(ROOT, "fixtures", "warrant-business-fields.json");
const ALLOWED_ACTIONS = new Set([
  "block scan",
  "block publish",
  "preserve previous good",
  "write blocked receipt",
  "display degraded",
  "fail closed",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function nonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0 && value.every(nonEmpty);
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim().length > 0;
}

function requireNonEmpty(issues, pathName, value) {
  if (!nonEmpty(value)) issues.push(`${pathName} blank`);
}

function main() {
  const issues = [];
  const req = readJson(REQUIREMENTS_FILE);
  const businessFields = readJson(BUSINESS_FIELDS_FILE);

  for (const key of ["strategyName", "strategyKey", "purpose", "publishDefinition"]) {
    requireNonEmpty(issues, key, req[key]);
  }
  for (const key of ["pattern", "scanAllowedWhen", "scanBlockedWhen", "publishAllowedWhen", "preservePreviousGoodWhen"]) {
    requireNonEmpty(issues, `whatItFinds.${key}`, req.whatItFinds?.[key]);
  }

  for (const section of ["conditions", "sources", "decisionGates", "fallbackRules"]) {
    if (!Array.isArray(req[section]) || req[section].length === 0) issues.push(`${section} missing`);
  }

  (req.conditions || []).forEach((row, index) => {
    for (const key of ["id", "name", "purpose", "fields", "source", "pass", "fail", "action"]) {
      requireNonEmpty(issues, `conditions[${index}].${key}`, row[key]);
    }
    if (!ALLOWED_ACTIONS.has(row.action)) issues.push(`conditions[${index}].action invalid: ${row.action}`);
  });

  (req.sources || []).forEach((row, index) => {
    for (const key of ["name", "tableOrApi", "purpose", "required", "minimum", "staleLimit", "missingAction"]) {
      requireNonEmpty(issues, `sources[${index}].${key}`, row[key]);
    }
    if (!ALLOWED_ACTIONS.has(row.missingAction)) issues.push(`sources[${index}].missingAction invalid: ${row.missingAction}`);
  });

  const requiredGates = new Set(["scan gate", "source gate", "publish gate", "readback gate", "fallback gate", "UI display gate", "alert gate"]);
  (req.decisionGates || []).forEach((row, index) => {
    for (const key of ["name", "payloadPath", "pass", "block", "fallbackAllowed", "action"]) {
      requireNonEmpty(issues, `decisionGates[${index}].${key}`, row[key]);
    }
    if (!ALLOWED_ACTIONS.has(row.action)) issues.push(`decisionGates[${index}].action invalid: ${row.action}`);
    requiredGates.delete(row.name);
  });
  for (const gate of requiredGates) issues.push(`decision gate missing: ${gate}`);

  (req.fallbackRules || []).forEach((row, index) => {
    for (const key of ["name", "fallbackScope", "purpose", "action"]) {
      requireNonEmpty(issues, `fallbackRules[${index}].${key}`, row[key]);
    }
    if (row.publish !== false) issues.push(`fallbackRules[${index}].publish must be false`);
    if (row.disclose !== true) issues.push(`fallbackRules[${index}].disclose must be true`);
    if (!ALLOWED_ACTIONS.has(row.action)) issues.push(`fallbackRules[${index}].action invalid: ${row.action}`);
  });

  const empty = req.emptyResultRules || {};
  if (empty.sourceReadyCompleteScanAllowed !== true) issues.push("emptyResultRules.sourceReadyCompleteScanAllowed must be true");
  if (empty.sourceNotReadyAllowed !== false) issues.push("emptyResultRules.sourceNotReadyAllowed must be false");
  if (empty.mayOverwriteLatest !== false) issues.push("emptyResultRules.mayOverwriteLatest must be false");
  if (empty.requiresBlockedReceiptWhenSourceNotReady !== true) issues.push("emptyResultRules.requiresBlockedReceiptWhenSourceNotReady must be true");
  if (empty.preservePreviousGood !== true) issues.push("emptyResultRules.preservePreviousGood must be true");

  const live = req.liveReadiness || {};
  if (live.defaultDoesNotHitSupabase !== true) issues.push("liveReadiness.defaultDoesNotHitSupabase must be true");
  if (!String(live.actualSourceReadCommand || "").includes("verify:warrant-prewater-source-live")) issues.push("liveReadiness actual source command missing");
  if (live.requiresExplicitLiveFlag !== true) issues.push("liveReadiness.requiresExplicitLiveFlag must be true");
  if (live.requiresReadOnlyAckEnv !== "FUMAN_ALLOW_SUPABASE_READ=1") issues.push("liveReadiness read-only ack env missing");
  for (const table of ["v_scanner_resource_health", "v_warrant_latest_complete_run_health", "v_warrant_flow_latest_complete_run", "warrant_flow_scan_results"]) {
    if (!Array.isArray(live.tablesRead) || !live.tablesRead.includes(table)) issues.push(`liveReadiness table missing: ${table}`);
  }

  const names = new Set(businessFields.map((row) => row.fieldName));
  for (const field of ["underlyingCode", "warrantCode", "finalScore", "reason", "source_snapshot_captured_at", "fallbackUsed"]) {
    if (!names.has(field)) issues.push(`business matrix missing core field: ${field}`);
  }

  if (issues.length) {
    console.error("[warrant-strategy-requirements] FAIL");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log(`[warrant-strategy-requirements] PASS conditions=${req.conditions.length} sources=${req.sources.length} gates=${req.decisionGates.length} fallbacks=${req.fallbackRules.length}`);
}

main();
