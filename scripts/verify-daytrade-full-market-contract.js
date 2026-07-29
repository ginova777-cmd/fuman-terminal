"use strict";

const fs = require("fs");

const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const MIN_FULL_MARKET_SYMBOLS = 1000;

function readSecret(name) {
  try { return fs.readFileSync(`${RUNTIME_DIR}\\secrets\\${name}`, "utf8").trim(); } catch { return ""; }
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function get(key, resource, query) {
  const base = PROJECT_URL.endsWith("/") ? PROJECT_URL.slice(0, -1) : PROJECT_URL;
  const response = await fetch(`${base}/rest/v1/${resource}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${resource} HTTP ${response.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : []; } catch { return []; }
}

async function main() {
  const key = process.env.SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt");
  if (!key) throw new Error("missing Supabase anon key");
  const rows = await get(key, "source_status", "select=source_name,status,updated_at,payload&source_name=eq.fugle_daytrade_source&limit=1");
  const row = Array.isArray(rows) ? rows[0] || {} : {};
  const payload = row.payload || {};
  const evidence = payload.full_market_intraday_signal_evidence || {};
  const rules = evidence.rules || {};
  const issues = [];
  if (evidence.universe !== "full_market_active_common_stock") issues.push("universe_not_full_market_active_common_stock");
  if (numberValue(evidence.activeSymbols) < MIN_FULL_MARKET_SYMBOLS) issues.push("full_market_active_symbols_below_1000");
  if (!Object.prototype.hasOwnProperty.call(evidence, "freshQuoteCoverage120s")) issues.push("missing_fresh_quote_coverage_120s");
  if (!Object.prototype.hasOwnProperty.call(evidence, "freshIntraday1mCoverage")) issues.push("missing_fresh_intraday_1m_coverage");
  if (!String(rules.bullishGainVolume || "").includes("change_percent>2")) issues.push("missing_gain_above_2_rule");
  if (!String(rules.bullishGainVolume || "").includes("ma5>ma10>ma35")) issues.push("missing_ma5_ma10_ma35_rule");
  if (!String(rules.bullishGainVolume || "").includes("volume_expanding")) issues.push("missing_bullish_volume_expanding_rule");
  if (!String(rules.volumeSurgeTop100 || "").includes("total_volume/avg_volume5>=2")) issues.push("missing_volume_2x_avg5_rule");
  if (!String(rules.volumeSurgeTop100 || "").includes("volume_rank<=100")) issues.push("missing_volume_top100_rule");
  if (rules.formalEntryScope !== "priority_top40") issues.push("formal_scope_not_priority_top40");
  if (rules.rotationScope !== "mother_pool_300_600") issues.push("rotation_scope_not_mother_pool_300_600");
  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    sourceStatus: row.status || "",
    sourceUpdatedAt: row.updated_at || "",
    evidence: {
      universe: evidence.universe || "",
      activeSymbols: numberValue(evidence.activeSymbols),
      freshQuoteSymbols: numberValue(evidence.freshQuoteSymbols),
      freshQuoteCoverage120s: numberValue(evidence.freshQuoteCoverage120s, null),
      freshIntraday1mSymbols: numberValue(evidence.freshIntraday1mSymbols, null),
      freshIntraday1mCoverage: numberValue(evidence.freshIntraday1mCoverage, null),
      bullishGainVolumeCandidateCount: numberValue(evidence.bullishGainVolumeCandidateCount),
      volumeSurgeTop100CandidateCount: numberValue(evidence.volumeSurgeTop100CandidateCount),
      rules,
    },
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[daytrade-full-market-contract] ${error.message}`);
  process.exitCode = 2;
});
