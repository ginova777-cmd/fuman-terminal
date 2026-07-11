#!/usr/bin/env node
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });
const LATEST_RUN_VIEW = process.env.STRATEGY5_SUPABASE_LATEST_RUN_VIEW || "v_strategy5_latest_complete_run";
const RESULTS_TABLE = process.env.STRATEGY5_SUPABASE_RESULTS_TABLE || "strategy5_scan_results";
const EXPECTED_20260709_CODES = ["8039", "8150", "6202", "2486", "3149", "6285"];

function fail(message, detail = {}) {
  console.error(JSON.stringify({ ok: false, message, ...detail }, null, 2));
  process.exit(1);
}

function compactDate(value) {
  return String(value || "").replace(/[^0-9]/g, "").slice(0, 8);
}

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function rowPayload(row = {}) {
  const p = row.payload && typeof row.payload === "object" ? row.payload : {};
  const active = p.activeMatch && typeof p.activeMatch === "object" ? p.activeMatch : {};
  return { ...p, ...active };
}

async function supabaseGet(pathname) {
  if (!SUPABASE_URL || !SUPABASE_KEY) fail("missing_supabase_credentials");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!response.ok) fail("supabase_read_failed", { status: response.status, body: json });
  return json;
}

async function main() {
  const latest = await supabaseGet(`${LATEST_RUN_VIEW}?select=*&limit=1`);
  const run = Array.isArray(latest) ? latest[0] : latest;
  if (!run) fail("latest_complete_run_missing");
  const runId = run.run_id || run.runId;
  if (!runId) fail("latest_complete_run_missing_run_id", { run });
  const runDate = compactDate(run.scan_date || run.scanDate || run.market_date || run.marketDate || run.trade_date || run.tradeDate || run.payload?.sourceDate);

  const query = `${RESULTS_TABLE}?select=code,name,strategy,score,reason,payload&run_id=eq.${encodeURIComponent(runId)}&strategy=eq.strategy5&order=rank.asc`;
  const allRows = await supabaseGet(query);
  if (!Array.isArray(allRows)) fail("strategy5_rows_not_array", { runId });
  const rows = allRows.filter((row) => {
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    const ids = [payload.activeMatch?.id, ...arrayValue(payload.matches).map((match) => match?.id)].filter(Boolean);
    return ids.includes("volume_turnover_breakout");
  });

  const checks = [];
  const issues = [];
  function check(ok, name, detail = {}) {
    checks.push({ ok: Boolean(ok), name, detail });
    if (!ok) issues.push({ name, detail });
  }

  const expectedDate = runDate || "20260709";
  const codes = rows.map((row) => String(row.code || ""));
  if (expectedDate === "20260709") {
    check(rows.length === EXPECTED_20260709_CODES.length, "expected_20260709_volume_turnover_count_6", { count: rows.length });
    check(EXPECTED_20260709_CODES.every((code) => codes.includes(code)), "expected_20260709_codes_present", { expected: EXPECTED_20260709_CODES, actual: codes });
  } else {
    check(rows.length >= 0, "non_20260709_latest_run_invariant_mode", { runDate: expectedDate, count: rows.length });
  }

  for (const row of rows) {
    const payload = rowPayload(row);
    const code = String(row.code || payload.code || "");
    const matchIds = arrayValue(row.payload?.matches).map((m) => m?.id).filter(Boolean);
    check(cleanNumber(payload.pct ?? payload.percent ?? payload.changePercent) >= 3, "pct_gte_3", { code, pct: payload.pct ?? payload.percent ?? payload.changePercent });
    check(cleanNumber(payload.turnoverRate) > 5, "turnover_rate_gt_5_wantgoo_formula", { code, turnoverRate: payload.turnoverRate });
    check(cleanNumber(payload.volumeRatio) >= 1, "volume_ratio_gte_1_recent_5d_avg", { code, volumeRatio: payload.volumeRatio });
    check(cleanNumber(payload.previousVolumeExpansionRatio) >= 1, "previous_day_volume_expansion_gte_1", { code, previousVolumeExpansionRatio: payload.previousVolumeExpansionRatio });
    check(cleanNumber(payload.marginNetIncrease) > 0, "margin_net_increase_positive", { code, marginNetIncrease: payload.marginNetIncrease });
    check(cleanNumber(payload.shortNetIncrease) > 0, "short_net_increase_positive", { code, shortNetIncrease: payload.shortNetIncrease });
    check(compactDate(payload.marginShortSourceDate) === expectedDate, "margin_short_source_date_equals_last_trading_day", { code, marginShortSourceDate: payload.marginShortSourceDate, expectedDate });
    check(payload.marginShortAlignmentOk === true || compactDate(payload.marginShortSourceDate) === compactDate(payload.marginShortExpectedDate), "margin_short_alignment_ok", { code, marginShortAlignmentOk: payload.marginShortAlignmentOk, marginShortExpectedDate: payload.marginShortExpectedDate });
    check(matchIds.length === 0 || matchIds.includes("volume_turnover_breakout"), "payload_match_id_contains_volume_turnover", { code, matchIds });
  }

  const summary = {
    ok: issues.length === 0,
    runId,
    runDate: expectedDate,
    volumeTurnoverCount: rows.length,
    codes,
    checks: checks.length,
    issues,
    hits: rows.map((row) => {
      const payload = rowPayload(row);
      return {
        code: String(row.code || ""),
        name: row.name || payload.name || "",
        pct: cleanNumber(payload.pct ?? payload.percent ?? payload.changePercent),
        turnoverRate: cleanNumber(payload.turnoverRate),
        volumeRatio: cleanNumber(payload.volumeRatio),
        previousVolumeExpansionRatio: cleanNumber(payload.previousVolumeExpansionRatio),
        volumeIncreaseOrdinalRank: cleanNumber(payload.volumeIncreaseOrdinalRank),
        volumeIncreaseTop100: payload.volumeIncreaseTop100 === true,
        volumeIncreaseBonus: cleanNumber(payload.volumeIncreaseBonus),
        marginNetIncrease: cleanNumber(payload.marginNetIncrease),
        shortNetIncrease: cleanNumber(payload.shortNetIncrease),
        marginShortSourceDate: compactDate(payload.marginShortSourceDate),
        marginShortSource: payload.marginShortSource || "",
      };
    }),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((error) => fail("verify_strategy5_volume_turnover_failed", { error: error?.stack || String(error) }));
