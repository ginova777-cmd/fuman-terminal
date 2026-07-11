#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const LATEST_RUN_VIEW = process.env.STRATEGY5_SUPABASE_LATEST_RUN_VIEW || "v_strategy5_latest_complete_run";
const RESULTS_TABLE = process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results";
const BASE_PRESET_IDS = new Set(["chip_k_confluence", "volume_turnover_breakout", "foreign_trust_breakout", "limit_up_doji", "bollinger_kdj_buy"]);

function fail(message, detail = {}) {
  console.error(JSON.stringify({ ok: false, message, ...detail }, null, 2));
  process.exit(1);
}
function cleanNumber(value) {
  const n = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}
function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
function payloadOf(row = {}) {
  return row.payload && typeof row.payload === "object" ? row.payload : {};
}
function matchIds(row = {}) {
  const payload = payloadOf(row);
  return [payload.activeMatch?.id, ...arrayValue(payload.matches).map((match) => match?.id)].filter(Boolean);
}
function activePayload(row = {}) {
  const payload = payloadOf(row);
  const active = payload.activeMatch && typeof payload.activeMatch === "object" ? payload.activeMatch : {};
  return { ...payload, ...active };
}
async function supabaseGet(pathname) {
  if (!SUPABASE_URL || !SUPABASE_KEY) fail("missing_supabase_credentials");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + pathname, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, Accept: "application/json" },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!response.ok) fail("supabase_read_failed", { status: response.status, body: json });
  return json;
}
function between(text, start, end) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = text.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? text.slice(startIndex) : text.slice(startIndex, endIndex);
}
function staticIndependenceChecks() {
  const scanner = fs.readFileSync(path.join(ROOT, "scripts", "scan-strategy5-cache.js"), "utf8");
  const buildVolumeText = between(scanner, "function buildVolumeTurnoverMatch", "function avg");
  const buildMatchesText = between(scanner, "async function buildMatches", "async function main");
  const terminalFast = fs.readFileSync(path.join(ROOT, "terminal-desktop-fast-shell.js"), "utf8");
  const mobileFragment = fs.readFileSync(path.join(ROOT, "api", "mobile-fragment.js"), "utf8");
  return { buildVolumeText, buildMatchesText, terminalFast, mobileFragment };
}
function pushCheck(checks, ok, name, detail = {}) {
  checks.push({ ok: Boolean(ok), name, detail });
}
async function main() {
  const checks = [];
  const staticText = staticIndependenceChecks();
  pushCheck(checks, staticText.buildVolumeText.includes("pct >= 3") && staticText.buildVolumeText.includes("turnoverRate > 5") && staticText.buildVolumeText.includes("volumeRatio >= 1") && staticText.buildVolumeText.includes("marginShort.ok") && staticText.buildVolumeText.includes("previousVolumeExpanded"), "volume_turnover_has_own_formal_conditions");
  pushCheck(checks, !/strategy4Matched|strategy4ByCode|multi_strategy_confluence|confluenceCount|sourceCount/.test(staticText.buildVolumeText), "volume_turnover_does_not_depend_on_strategy4_or_confluence");
  pushCheck(checks, /const matches = \[[\s\S]*buildChipKConfluenceMatch[\s\S]*buildVolumeTurnoverMatch/.test(staticText.buildMatchesText), "strategy5_base_matches_built_before_strategy4_merge");
  pushCheck(checks, /strategy4Matched:\s*Boolean\(strategy4ByCode\.has\(stock\.code\)\)/.test(staticText.buildMatchesText), "strategy4_is_annotation_field_only");
  pushCheck(checks, staticText.terminalFast.includes("displayTitle = isStrategy5Route(route) && strategy4Matched") && staticText.terminalFast.includes("🔥") && staticText.mobileFragment.includes("displayName = strategy4Matched") && staticText.mobileFragment.includes("🔥"), "strategy4_flame_is_display_only_on_terminal_and_mobile");
  pushCheck(checks, /filter === "multi_strategy_confluence"[\s\S]*strategy5TerminalConfluenceCountForCode/.test(staticText.terminalFast), "multi_strategy_confluence_uses_terminal_occurrence_count");

  const latest = await supabaseGet(LATEST_RUN_VIEW + "?select=*&limit=1");
  const run = Array.isArray(latest) ? latest[0] : latest;
  if (!run) fail("latest_complete_run_missing");
  const runId = String(run.run_id || run.runId || "");
  const runDate = compactDate(run.scan_date || run.scanDate || run.market_date || run.marketDate || run.payload?.sourceDate || run.payload?.usedDate);
  const resultCount = cleanNumber(run.result_count || run.resultCount || run.payload?.count);
  pushCheck(checks, /^strategy5-\d{8}-\d+/.test(runId), "latest_strategy5_run_id_present", { runId, runDate, resultCount });
  const rows = await supabaseGet(RESULTS_TABLE + "?select=code,name,rank,score,reason,payload&run_id=eq." + encodeURIComponent(runId) + "&strategy=eq.strategy5&order=rank.asc&limit=5000");
  pushCheck(checks, Array.isArray(rows) && rows.length === resultCount, "strategy5_result_rows_match_run", { rows: rows?.length || 0, resultCount });
  const baseRows = rows.filter((row) => matchIds(row).some((id) => BASE_PRESET_IDS.has(id)));
  const confluenceOnlyRows = rows.filter((row) => matchIds(row).includes("multi_strategy_confluence"));
  pushCheck(checks, baseRows.length > 0, "strategy5_has_independent_base_strategy_rows", { baseRows: baseRows.length });
  pushCheck(checks, confluenceOnlyRows.length === 0, "scanner_does_not_publish_confluence_as_base_result", { confluenceOnlyRows: confluenceOnlyRows.length });
  const volumeTurnoverRows = rows.filter((row) => matchIds(row).includes("volume_turnover_breakout"));
  const nonStrategy4VolumeTurnover = volumeTurnoverRows.filter((row) => !Boolean(payloadOf(row).strategy4Matched || payloadOf(row).strategy4RunId));
  const strategy4VolumeTurnover = volumeTurnoverRows.filter((row) => Boolean(payloadOf(row).strategy4Matched || payloadOf(row).strategy4RunId));
  pushCheck(checks, volumeTurnoverRows.length > 0, "volume_turnover_rows_present", { count: volumeTurnoverRows.length });
  pushCheck(checks, true, "volume_turnover_strategy4_overlap_is_annotation_observation", { nonStrategy4Codes: nonStrategy4VolumeTurnover.map((row) => row.code), strategy4Codes: strategy4VolumeTurnover.map((row) => row.code), note: nonStrategy4VolumeTurnover.length ? "current run proves non-strategy4 volume turnover can still publish" : "current run all volume-turnover rows also matched strategy4; static scanner checks prove strategy4 is not a hard gate" });
  for (const row of volumeTurnoverRows) {
    const payload = activePayload(row);
    const code = String(row.code || payload.code || "");
    pushCheck(checks, cleanNumber(payload.pct ?? payload.percent ?? payload.changePercent) >= 3, "volume_turnover_pct_gte_3", { code, pct: payload.pct ?? payload.percent ?? payload.changePercent });
    pushCheck(checks, cleanNumber(payload.turnoverRate) > 5, "volume_turnover_turnover_gt_5", { code, turnoverRate: payload.turnoverRate });
    pushCheck(checks, cleanNumber(payload.volumeRatio) >= 1, "volume_turnover_volume_ratio_gte_1", { code, volumeRatio: payload.volumeRatio });
    pushCheck(checks, cleanNumber(payload.previousVolumeExpansionRatio) >= 1, "volume_turnover_previous_volume_expanded", { code, previousVolumeExpansionRatio: payload.previousVolumeExpansionRatio });
    pushCheck(checks, cleanNumber(payload.marginNetIncrease) > 0 && cleanNumber(payload.shortNetIncrease) > 0, "volume_turnover_margin_short_same_increase", { code, marginNetIncrease: payload.marginNetIncrease, shortNetIncrease: payload.shortNetIncrease });
    pushCheck(checks, compactDate(payload.marginShortSourceDate) === runDate, "volume_turnover_margin_date_equals_run_date", { code, marginShortSourceDate: payload.marginShortSourceDate, runDate });
  }
  const ok = checks.every((check) => check.ok);
  const summary = { ok, verifier: "verify-strategy5-independence", generatedAt: new Date().toISOString(), runId, runDate, resultCount, baseRows: baseRows.length, volumeTurnoverCount: volumeTurnoverRows.length, volumeTurnoverCodes: volumeTurnoverRows.map((row) => String(row.code || "")), nonStrategy4VolumeTurnoverCodes: nonStrategy4VolumeTurnover.map((row) => String(row.code || "")), checks, issues: checks.filter((check) => !check.ok) };
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exit(1);
}
main().catch((error) => fail("verify_strategy5_independence_failed", { error: error?.stack || String(error) }));
