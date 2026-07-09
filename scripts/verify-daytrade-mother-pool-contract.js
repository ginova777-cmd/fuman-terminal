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

  const [motherRows, formalRows, healthRows] = await Promise.all([
    restGet(anonKey, "v_fugle_daytrade_mother_pool?select=symbol,mother_rank,mother_source,mother_pool_rule_version,mother_readiness_status,quote_age_seconds,in_formal_priority_top40&order=mother_rank.asc&limit=5"),
    restGet(anonKey, "v_fugle_daytrade_formal_priority_top40?select=symbol,mother_rank,mother_readiness_status,quote_age_seconds&order=mother_rank.asc&limit=5"),
    restGet(anonKey, "v_fugle_daytrade_mother_pool_contract_health?select=*&limit=1"),
  ]);

  const health = Array.isArray(healthRows) ? healthRows[0] || {} : {};
  const motherPoolSymbols = numberValue(health.mother_pool_symbols);
  const formalPrioritySymbols = numberValue(health.formal_priority_symbols);
  const formalPriorityLimit = numberValue(health.formal_priority_limit, 40);
  const issues = [];
  if (!Array.isArray(motherRows) || motherRows.length === 0) issues.push("mother_pool_view_empty_or_missing");
  if (!Array.isArray(formalRows) || formalRows.length === 0) issues.push("formal_priority_top40_view_empty_or_missing");
  if (!health || Object.keys(health).length === 0) issues.push("mother_pool_contract_health_empty_or_missing");
  if (motherPoolSymbols < 180) issues.push(`mother_pool_symbols_${motherPoolSymbols}_below_min_180`);
  if (formalPrioritySymbols < Math.min(40, formalPriorityLimit)) {
    issues.push(`formal_priority_symbols_${formalPrioritySymbols}_below_${Math.min(40, formalPriorityLimit)}`);
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
      formalPriorityTop40: formalRows,
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
