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
    restGet(anonKey, "v_fugle_daytrade_mother_pool?select=symbol,mother_rank,mother_source,mother_pool_rule_version,mother_readiness_status,quote_age_seconds,in_formal_priority_top40&order=mother_rank.asc&limit=5"),
    restGet(anonKey, "v_fugle_daytrade_formal_priority_top40?select=symbol,mother_rank,mother_readiness_status,quote_age_seconds&order=mother_rank.asc&limit=5"),
    restGet(anonKey, "v_fugle_daytrade_priority_top40?select=symbol,mother_pool_rank,mother_readiness_status,quote_age_seconds&order=mother_pool_rank.asc&limit=5"),
    restGet(anonKey, "v_fugle_daytrade_mother_pool?select=*&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_priority_top40?select=*&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_mother_pool_contract_health?select=*&limit=1"),
  ]);

  const health = Array.isArray(healthRows) ? healthRows[0] || {} : {};
  const motherContractRow = Array.isArray(motherStarRows) ? motherStarRows[0] || {} : {};
  const priorityContractRow = Array.isArray(priorityStarRows) ? priorityStarRows[0] || {} : {};
  const motherPoolSymbols = numberValue(health.mother_pool_symbols);
  const formalPrioritySymbols = numberValue(health.formal_priority_symbols);
  const formalPriorityLimit = numberValue(health.formal_priority_limit, 40);
  const issues = [];
  if (!Array.isArray(motherRows) || motherRows.length === 0) issues.push("mother_pool_view_empty_or_missing");
  if (!Array.isArray(formalRows) || formalRows.length === 0) issues.push("formal_priority_top40_view_empty_or_missing");
  if (!Array.isArray(priorityRows) || priorityRows.length === 0) issues.push("priority_top40_view_empty_or_missing");
  if (!motherContractRow || Object.keys(motherContractRow).length === 0) issues.push("mother_pool_star_contract_empty_or_missing");
  if (!priorityContractRow || Object.keys(priorityContractRow).length === 0) issues.push("priority_top40_star_contract_empty_or_missing");
  if (!health || Object.keys(health).length === 0) issues.push("mother_pool_contract_health_empty_or_missing");
  if (motherPoolSymbols < 180) issues.push(`mother_pool_symbols_${motherPoolSymbols}_below_min_180`);
  if (formalPrioritySymbols < Math.min(40, formalPriorityLimit)) {
    issues.push(`formal_priority_symbols_${formalPrioritySymbols}_below_${Math.min(40, formalPriorityLimit)}`);
  }
  for (const field of requiredContractFields) {
    if (!Object.prototype.hasOwnProperty.call(motherContractRow, field)) issues.push(`mother_pool_missing_field:${field}`);
    if (!Object.prototype.hasOwnProperty.call(priorityContractRow, field)) issues.push(`priority_top40_missing_field:${field}`);
  }
  if (String(health.mother_pool_source || "") !== "dynamic_daytrade_mother_pool") {
    issues.push(`mother_pool_source_not_dynamic:${health.mother_pool_source || "missing"}`);
  }
  if (String(health.formal_scope || "") !== "priority_top40") {
    issues.push(`formal_scope_not_priority_top40:${health.formal_scope || "missing"}`);
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
      motherRows: motherRows.length,
      formalRows: formalRows.length,
      motherPoolSymbols,
      formalPrioritySymbols,
      formalPriorityLimit,
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
      motherPool: motherRows,
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
