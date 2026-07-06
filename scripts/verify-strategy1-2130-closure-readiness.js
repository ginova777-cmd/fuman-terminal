"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const TASK_NAME = "Fuman Open Buy Cache 2130";
const RECEIPT = path.join(RUNTIME_DIR, "data", "scan-receipts", "open-buy.json");
const STRICT = process.argv.includes("--strict") || process.env.FUMAN_STRATEGY1_2130_STRICT === "1";
const READINESS_ONLY = process.argv.includes("--readiness-only");
const EXPECT_RUN_ID = argValue("expect-run-id") || process.env.FUMAN_STRATEGY1_2130_EXPECT_RUN_ID || "";
const RUN_BAD_SOURCE_DRILL = process.argv.includes("--run-bad-source-drill");

function argValue(name) {
  const prefix = `--${name}=`;
  return (process.argv.find((arg) => arg.startsWith(prefix)) || "").slice(prefix.length);
}

function cleanNumber(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function runPowerShell(script) {
  const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 45000,
  });
  if (child.error || child.status !== 0) {
    throw new Error(`powershell_failed status=${child.status} ${child.stderr || child.stdout || child.error?.message || ""}`.trim());
  }
  return child.stdout.trim();
}

function taskInfo() {
  const ps = [
    "$ErrorActionPreference='Stop'",
    `$name='${TASK_NAME.replace(/'/g, "''")}'`,
    "$task=Get-ScheduledTask -TaskName $name",
    "$info=Get-ScheduledTaskInfo -TaskName $name",
    "[pscustomobject]@{ TaskName=$task.TaskName;",
    "State=[string]$task.State;",
    "Enabled=($task.Settings.Enabled -ne $false);",
    "LastRunTime=[string]$info.LastRunTime;",
    "LastTaskResult=[int]$info.LastTaskResult;",
    "NextRunTime=[string]$info.NextRunTime;",
    "Actions=($task.Actions|%{([string]$_.Execute)+' '+([string]$_.Arguments)+' wd='+([string]$_.WorkingDirectory)}) -join ' | ';",
    "Triggers=($task.Triggers|%{[string]$_.StartBoundary}) -join ' | ' }|ConvertTo-Json -Depth 6",
  ].join(";");
  return JSON.parse(runPowerShell(ps));
}

async function fetchJson(pathAndQuery) {
  const url = pathAndQuery.startsWith("http") ? pathAndQuery : `${BASE_URL}${pathAndQuery}`;
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { url, status: response.status, ok: response.ok, json, text };
}

function firstEndpoint(bundle, prefix) {
  const endpoints = bundle?.endpoints || bundle?.payload?.endpoints || {};
  return Object.entries(endpoints).find(([endpoint]) => endpoint.startsWith(prefix))?.[1] || null;
}

function runBadSourceDrill() {
  const child = spawnSync(process.execPath, ["--use-system-ca", "scripts/check-publish-source-gate.js", "--simulate-critical", "--dry-run-alert", "--strict"], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 240000,
  });
  const payload = readJson(path.join(RUNTIME_DIR, "state", "publish-source-gate.json")) || parseJson(child.stdout) || {};
  return {
    exitCode: child.status ?? 1,
    expectedExitCode: 3,
    ok: child.status === 3
      && payload.publishAllowed === false
      && payload.mustPreserveLatest === true
      && payload.writeBudget?.allowLatestWrite === false
      && payload.writeBudget?.allowCompleteRunWrite === false
      && payload.writeBudget?.preservePreviousCompleteRun === true,
    publishAllowed: payload.publishAllowed,
    mustPreserveLatest: payload.mustPreserveLatest,
    writeBudget: payload.writeBudget || null,
    alert: payload.alert || null,
  };
}

function parseJson(text) {
  try { return JSON.parse(text || "{}"); } catch {}
  const match = String(text || "").match(/\{[\s\S]*\}$/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function issueWhen(issues, condition, code, evidence) {
  if (condition) issues.push({ code, evidence });
}

async function main() {
  const issues = [];
  const warnings = [];
  const task = taskInfo();
  const receipt = readJson(RECEIPT);
  const api = await fetchJson(`/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=60&live=1&t=${Date.now()}`);
  const bundle = await fetchJson(`/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&t=${Date.now()}`);
  const mobile = await fetchJson(`/api/mobile-fragment?tab=strategy1&t=${Date.now()}`);
  const scorecard = await fetchJson(`/api/scorecard?t=${Date.now()}`);
  const page88 = await fetchJson(`/88?t=${Date.now()}`);
  const local88Text = fs.readFileSync(path.join(ROOT, "88.html"), "utf8");
  const openBuyFromBundle = firstEndpoint(bundle.json, "/api/open-buy-latest");
  const mobileRunId = String(mobile.text.match(/data-run-id="([^"]+)"/)?.[1] || "");
  const scorecardStrategy1 = (scorecard.json?.sourceReports || []).find((item) => item.key === "strategy1" || item.strategy === "strategy1") || null;
  const scorecardRows = Array.isArray(scorecard.json?.records) ? scorecard.json.records : [];
  const scorecardStrategy1Rows = scorecardRows.filter((row) => /策略1|Strategy1|open-buy/i.test(String(row.strategy || row.source || row.reason || "")));
  const page88HasRunIdDomContract = /data-run-id=/.test(local88Text) && /sourceReportForStrategy/.test(local88Text);
  const expectedRunId = EXPECT_RUN_ID || receipt?.runId || "";
  const apiQualityStatus = String(api.json?.qualityStatus || api.json?.status || "");
  const bundleQualityStatus = String(openBuyFromBundle?.qualityStatus || openBuyFromBundle?.status || "");
  const isCarryForward = /carry_forward|previous_2130/i.test(`${apiQualityStatus} ${bundleQualityStatus} ${api.json?.reason || ""} ${openBuyFromBundle?.reason || ""}`);
  const receiptRunId = String(receipt?.runId || "");

  issueWhen(issues, task.TaskName !== TASK_NAME, "strategy1_2130_task_missing", task);
  issueWhen(issues, task.Enabled !== true, "strategy1_2130_task_disabled", task);
  issueWhen(issues, !/run-open-buy\.ps1/i.test(String(task.Actions || "")), "strategy1_2130_task_action_not_run_open_buy", task.Actions);
  issueWhen(issues, !/21:30:00/.test(String(task.Triggers || "")), "strategy1_2130_task_trigger_not_2130", task.Triggers);

  issueWhen(issues, !fs.existsSync(path.join(ROOT, "run-open-buy.ps1")), "run_open_buy_missing", "run-open-buy.ps1");
  issueWhen(issues, !fs.existsSync(path.join(ROOT, "scripts", "scan-open-buy-cache.js")), "scan_open_buy_cache_missing", "scripts/scan-open-buy-cache.js");
  issueWhen(issues, !fs.existsSync(path.join(ROOT, "refresh-desktop-route-snapshot.ps1")), "desktop_snapshot_refresh_missing", "refresh-desktop-route-snapshot.ps1");

  if (receipt) {
    for (const key of ["runId", "startedAt", "finishedAt", "expectedTotal", "scannedCount", "resultCount", "readbackCount", "latestBeforeRunId", "latestAfterRunId", "latestPointerUpdated", "emptyResultWritten", "preservePreviousGood", "source_snapshot_captured_at", "source_status_at_run", "run_quality_at_publish"]) {
      if (!(key in receipt)) warnings.push({ code: `receipt_missing_${key}`, path: RECEIPT });
    }
  } else {
    warnings.push({ code: "receipt_not_found_yet", path: RECEIPT });
  }

  issueWhen(issues, api.status !== 200, "production_open_buy_api_not_200", { status: api.status, url: api.url });
  issueWhen(issues, !api.json?.runId, "production_open_buy_api_missing_runId", api.json);
  issueWhen(issues, bundle.status !== 200, "terminal_fast_bundle_not_200", { status: bundle.status, url: bundle.url });
  issueWhen(issues, !openBuyFromBundle?.runId, "terminal_fast_bundle_strategy1_missing_runId", openBuyFromBundle);
  issueWhen(issues, mobile.status !== 200, "mobile_fragment_not_200", { status: mobile.status, url: mobile.url });
  issueWhen(issues, !mobileRunId, "mobile_fragment_missing_data_run_id", mobile.text.slice(0, 240));
  issueWhen(issues, page88.status !== 200, "scorecard_88_not_200", { status: page88.status, url: page88.url });
  issueWhen(issues, !page88HasRunIdDomContract, "scorecard_88_row_runId_dom_contract_missing", {
    hasDataRunId: /data-run-id=/.test(page88.text),
    hasSourceReportMapping: /sourceReportForStrategy/.test(page88.text),
  });

  if (!scorecardStrategy1?.runId && !scorecardStrategy1Rows.some((row) => row.runId || row.sourceRunId || row.payload?.runId)) {
    warnings.push({
      code: "scorecard_88_strategy1_row_runId_not_exposed",
      evidence: "/88 reads /api/scorecard; current Strategy1 sourceReports/rows do not expose row-level runId",
    });
  }

  if (!READINESS_ONLY) {
    issueWhen(issues, isCarryForward, "strategy1_latest_is_previous_2130_carry_forward_not_new_scanner_run", {
      apiQualityStatus,
      bundleQualityStatus,
      apiRunId: api.json?.runId || "",
      bundleRunId: openBuyFromBundle?.runId || "",
    });
    issueWhen(issues, !receiptRunId, "scanner_receipt_missing_new_runId", {
      receiptPath: RECEIPT,
      receiptStartedAt: receipt?.startedAt || "",
      receiptFinishedAt: receipt?.finishedAt || "",
      receiptStatus: receipt?.status || "",
    });
    issueWhen(issues, receiptRunId && api.json?.runId && receiptRunId !== api.json.runId, "scanner_receipt_runId_not_in_production_api", {
      receiptRunId,
      apiRunId: api.json?.runId || "",
    });
    issueWhen(issues, receiptRunId && openBuyFromBundle?.runId && receiptRunId !== openBuyFromBundle.runId, "scanner_receipt_runId_not_in_terminal_fast_bundle", {
      receiptRunId,
      bundleRunId: openBuyFromBundle?.runId || "",
    });
    issueWhen(issues, receiptRunId && mobileRunId && receiptRunId !== mobileRunId, "scanner_receipt_runId_not_in_mobile_fragment", {
      receiptRunId,
      mobileRunId,
    });
    issueWhen(issues, receiptRunId && scorecardStrategy1?.runId && receiptRunId !== scorecardStrategy1.runId, "scanner_receipt_runId_not_in_scorecard_88", {
      receiptRunId,
      scorecardRunId: scorecardStrategy1.runId,
    });
  }

  if (STRICT) {
    issueWhen(issues, cleanNumber(task.LastTaskResult) !== 0, "strategy1_2130_last_result_not_zero", task);
    issueWhen(issues, !expectedRunId, "strict_expected_runId_missing", { receiptRunId: receipt?.runId || "" });
    issueWhen(issues, receipt?.runId !== expectedRunId, "receipt_runId_mismatch", { expectedRunId, receiptRunId: receipt?.runId || "" });
    issueWhen(issues, cleanNumber(receipt?.expectedTotal) <= 0, "receipt_expectedTotal_not_positive", receipt);
    issueWhen(issues, cleanNumber(receipt?.scannedCount) <= 0, "receipt_scannedCount_not_positive", receipt);
    issueWhen(issues, cleanNumber(receipt?.readbackCount) < cleanNumber(receipt?.resultCount), "receipt_readbackCount_less_than_resultCount", receipt);
    issueWhen(issues, receipt?.latestPointerUpdated !== true, "receipt_latestPointerUpdated_not_true", receipt);
    issueWhen(issues, api.json?.runId !== expectedRunId, "production_api_runId_mismatch", { expectedRunId, actual: api.json?.runId });
    issueWhen(issues, openBuyFromBundle?.runId !== expectedRunId, "terminal_fast_bundle_runId_mismatch", { expectedRunId, actual: openBuyFromBundle?.runId });
    issueWhen(issues, mobileRunId !== expectedRunId, "mobile_fragment_runId_mismatch", { expectedRunId, actual: mobileRunId });
    issueWhen(issues, scorecardStrategy1?.runId && scorecardStrategy1.runId !== expectedRunId, "scorecard_sourceReports_runId_mismatch", { expectedRunId, actual: scorecardStrategy1.runId });
  }

  const badSourceDrill = RUN_BAD_SOURCE_DRILL ? runBadSourceDrill() : null;
  if (RUN_BAD_SOURCE_DRILL && !badSourceDrill.ok) issues.push({ code: "bad_source_drill_failed", evidence: badSourceDrill });

  const closureLevel = issues.length === 0
    ? "scanner_new_run_terminal_closure"
    : isCarryForward
      ? "latest_good_run_carry_forward_only"
      : "not_closed";
  const output = {
    ok: issues.length === 0,
    mode: READINESS_ONLY ? "readiness-only" : STRICT ? "strict-2130-readback" : "new-run-closure",
    closureLevel,
    claimableUnattendedYes: issues.length === 0 && closureLevel === "scanner_new_run_terminal_closure",
    checkedAt: new Date().toISOString(),
    task,
    receipt: receipt ? {
      path: RECEIPT,
      runId: receipt.runId || "",
      startedAt: receipt.startedAt || "",
      finishedAt: receipt.finishedAt || "",
      status: receipt.status || "",
      exitCode: receipt.exitCode,
      expectedTotal: receipt.expectedTotal,
      scannedCount: receipt.scannedCount,
      resultCount: receipt.resultCount ?? receipt.matches,
      readbackCount: receipt.readbackCount,
      latestBeforeRunId: receipt.latestBeforeRunId,
      latestAfterRunId: receipt.latestAfterRunId,
      latestPointerUpdated: receipt.latestPointerUpdated,
      emptyResultWritten: receipt.emptyResultWritten,
      preservePreviousGood: receipt.preservePreviousGood,
      source_snapshot_captured_at: receipt.source_snapshot_captured_at,
      hasSourceStatusAtRun: Boolean(receipt.source_status_at_run),
      hasRunQualityAtPublish: Boolean(receipt.run_quality_at_publish),
    } : { path: RECEIPT, missing: true },
    readback: {
      productionApi: { status: api.status, runId: api.json?.runId || "", qualityStatus: api.json?.qualityStatus || api.json?.status || "", count: api.json?.count ?? null },
      terminalFastBundle: { status: bundle.status, runId: openBuyFromBundle?.runId || "", qualityStatus: openBuyFromBundle?.qualityStatus || openBuyFromBundle?.status || "", count: openBuyFromBundle?.count ?? openBuyFromBundle?.returnedCount ?? null },
      mobileFragment: { status: mobile.status, runId: mobileRunId, rows: (mobile.text.match(/mobile-terminal-row/g) || []).length },
      scorecard88: { status: page88.status, pageHasStrategy1: /策略1|Strategy1|open-buy/i.test(page88.text), localRowRunIdDomContract: page88HasRunIdDomContract, sourceReportRunId: scorecardStrategy1?.runId || "", strategy1Rows: scorecardStrategy1Rows.length },
    },
    badSourceDrill,
    warnings,
    issues,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message, checkedAt: new Date().toISOString() }, null, 2)}\n`);
  process.exit(1);
});
