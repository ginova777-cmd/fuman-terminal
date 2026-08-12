"use strict";

// Verifies the formal post-scan contract after a Strategy4 LINE push.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const LINE_DIR = path.join(RUNTIME_DIR, "data", "line-cards");

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}
function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function parseOption(name) {
  const argument = process.argv.find((value) => value.startsWith(`--${name}=`));
  return argument ? argument.slice(name.length + 3) : "";
}
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }

function main() {
  const expectedDate = compactDate(parseOption("date")) || taipeiDateKey();
  const expectedRunId = parseOption("expect-run-id");
  const expectedCount = number(parseOption("expect-count"));
  const issues = [];

  // Source-first gate: Fugle root, full scan, daily OHLCV coverage,
  // API/Supabase/desktop/mobile/88 alignment, and a fresh LINE dry-run.
  const verifierScripts = [
    "scripts/verify-strategy4-source-root.js",
    "scripts/verify-strategy4-match-yield-diagnostics.js",
    "scripts/verify-strategy4-canonical-closure.js",
    "scripts/verify-strategy4-88-data-chain.js",
    "scripts/verify-terminal-daily-ohlcv.js",
  ];
  for (const script of verifierScripts) {
    try {
      execFileSync(process.execPath, ["--use-system-ca", script], {
        cwd: ROOT,
        stdio: "pipe",
        encoding: "utf8",
        windowsHide: true,
        timeout: 180000,
      });
    } catch (error) {
      const detail = String(error?.stdout || error?.stderr || error?.message || "").trim().slice(-1200);
      issues.push(`source_or_closure_verifier_failed:${script}:${detail || "no_detail"}`);
    }
  }
  const closureFile = path.join(RECEIPT_DIR, `strategy4-canonical-closure-${expectedDate}.json`);
  const scanFile = path.join(RECEIPT_DIR, "strategy4.json");
  const lineFile = path.join(LINE_DIR, `strategy4-line-card-${expectedDate}.json`);
  let closure = {};
  let scan = {};
  let line = {};
  for (const [label, file, assign] of [["closure", closureFile, (value) => { closure = value; }], ["scan", scanFile, (value) => { scan = value; }], ["formal_line", lineFile, (value) => { line = value; }]]) {
    try { assign(readJson(file)); } catch { issues.push(`${label}_receipt_missing:${file}`); }
  }

  const runId = String(closure.runId || "");
  const count = number(closure.count);
  if (closure.ok !== true) issues.push("canonical_closure_not_ok");
  if (!runId.includes(`strategy4-${expectedDate}-`)) issues.push(`canonical_run_date_mismatch:${runId || "missing"}`);
  if (count <= 0) issues.push(`canonical_result_count_invalid:${count}`);
  if (expectedRunId && runId !== expectedRunId) issues.push(`expected_run_id_mismatch:${runId || "missing"}:${expectedRunId}`);
  if (expectedCount > 0 && count !== expectedCount) issues.push(`expected_count_mismatch:${count}:${expectedCount}`);

  if (scan.complete !== true || String(scan.status || "") !== "complete") issues.push(`scan_receipt_not_complete:${scan.status || "missing"}`);
  if (String(scan.runId || "") !== runId) issues.push(`scan_receipt_run_id_mismatch:${scan.runId || "missing"}:${runId || "missing"}`);
  if (number(closure.expectedTotal) <= 1500 || number(closure.scannedCount) !== number(closure.expectedTotal)) issues.push(`scan_not_full_universe:${closure.scannedCount || 0}/${closure.expectedTotal || 0}`);
  if (number(scan.matches) !== count) issues.push(`scan_match_count_mismatch:${scan.matches || 0}:${count}`);

  if (line.ok !== true || line.dry_run === true || line.line_push_ok !== true) issues.push(`formal_line_not_delivered:ok=${line.ok}:dry=${line.dry_run}:push=${line.line_push_ok}`);
  if (compactDate(line.dataDate) !== expectedDate) issues.push(`formal_line_date_mismatch:${line.dataDate || "missing"}:${expectedDate}`);
  if (String(line.runId || "") !== runId) issues.push(`formal_line_run_id_mismatch:${line.runId || "missing"}:${runId || "missing"}`);
  if (number(line.count) !== count) issues.push(`formal_line_count_mismatch:${line.count || 0}:${count}`);
  if (!Array.isArray(line.accepted_rows) || line.accepted_rows.length !== count) issues.push(`formal_line_rows_mismatch:${Array.isArray(line.accepted_rows) ? line.accepted_rows.length : 0}:${count}`);

  const payload = {
    ok: issues.length === 0,
    verifier: "verify-strategy4-daily-publish",
    checkedAt: new Date().toISOString(),
    expectedDate,
    runId,
    count,
    source: "fugle_snapshot",
    scan: { runId: scan.runId || "", scanned: number(closure.scannedCount), total: number(closure.expectedTotal), matches: number(scan.matches), complete: scan.complete === true },
    formalLine: { runId: line.runId || "", count: number(line.count), dataDate: line.dataDate || "", line_push_ok: line.line_push_ok === true, dry_run: line.dry_run === true },
    files: { closureFile, scanFile, lineFile },
    issues,
  };
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECEIPT_DIR, `strategy4-daily-publish-${expectedDate}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}

main();


