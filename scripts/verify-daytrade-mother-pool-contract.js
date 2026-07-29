const fs = require("fs");
const path = require("path");

const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(__dirname, "..", "secrets", name),
  ]) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // optional secret
    }
  }
  return "";
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function restGet(key, pathAndQuery) {
  const response = await fetch(`${PROJECT_URL.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`GET ${pathAndQuery} HTTP ${response.status}: ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const anonKey = process.env.SUPABASE_ANON_KEY || readSecret("supabase-anon-key.txt");
  if (!anonKey) throw new Error("missing Supabase anon key");

  const requiredContractFields = [
    "trade_date",
    "symbol",
    "name",
    "market",
    "price",
    "open_price",
    "previous_close",
    "change_percent",
    "amplitude_from_open",
    "total_volume",
    "trade_value",
    "avg5_volume",
    "mother_pool_score",
    "priority_score",
    "priority_rank",
    "mother_pool_rank",
    "is_strong_group_leader",
    "strong_group_leader_score",
    "futopt_0846_ready",
    "futopt_0846_score",
    "turnover_rate_3d",
    "turnover_rate_5d",
    "turnover_score",
    "margin_decrease_price_strong",
    "margin_decrease_price_strong_score",
    "margin_short_sync_price_strong",
    "margin_short_sync_price_strong_score",
    "ex_dividend_risk",
    "next_day_sell_risk",
    "daytrade_risk_penalty",
    "is_formal_entry_eligible",
    "source_name",
    "updated_at",
  ];

  const [motherRows, formalRows, priorityRows, motherStarRows, priorityStarRows, healthRows] = await Promise.all([
    // A five-row sample proves only that the view is non-empty. Read 301 rows
    // so the contract can prove the actual 300-row mother-pool cardinality.
    restGet(anonKey, "v_fugle_daytrade_mother_pool?select=symbol,mother_rank,mother_source,mother_pool_rule_version,mother_readiness_status,quote_age_seconds,in_formal_priority_top40&order=mother_rank.asc&limit=301"),
    restGet(anonKey, "v_fugle_daytrade_formal_priority_top40?select=symbol,mother_rank,mother_readiness_status,quote_age_seconds&order=mother_rank.asc&limit=100"),
    restGet(anonKey, "v_fugle_daytrade_priority_top40?select=symbol,mother_pool_rank,mother_readiness_status,quote_age_seconds&order=mother_pool_rank.asc&limit=100"),
    restGet(anonKey, "v_fugle_daytrade_mother_pool?select=*&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_priority_top40?select=*&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_mother_pool_contract_health?select=*&limit=1"),
  ]);

  const health = Array.isArray(healthRows) ? healthRows[0] || {} : {};
  const motherContractRow = Array.isArray(motherStarRows) ? motherStarRows[0] || {} : {};
  const priorityContractRow = Array.isArray(priorityStarRows) ? priorityStarRows[0] || {} : {};
  const motherPoolSymbols = numberValue(health.mother_pool_symbols);
  const formalPrioritySymbols = numberValue(health.formal_priority_symbols);
  const motherViewRows = Array.isArray(motherRows) ? motherRows.length : 0;
  const formalPriorityLimit = numberValue(health.formal_priority_limit, 40);
  const formalMaxMotherRank = numberValue(health.formal_max_mother_rank);
  const priorityTop40Rows = Array.isArray(priorityRows) ? priorityRows.length : 0;
  const formalTop40Rows = Array.isArray(formalRows) ? formalRows.length : 0;
  const priorityTop40MaxRank = Array.isArray(priorityRows) ? Math.max(0, ...priorityRows.map((item) => numberValue(item.mother_pool_rank))) : 0;
  const formalTop40MaxRank = Array.isArray(formalRows) ? Math.max(0, ...formalRows.map((item) => numberValue(item.mother_rank))) : 0;
  const issues = [];
  if (!Array.isArray(motherRows) || motherRows.length === 0) issues.push("mother_pool_view_empty_or_missing");
  if (!Array.isArray(formalRows) || formalRows.length === 0) issues.push("formal_priority_top40_view_empty_or_missing");
  if (!Array.isArray(priorityRows) || priorityRows.length === 0) issues.push("priority_top40_view_empty_or_missing");
  if (!motherContractRow || Object.keys(motherContractRow).length === 0) issues.push("mother_pool_star_contract_empty_or_missing");
  if (!priorityContractRow || Object.keys(priorityContractRow).length === 0) issues.push("priority_top40_star_contract_empty_or_missing");
  if (!health || Object.keys(health).length === 0) issues.push("mother_pool_contract_health_empty_or_missing");
  if (motherPoolSymbols !== 300) issues.push(`mother_pool_symbols_${motherPoolSymbols}_must_equal_300`);
  if (motherViewRows !== 300) issues.push(`mother_pool_view_returned_${motherViewRows}_rows_must_equal_300`);
  if (formalPriorityLimit !== 40) issues.push(`formal_priority_limit_${formalPriorityLimit}_must_equal_40`);
  if (formalPrioritySymbols !== 40) issues.push(`formal_priority_symbols_${formalPrioritySymbols}_must_equal_40`);
  if (priorityTop40Rows !== 40) issues.push(`priority_top40_view_returned_${priorityTop40Rows}_rows_must_equal_40`);
  if (formalTop40Rows !== 40) issues.push(`formal_priority_top40_view_returned_${formalTop40Rows}_rows_must_equal_40`);
  if (formalMaxMotherRank > 40) issues.push(`formal_max_mother_rank_${formalMaxMotherRank}_above_40`);
  if (priorityTop40MaxRank > 40) issues.push(`priority_top40_max_rank_${priorityTop40MaxRank}_above_40`);
  if (formalTop40MaxRank > 40) issues.push(`formal_priority_top40_max_rank_${formalTop40MaxRank}_above_40`);
  const motherFreshQuoteCoverage120s = numberValue(health.mother_fresh_quote_coverage_120s);
  const formalFreshQuoteCoverage120s = numberValue(health.formal_fresh_quote_coverage_120s);
  const formalMaxQuoteAgeSeconds = numberValue(health.formal_max_quote_age_seconds, 999999);
  if (motherFreshQuoteCoverage120s < 0.80) issues.push(`mother_fresh_quote_coverage_${motherFreshQuoteCoverage120s}_below_0.80`);
  if (formalFreshQuoteCoverage120s < 0.95) issues.push(`formal_fresh_quote_coverage_${formalFreshQuoteCoverage120s}_below_0.95`);
  if (formalMaxQuoteAgeSeconds > 120) issues.push(`formal_max_quote_age_${formalMaxQuoteAgeSeconds}_above_120`);
  for (const field of requiredContractFields) {
    if (!Object.prototype.hasOwnProperty.call(motherContractRow, field)) issues.push(`mother_pool_missing_field:${field}`);
    if (!Object.prototype.hasOwnProperty.call(priorityContractRow, field)) issues.push(`priority_top40_missing_field:${field}`);
  }
  if (String(health.mother_pool_source || "") !== "dynamic_daytrade_mother_pool") {
    issues.push(`mother_pool_source_not_dynamic:${health.mother_pool_source || "missing"}`);
  }
  const expectedFormalScope = "mother_pool_300_rotating_deep_scan";
  if (String(health.formal_scope || "") !== expectedFormalScope) {
    issues.push(`formal_scope_not_${expectedFormalScope}:${health.formal_scope || "missing"}`);
  }

  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    views: {
      motherPool: "v_fugle_daytrade_mother_pool",
      priorityTop40: "v_fugle_daytrade_priority_top40",
      formalPriorityTop40: "v_fugle_daytrade_formal_priority_top40",
      contractHealth: "v_fugle_daytrade_mother_pool_contract_health",
    },
    readback: {
      motherRows: motherViewRows,
      formalRows: formalRows.length,
      motherPoolSymbols,
      formalPrioritySymbols,
      formalPriorityLimit,
      formalMaxMotherRank,
      priorityTop40Rows,
      formalTop40Rows,
      priorityTop40MaxRank,
      formalTop40MaxRank,
      motherFreshQuoteCoverage120s: numberValue(health.mother_fresh_quote_coverage_120s),
      formalFreshQuoteCoverage120s: numberValue(health.formal_fresh_quote_coverage_120s),
      formalMaxQuoteAgeSeconds: numberValue(health.formal_max_quote_age_seconds, 999999),
      contractStatus: health.contract_status || "",
      contractReason: health.contract_reason || "",
      motherPoolSource: health.mother_pool_source || "",
      motherPoolRuleVersion: health.mother_pool_rule_version || "",
      formalScope: health.formal_scope || "",
    },
    samples: {
      motherPool: motherRows.slice(0, 5),
      priorityTop40: priorityRows,
      formalPriorityTop40: formalRows,
      motherPoolContractFields: Object.keys(motherContractRow),
      priorityTop40ContractFields: Object.keys(priorityContractRow),
    },
    issues,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[daytrade-mother-pool-contract] ${error.message}`);
  process.exitCode = 2;
});
