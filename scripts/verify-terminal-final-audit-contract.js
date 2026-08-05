"use strict";

const fs = require("fs");
const path = require("path");
const { STAGES, readJson } = require("../lib/terminal-final-audit-contract");

const ROOT = path.resolve(__dirname, "..");
const AUDIT_ROOT = path.resolve(process.argv.find((arg) => arg.startsWith("--root="))?.slice("--root=".length) || "outputs/terminal-final-audit");
const REQUIRE_YES = process.argv.includes("--require-yes");

function issue(issues, code, details = {}) {
  issues.push({ code, ...details });
}

function main() {
  const issues = [];
  const file = path.join(AUDIT_ROOT, "terminal-unattended-final-audit.json");
  const audit = readJson(file, null);
  if (!audit) issue(issues, "final_audit_missing", { file });
  if (audit?.contract !== "terminal-unattended-final-audit-v1") issue(issues, "final_audit_contract_mismatch");
  if (!audit?.daily_run_id || !audit?.trade_date) issue(issues, "final_audit_identity_missing");
  const registry = readJson(audit?.registry?.file || "", null);
  if (!registry) issue(issues, "active_module_registry_missing", { file: audit?.registry?.file || "" });
  if (registry && (registry.daily_run_id !== audit.daily_run_id || registry.trade_date !== audit.trade_date)) issue(issues, "active_module_registry_identity_mismatch");
  const dailyRunIdPointer = audit?.trade_date ? path.join(AUDIT_ROOT, audit.trade_date, "daily-run-id.json") : "";
  const dailyRunIdRecord = readJson(dailyRunIdPointer, null);
  if (!dailyRunIdRecord) issue(issues, "daily_run_id_pointer_missing", { file: dailyRunIdPointer });
  if (dailyRunIdRecord && dailyRunIdRecord.daily_run_id !== audit.daily_run_id) issue(issues, "daily_run_id_pointer_mismatch");
  const seen = new Set((audit?.receipts || []).map((row) => row.stage));
  for (const stage of STAGES) {
    if (!seen.has(stage.key)) issue(issues, "receipt_missing_from_final_audit", { stage: stage.key });
    const row = (audit?.receipts || []).find((item) => item.stage === stage.key);
    if (!row?.file || !fs.existsSync(row.file)) {
      issue(issues, "receipt_file_missing", { stage: stage.key, file: row?.file || "" });
      continue;
    }
    const receipt = readJson(row.file, null);
    if (!receipt || receipt.receipt_present !== true) issue(issues, "receipt_contract_invalid", { stage: stage.key });
    if (receipt && (receipt.daily_run_id !== audit.daily_run_id || receipt.trade_date !== audit.trade_date)) issue(issues, "receipt_identity_mismatch", { stage: stage.key });
  }
  if (!audit?.manifest?.file || !fs.existsSync(audit.manifest.file)) issue(issues, "daily_manifest_missing");
  if (REQUIRE_YES && audit?.decision !== "YES") issue(issues, "final_audit_not_yes", { decision: audit?.decision || "missing" });
  const payload = {
    contract: "terminal-final-audit-contract-verifier-v1",
    checked_at: new Date().toISOString(),
    audit_file: file,
    audit_ok: audit?.ok === true,
    decision: audit?.decision || "NO",
    daily_run_id: audit?.daily_run_id || "",
    trade_date: audit?.trade_date || "",
    ok: issues.length === 0,
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main();
