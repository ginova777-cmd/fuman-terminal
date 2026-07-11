#!/usr/bin/env node
"use strict";

const { readSnapshot } = require("../lib/supabase-snapshots");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

function cleanNumber(value) {
  const n = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function isMembershipProtected(payload, status) {
  return status === 401 && payload?.protected === true && payload?.error === "membership_required";
}

async function fetchText(pathname, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL(pathname, BASE_URL);
  url.searchParams.set("t", String(Date.now()));
  try {
    const response = await fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache" }, signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, url: url.toString(), text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(pathname, timeoutMs = 45000) {
  const result = await fetchText(pathname, timeoutMs);
  let json = null;
  try { json = result.text ? JSON.parse(result.text) : null; } catch (error) { json = { ok: false, error: "json_parse_failed", reason: error.message }; }
  return { ...result, json };
}

async function supabaseGet(pathname) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, status: 0, rows: [], error: "missing_supabase_credentials" };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: "application/json" },
  });
  const text = await response.text();
  let rows = [];
  try { rows = text ? JSON.parse(text) : []; } catch { rows = []; }
  return { ok: response.ok, status: response.status, rows, text };
}

function pushCheck(checks, ok, name, detail = {}) {
  checks.push({ ok: Boolean(ok), name, detail });
}

async function main() {
  const checks = [];

  const latestRunResult = await supabaseGet("v_strategy5_latest_complete_run?select=*&limit=1");
  const latestRun = Array.isArray(latestRunResult.rows) ? latestRunResult.rows[0] : null;
  const runPayload = latestRun?.payload && typeof latestRun.payload === "object" ? latestRun.payload : {};
  const runId = String(latestRun?.run_id || runPayload.runId || "");
  const runDate = compactDate(latestRun?.scan_date || runPayload.sourceDate || runPayload.usedDate);
  const resultCount = cleanNumber(latestRun?.result_count || runPayload.resultCount || runPayload.count);

  pushCheck(checks, latestRunResult.ok && /^strategy5-\d{8}-\d+/.test(runId), "supabase_latest_complete_run_present", { status: latestRunResult.status, runId, runDate, resultCount });
  pushCheck(checks, resultCount > 0, "scanner_result_count_gt_0", { resultCount });
  pushCheck(checks, latestRun?.status === "complete" || latestRun?.complete === true, "scanner_run_complete", { status: latestRun?.status, complete: latestRun?.complete });

  const resultRows = await supabaseGet(`strategy5_scan_results?select=code,payload&run_id=eq.${encodeURIComponent(runId)}&strategy=eq.strategy5&limit=5000`);
  pushCheck(checks, resultRows.ok, "strategy5_scan_results_read_ok", { status: resultRows.status });
  pushCheck(checks, Array.isArray(resultRows.rows) && resultRows.rows.length === resultCount, "strategy5_scan_results_count_matches_run", { rows: resultRows.rows.length, resultCount });

  const snapshot = await readSnapshot("scorecard_latest", { allowLatestFallback: true, timeoutMs: 30000 });
  const snapshotPayload = snapshot?.payload || {};
  const sourceReports = Array.isArray(snapshotPayload.sourceReports) ? snapshotPayload.sourceReports : [];
  const strategy5Report = sourceReports.find((row) => row?.key === "strategy5" || /策略5/.test(String(row?.strategy || ""))) || null;
  pushCheck(checks, Boolean(snapshotPayload.records), "scorecard_snapshot_present", { tradeDate: snapshot?.tradeDate, latestDate: snapshotPayload.latestDate, rows: snapshotPayload.records?.length || 0 });
  pushCheck(checks, String(strategy5Report?.runId || "") === runId, "scorecard_source_report_strategy5_run_matches", { expected: runId, actual: strategy5Report?.runId || "", strategy5Report });
  pushCheck(checks, strategy5Report?.ok === true && cleanNumber(strategy5Report?.count) === resultCount, "scorecard_source_report_strategy5_count_matches", { count: strategy5Report?.count, resultCount });

  const health = await fetchJson("/api/scorecard-health", 45000);
  pushCheck(checks, health.status === 200 && health.json?.ok === true, "production_scorecard_health_ok", { status: health.status, issues: health.json?.issues || [] });
  pushCheck(checks, health.json?.stages?.apiScorecard?.protectedByMembership === true, "production_health_marks_scorecard_protected_ok", { apiScorecard: health.json?.stages?.apiScorecard });

  const scorecard = await fetchJson("/api/scorecard?live=1", 30000);
  const sourceReportsApi = await fetchJson("/api/source-reports?live=1", 30000);
  pushCheck(checks, isMembershipProtected(scorecard.json, scorecard.status), "production_scorecard_api_protected", { status: scorecard.status, reason: scorecard.json?.reason });
  pushCheck(checks, isMembershipProtected(sourceReportsApi.json, sourceReportsApi.status), "production_source_reports_api_protected", { status: sourceReportsApi.status, reason: sourceReportsApi.json?.reason });

  const bundle = await fetchJson("/api/terminal-fast-bundle?live=1", 45000);
  pushCheck(checks, bundle.status === 200 && bundle.json?.ok === true, "terminal_fast_bundle_http_ok", { status: bundle.status, membershipRequired: bundle.json?.membershipRequired, partial: bundle.json?.partial });
  pushCheck(checks, bundle.json?.membershipRequired === true || bundle.json?.protected === true || bundle.json?.partial === true, "terminal_fast_bundle_protected_redacted", { membershipRequired: bundle.json?.membershipRequired, protected: bundle.json?.protected, partial: bundle.json?.partial });

  const mobileFragment = await fetchText("/api/mobile-fragment?tab=strategy5", 30000);
  pushCheck(checks, mobileFragment.status === 200 || mobileFragment.status === 401, "mobile_fragment_strategy5_http_expected", { status: mobileFragment.status });
  pushCheck(checks, /data-membership-required="1"|membership_required|策略5|strategy5/i.test(mobileFragment.text || ""), "mobile_fragment_strategy5_present_or_locked", { status: mobileFragment.status });

  const page88 = await fetchText("/88.html", 30000);
  const mobilePage = await fetchText("/mobile.html", 30000);
  const desktop = await fetchText("/", 30000);
  pushCheck(checks, page88.status === 200 && /策略5|strategy5/i.test(page88.text || ""), "page88_strategy5_shell_ok", { status: page88.status });
  pushCheck(checks, mobilePage.status === 200 && /策略5|strategy5/i.test(mobilePage.text || ""), "mobile_page_strategy5_shell_ok", { status: mobilePage.status });
  pushCheck(checks, desktop.status === 200 && /策略5|strategy5/i.test(desktop.text || ""), "desktop_page_strategy5_shell_ok", { status: desktop.status });

  const ok = checks.every((check) => check.ok);
  const summary = {
    ok,
    verifier: "verify-strategy5-protected-e2e-closure",
    generatedAt: new Date().toISOString(),
    runId,
    runDate,
    resultCount,
    sourceReport: strategy5Report,
    checks,
    issues: checks.filter((check) => !check.ok).map((check) => check.name),
    surfaces: {
      scorecardHealth: { status: health.status, ok: health.json?.ok === true },
      scorecardApi: { status: scorecard.status, protected: isMembershipProtected(scorecard.json, scorecard.status) },
      sourceReportsApi: { status: sourceReportsApi.status, protected: isMembershipProtected(sourceReportsApi.json, sourceReportsApi.status) },
      terminalFastBundle: { status: bundle.status, membershipRequired: bundle.json?.membershipRequired, partial: bundle.json?.partial },
      mobileFragment: { status: mobileFragment.status },
      page88: { status: page88.status },
      mobilePage: { status: mobilePage.status },
      desktop: { status: desktop.status },
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.stack || String(error) }, null, 2));
  process.exit(1);
});
