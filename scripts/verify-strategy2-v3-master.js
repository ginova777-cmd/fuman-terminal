"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const FORMAL_ROOT = "C:/fuman-release-owner/fuman-terminal";
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const LIVE_RECEIPT = path.join(RUNTIME_ROOT, "data", "scan-receipts", "strategy2-v3-live.json");
const TRI_RECEIPT = path.join(RUNTIME_ROOT, "data", "scan-receipts", "strategy2-tri-surface-canonical-latest.json");
const CONTRACT = "strategy2-live-v3";
const MIN_FORMAL_WATER_COVERAGE_RATIO = 0.90;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function check(items, name, ok, detail = "") {
  items.push({ name, ok: Boolean(ok), detail });
}

function taskExists(name) {
  return spawnSync("schtasks", ["/Query", "/TN", name], { encoding: "utf8", windowsHide: true }).status === 0;
}

function runTriSurface(tradeDate) {
  const child = spawnSync(process.execPath, [path.join(FORMAL_ROOT, "scripts", "verify-strategy2-terminal-visible-readback.js"), `--trade-date=${tradeDate}`], {
    cwd: FORMAL_ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
  });
  return { exitCode: child.status, stdout: child.stdout || "", stderr: child.stderr || "" };
}

function main() {
  const receipt = readJson(LIVE_RECEIPT);
  const tradeDate = String(receipt?.tradeDate || receipt?.dataDate || "");
  const triRun = tradeDate ? runTriSurface(tradeDate) : { exitCode: 1, stdout: "", stderr: "trade_date_missing" };
  const tri = readJson(TRI_RECEIPT);
  const checks = [];
  const expected = Number(receipt?.expectedCount || 0);
  const scanned = Number(receipt?.scannedCount || 0);
  const resultCount = Number(receipt?.resultCount || 0);
  const dataGaps = Number(receipt?.dataGapCount || 0);
  const coverage = receipt?.sourceCoverage || {};
  const ready = Number(coverage.formalIntradayOneMinuteReadySymbols || 0);
  const requiredRatio = Number(coverage.requiredFormalWaterCoverageRatio || MIN_FORMAL_WATER_COVERAGE_RATIO);
  const actualRatio = Number(coverage.formalWaterCoverageRatio || (expected > 0 ? ready / expected : 0));
  const minimumReady = Math.ceil(expected * requiredRatio);
  const formalWaterCoverageOk = coverage.formalWaterCoverageOk === true && ready >= minimumReady && actualRatio >= requiredRatio;
  const formalComplete = receipt?.status === "complete" && receipt?.complete === true && receipt?.qualityStatus === "complete" && receipt?.formalDisplayAllowed === true && receipt?.publishAllowed === true && formalWaterCoverageOk;
  const blockedComplete = receipt?.status === "blocked" && receipt?.complete === false && receipt?.formalDisplayAllowed === false && receipt?.publishAllowed === false && receipt?.displayOnlyBlockedEvidence === true && Boolean(receipt?.blockedReason) && expected > 0 && scanned === expected;

  check(checks, "unique_runner_present", taskExists("Fuman Strategy2 Unified 0845-1230"));
  for (const retired of ["Fuman Strategy2 Unified 0845-1210", "Fuman Strategy2 V3 Water Gate 0845", "Fuman Strategy2 V2 Unattended", "Fuman Strategy2 V2 Recovery"]) {
    check(checks, `retired_task_absent:${retired}`, !taskExists(retired));
  }
  check(checks, "receipt_exists", Boolean(receipt), LIVE_RECEIPT);
  check(checks, "contract_is_v3", receipt?.strategyContract === CONTRACT, receipt?.strategyContract || "missing");
  check(checks, "canonical_run_id", /^strategy2-v3-live-\d{8}-(?:canonical|\d+)$/.test(String(receipt?.runId || "")), receipt?.runId || "missing");
  check(checks, "trade_date_present", /^\d{4}-\d{2}-\d{2}$/.test(tradeDate), tradeDate || "missing");
  check(checks, "full_scan_coverage", expected > 0 && scanned === expected, `${scanned}/${expected}`);
  check(checks, "formal_water_coverage_90pct_when_complete", !formalComplete || formalWaterCoverageOk, `${ready}/${expected} ratio=${actualRatio} required=${requiredRatio}`);
  check(checks, "result_count_nonnegative", resultCount >= 0, String(resultCount));
  check(checks, "legal_complete_or_blocked", formalComplete || blockedComplete, receipt?.blockedReason || receipt?.reason || "invalid_state");
  check(checks, "blocked_never_publishes", !blockedComplete || (receipt.publishAllowed === false && receipt.formalDisplayAllowed === false), receipt?.blockedReason || "");
  check(checks, "tri_surface_verifier_exit_zero", triRun.exitCode === 0, triRun.stderr.trim());
  check(checks, "tri_surface_receipt_pass", tri?.ok === true && Array.isArray(tri?.issues) && tri.issues.length === 0, (tri?.issues || []).join(","));
  check(checks, "tri_surface_same_run_id", tri?.expectedRunId === receipt?.runId, `${tri?.expectedRunId || ""}/${receipt?.runId || ""}`);

  const ok = checks.every((item) => item.ok);
  const report = {
    ok,
    verifier: "verify-strategy2-v3-master",
    contract: "strategy2-v3-readonly-master-verifier-v1",
    checkedAt: new Date().toISOString(),
    tradeDate,
    runId: receipt?.runId || "",
    closureType: formalComplete ? "formal_complete" : blockedComplete ? "blocked_evidence_readback" : "invalid",
    formalScanSucceeded: formalComplete,
    blockedEvidenceClosed: blockedComplete && tri?.ok === true,
    expectedCount: expected,
    scannedCount: scanned,
    resultCount,
    dataGapCount: dataGaps,
    formalWaterReadyCount: ready,
    formalWaterCoverageRatio: actualRatio,
    requiredFormalWaterCoverageRatio: requiredRatio,
    formalWaterCoverageOk,
    publishAllowed: receipt?.publishAllowed === true,
    firstBlocker: checks.find((item) => !item.ok)?.name || "",
    checks,
    readOnly: true,
    forbiddenActions: ["start_scan", "repair_candles", "create_run_id", "write_snapshot", "deploy", "cleanup"],
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = ok ? 0 : 1;
}

main();
