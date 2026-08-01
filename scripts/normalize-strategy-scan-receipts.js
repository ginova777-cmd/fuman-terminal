"use strict";

const fs = require("fs");
const path = require("path");
const { MODULES, CONTRACT, normalizeStrategyScanReceipt, receiptContractIssues } = require("../lib/strategy-scan-receipt-contract");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const APPLY = process.argv.includes("--apply");
const SELF_TEST = process.argv.includes("--self-test");
const MANIFEST_FILE = path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function explicitPendingNotDue(manifest, key) {
  const row = Array.isArray(manifest?.modules) ? manifest.modules.find((item) => item?.key === key) : null;
  return Boolean(row?.pendingNotDue === true
    || row?.status === "PENDING_NOT_DUE"
    || row?.displayMode === "PENDING_NOT_DUE"
    || row?.scheduleStatus?.pendingNotDue === true);
}
function selfTest() {
  const cases = [
    { name: "complete_publish", input: { strategy: "x", status: "complete", complete: true, exitCode: 0, fallback: false, runId: "x-20260721-1", matches: 3 }, expect: { publishAllowed: true, unattendedStatus: "YES" } },
    { name: "complete_with_protected_readback_warning", input: { strategy: "x", status: "complete", complete: true, exitCode: 0, fallback: false, runId: "x-20260721-1", matches: 3, warnings: ["production API verification protected/failed: 401 Unauthorized", "inline terminal chain pending: verifier exit=1"] }, expect: { publishAllowed: true, preservePreviousGood: false, evidenceStatus: "complete", unattendedStatus: "YES" } },
    { name: "blocked_preserve", input: { strategy: "x", status: "blocked", complete: false, exitCode: 0, fallback: false, blockingReason: "source not_ready" }, expect: { publishAllowed: false, preservePreviousGood: true, unattendedStatus: "NO" } },
    { name: "fallback_blocks", input: { strategy: "x", status: "complete", complete: true, exitCode: 0, fallback: true, runId: "x-20260721-1" }, expect: { publishAllowed: false, preservePreviousGood: true, fallback: true } },
    { name: "complete_but_preserve_warning_blocks", input: { strategy: "x", status: "complete", complete: true, exitCode: 0, fallback: false, runId: "x-20260721-1", warnings: ["blockedReceipt=r.json"], blockingReason: "preserve previous good" }, expect: { publishAllowed: false, preservePreviousGood: true, evidenceStatus: "insufficient", unattendedStatus: "NO" } },
  ];
  const issues = [];
  for (const item of cases) {
    const normalized = normalizeStrategyScanReceipt(item.input, { key: item.input.strategy });
    for (const [key, value] of Object.entries(item.expect)) {
      if (normalized[key] !== value) issues.push(`${item.name}:${key}:${normalized[key]}!=${value}`);
    }
    for (const issue of receiptContractIssues(normalized)) issues.push(`${item.name}:${issue}`);
  }
  return { ok: issues.length === 0, contract: `${CONTRACT}-self-test`, issues };
}

function current() {
  const rows = [];
  const issues = [];
  const manifest = readJson(MANIFEST_FILE) || {};
  for (const mod of MODULES) {
    const file = path.join(RECEIPT_DIR, `${mod.receiptKey}.json`);
    const original = readJson(file);
    if (!original) {
      rows.push({ key: mod.key, receiptKey: mod.receiptKey, file, status: "missing", issues: ["receipt_missing"] });
      issues.push(`${mod.key}:receipt_missing`);
      continue;
    }
    const normalized = normalizeStrategyScanReceipt(original, { key: mod.key, strategy: mod.receiptKey });
    const pendingNotDue = explicitPendingNotDue(manifest, mod.key);
    const rowIssues = receiptContractIssues(normalized, { requireRunIdForAll: !pendingNotDue });
    rows.push({ key: mod.key, receiptKey: mod.receiptKey, file, changed: JSON.stringify(original) !== JSON.stringify(normalized), runId: normalized.runId || "", publishAllowed: normalized.publishAllowed, preservePreviousGood: normalized.preservePreviousGood, evidenceStatus: normalized.evidenceStatus, unattendedStatus: normalized.unattendedStatus, pendingNotDue, issues: rowIssues });
    if (APPLY && rowIssues.length === 0 && JSON.stringify(original) !== JSON.stringify(normalized)) writeJson(file, { ...normalized, normalizedAt: new Date().toISOString() });
    for (const issue of rowIssues) issues.push(`${mod.key}:${issue}`);
  }
  return { ok: issues.length === 0, contract: `${CONTRACT}-normalizer`, mode: APPLY ? "apply" : "dry-run", receiptDir: RECEIPT_DIR, rows, issues };
}

function main() {
  const payload = SELF_TEST ? selfTest() : current();
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main();

