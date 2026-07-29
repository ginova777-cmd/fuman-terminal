"use strict";

const fs = require("fs");
const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const REQUIRE_FRESH = process.argv.includes("--require-fresh");

function readSecret(name) {
  for (const file of [`${RUNTIME_DIR}\\secrets\\${name}`, `${__dirname}\\..\\secrets\\${name}`]) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function restGet(key, resource, query) {
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
  const [mother, priority, formal, health] = await Promise.all([
    restGet(key, "v_fugle_daytrade_mother_pool", "select=symbol,mother_rank,quote_age_seconds,mother_readiness_status&order=mother_rank.asc&limit=350"),
    restGet(key, "v_fugle_daytrade_priority_top40", "select=symbol,mother_pool_rank,quote_age_seconds&order=mother_pool_rank.asc&limit=50"),
    restGet(key, "v_fugle_daytrade_formal_priority_top40", "select=symbol,mother_rank,quote_age_seconds&order=mother_rank.asc&limit=50"),
    restGet(key, "v_fugle_daytrade_mother_pool_contract_health", "select=*&limit=1"),
  ]);
  const h = Array.isArray(health) ? health[0] || {} : {};
  const issues = [];
  if (!Array.isArray(mother) || mother.length < 300) issues.push(`mother_pool_rows_${Array.isArray(mother) ? mother.length : 0}_below_300`);
  if (Array.isArray(mother) && mother.length > 600) issues.push(`mother_pool_rows_${mother.length}_above_600`);
  if (!Array.isArray(priority) || priority.length !== 40) issues.push(`priority_top40_rows_${Array.isArray(priority) ? priority.length : 0}_must_equal_40`);
  if (!Array.isArray(formal) || formal.length !== 40) issues.push(`formal_priority_rows_${Array.isArray(formal) ? formal.length : 0}_must_equal_40`);
  const maxPriorityRank = Math.max(0, ...(priority || []).map((row) => numberValue(row.mother_pool_rank)));
  const maxFormalRank = Math.max(0, ...(formal || []).map((row) => numberValue(row.mother_rank)));
  if (maxPriorityRank > 40) issues.push(`priority_top40_max_rank_${maxPriorityRank}_above_40`);
  if (maxFormalRank > 40) issues.push(`formal_priority_max_rank_${maxFormalRank}_above_40`);
  if (String(h.mother_pool_source || "") !== "dynamic_daytrade_mother_pool") issues.push("mother_pool_source_not_dynamic");
  if (numberValue(h.formal_priority_limit, 40) !== 40) issues.push("formal_priority_limit_not_40");
  if (numberValue(h.formal_priority_symbols) !== 40) issues.push("health_formal_priority_symbols_not_40");
  if (REQUIRE_FRESH) {
    if (numberValue(h.mother_fresh_quote_coverage_120s) < 0.8) issues.push("mother_fresh_quote_coverage_below_080");
    if (numberValue(h.formal_fresh_quote_coverage_120s) < 0.95) issues.push("formal_priority_fresh_quote_coverage_below_095");
    if (numberValue(h.formal_max_quote_age_seconds, 999999) > 120) issues.push("formal_priority_quote_age_above_120");
  }
  const result = {
    ok: issues.length === 0,
    mode: REQUIRE_FRESH ? "formal_fresh" : "structure_only",
    checkedAt: new Date().toISOString(),
    rows: { motherPool: mother.length, priorityTop40: priority.length, formalPriorityTop40: formal.length },
    ranks: { priorityTop40MaxRank: maxPriorityRank, formalPriorityMaxRank: maxFormalRank },
    health: {
      contractStatus: h.contract_status || "",
      contractReason: h.contract_reason || "",
      motherPoolSymbols: numberValue(h.mother_pool_symbols),
      formalPrioritySymbols: numberValue(h.formal_priority_symbols),
      formalPriorityLimit: numberValue(h.formal_priority_limit, 40),
      motherFreshQuoteCoverage120s: numberValue(h.mother_fresh_quote_coverage_120s),
      formalFreshQuoteCoverage120s: numberValue(h.formal_fresh_quote_coverage_120s),
      formalMaxQuoteAgeSeconds: numberValue(h.formal_max_quote_age_seconds, 999999),
      formalScope: h.formal_scope || "",
    },
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[daytrade-ticket3-contract] ${error.message}`);
  process.exitCode = 2;
});
