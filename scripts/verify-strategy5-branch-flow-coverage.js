#!/usr/bin/env node
"use strict";

const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const LATEST_RUN_VIEW = process.env.STRATEGY5_SUPABASE_LATEST_RUN_VIEW || "v_strategy5_latest_complete_run";
const RESULTS_TABLE = process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results";

function fail(message, detail = {}) {
  console.error(JSON.stringify({ ok: false, message, ...detail }, null, 2));
  process.exit(1);
}
function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}
function cleanNumber(value) {
  const n = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}
function payloadOf(row = {}) {
  return row.payload && typeof row.payload === "object" ? row.payload : {};
}
async function supabaseGet(pathname, { allowMissing = false } = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) fail("missing_supabase_credentials");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + pathname, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, Accept: "application/json" },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!response.ok && allowMissing && response.status === 404) return { ok: false, status: response.status, rows: [], body: json };
  if (!response.ok) return { ok: false, status: response.status, rows: [], body: json };
  return { ok: true, status: response.status, rows: json || [] };
}
function branchCovered(row, runDate) {
  const p = payloadOf(row);
  const branchDate = compactDate(p.branchTradeDate || p.branch_trade_date);
  const topBuy = cleanNumber(p.topBranchNetBuy || p.top_branch_net_buy);
  const topSell = cleanNumber(p.topBranchNetSell || p.top_branch_net_sell);
  const power = cleanNumber(p.branchPowerScore || p.branch_power_score);
  const source = String(p.branchSource || p.branch_source || "");
  return branchDate === runDate && Boolean(source) && (topBuy !== 0 || topSell !== 0 || power !== 0);
}
function bollingerBranchCandidateMatch(row) {
  const matches = arrayValue(payloadOf(row).matches);
  return matches.find((match) => match && match.id === "bollinger_kdj_buy" && (match.buyPoint1UpperRailOk === true || match.buyPoint2WideLowerRailMainBuyOk === true)) || null;
}
async function main() {
  const checks = [];
  const push = (ok, name, detail = {}) => checks.push({ ok: Boolean(ok), name, detail });

  const viewProbe = await supabaseGet("v_finmind_branch_flows_latest?select=symbol,trade_date,main_force_branch_net_buy,top_branch_net_buy,top_branch_net_sell,branch_power_score&limit=1", { allowMissing: true });
  const latest = await supabaseGet(LATEST_RUN_VIEW + "?select=*&limit=1");
  if (!latest.ok) fail("latest_strategy5_run_read_failed", { status: latest.status, body: latest.body });
  const run = Array.isArray(latest.rows) ? latest.rows[0] : null;
  if (!run) fail("latest_strategy5_run_missing");
  const runId = String(run.run_id || run.runId || "");
  const runDate = compactDate(run.scan_date || run.scanDate || run.market_date || run.marketDate || run.payload?.sourceDate || run.payload?.usedDate);
  const resultCount = cleanNumber(run.result_count || run.resultCount || run.payload?.count);

  const result = await supabaseGet(RESULTS_TABLE + "?select=code,name,rank,score,payload&run_id=eq." + encodeURIComponent(runId) + "&strategy=eq.strategy5&order=rank.asc&limit=5000");
  if (!result.ok) fail("strategy5_results_read_failed", { status: result.status, body: result.body });
  const rows = Array.isArray(result.rows) ? result.rows : [];

  const candidates = rows.map((row) => ({ row, match: bollingerBranchCandidateMatch(row) })).filter((item) => item.match);
  const covered = candidates.filter((item) => branchCovered(item.row, runDate));
  const missing = candidates.filter((item) => !branchCovered(item.row, runDate));
  const allBranchRows = rows.filter((row) => branchCovered(row, runDate));

  push(/^strategy5-\d{8}-\d+/.test(runId), "latest_strategy5_run_id_present", { runId, runDate, resultCount });
  push(rows.length === resultCount, "strategy5_rows_match_run_count", { rows: rows.length, resultCount });
  push(viewProbe.ok || viewProbe.status === 404 || viewProbe.status === 400, "branch_flow_view_probe_non_blocking", { viewOk: viewProbe.ok, status: viewProbe.status });
  push(true, "branch_flow_scope_is_bollinger_candidate_only", { candidateCount: candidates.length, fullRows: rows.length, allBranchCoveredRows: allBranchRows.length });
  push(candidates.every((item) => item.match.buyPoint1UpperRailOk === true || item.match.buyPoint2WideLowerRailMainBuyOk === true), "bollinger_branch_candidates_have_explicit_buy_point_flag", { candidateCount: candidates.length });
  push(missing.length === 0, "bollinger_branch_candidates_have_branch_flow_when_present", { missing: missing.map((item) => item.row.code) });

  const summary = {
    ok: checks.every((check) => check.ok),
    verifier: "verify-strategy5-branch-flow-coverage",
    generatedAt: new Date().toISOString(),
    runId,
    runDate,
    resultCount,
    branchFlowViewOk: viewProbe.ok,
    branchFlowViewStatus: viewProbe.status,
    fullRows: rows.length,
    fullRowsWithBranchFlow: allBranchRows.length,
    bollingerBranchCandidateCount: candidates.length,
    bollingerBranchCoveredCount: covered.length,
    bollingerBranchMissingCodes: missing.map((item) => String(item.row.code || "")),
    bollingerBranchCandidates: candidates.map((item) => {
      const p = payloadOf(item.row);
      return {
        code: String(item.row.code || ""),
        name: item.row.name || p.name || "",
        candidateType: item.match.buyPoint1UpperRailOk === true ? "buy_point_1_narrow_upper_rail" : "buy_point_2_wide_lower_rail_main_buy",
        buyPoint1UpperRailOk: item.match.buyPoint1UpperRailOk === true,
        buyPoint2WideLowerRailMainBuyOk: item.match.buyPoint2WideLowerRailMainBuyOk === true,
        kdGoldenCrossOk: item.match.kdGoldenCrossOk === true,
        flameOnBuyPoint: item.match.flameOnBuyPoint === true,
        upperSlopePct: cleanNumber(item.match.upperSlopePct),
        upperDistancePct: cleanNumber(item.match.upperDistancePct),
        wideBandLowerRailCandidate: item.match.wideBandLowerRailCandidate === true,
        wideBandMainBuyLowerRailOk: item.match.wideBandMainBuyLowerRailOk === true,
        mainForceBuyOk: item.match.mainForceBuyOk === true,
        branchTradeDate: compactDate(p.branchTradeDate || p.branch_trade_date),
        topBranchNetBuy: cleanNumber(p.topBranchNetBuy || p.top_branch_net_buy),
        topBranchNetSell: cleanNumber(p.topBranchNetSell || p.top_branch_net_sell),
        branchPowerScore: cleanNumber(p.branchPowerScore || p.branch_power_score),
        branchSource: p.branchSource || p.branch_source || "",
      };
    }),
    checks,
    issues: checks.filter((check) => !check.ok),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}
main().catch((error) => fail("verify_strategy5_branch_flow_coverage_failed", { error: error?.stack || String(error) }));

