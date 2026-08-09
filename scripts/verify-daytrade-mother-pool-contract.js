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

function taipeiMinutesNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function formalSourceWindowStatus(date = new Date()) {
  const minutes = taipeiMinutesNow(date);
  const start = 8 * 60 + 45;
  const end = 13 * 60 + 30;
  if (minutes < start) return { inWindow: false, phase: "before_formal_source_window" };
  if (minutes > end) return { inWindow: false, phase: "after_formal_source_window" };
  return { inWindow: true, phase: "formal_source_window" };
}

async function optionalRestGet(key, pathAndQuery) {
  try {
    return await restGet(key, pathAndQuery);
  } catch (error) {
    return { __error: error?.message || String(error) };
  }
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

  const discoveryRequiredContractFields = [
    "trade_date",
    "symbol",
    "name",
    "market",
    "price",
    "open_price",
    "previous_close",
    "change_percent",
    "total_volume",
    "trade_value",
    "avg5_volume",
    "relative_volume_ratio",
    "volume_rank",
    "trade_value_rank",
    "ma3_turn_up",
    "ma5_turn_up",
    "ma10_turn_up",
    "ma30_turn_up",
    "ma58_turn_up",
    "ma_bull_stack_short",
    "ma_bull_stack_mid",
    "above_ma30",
    "above_ma58",
    "opening_range_break",
    "surge_flag",
    "volume_spike_flag",
    "strategy_source_flags",
    "sector_name",
    "sector_strength_score",
    "liquidity_grade",
    "mother_pool_score",
    "mother_pool_rank",
    "pool_reasons",
    "source_name",
    "updated_at",
    "data_gap",
    "mother_pool_candidate",
    "base_pool_failed_checks",
    "base_pool_pending_checks",
    "base_pool_eligible",
    "base_pool_pending",
    "in_formal_priority_top40",
  ];

  const [motherRows, formalRows, priorityRows, motherStarRows, priorityStarRows, healthRows, canonicalRows, lowPriceRows, discoveryRowsRaw, sourceStatusRowsRaw] = await Promise.all([
    restGet(anonKey, "v_fugle_daytrade_mother_pool?select=symbol,price,mother_rank,mother_source,mother_pool_rule_version,mother_readiness_status,quote_age_seconds,in_formal_priority_top40&order=mother_rank.asc&limit=5"),
    restGet(anonKey, "v_fugle_daytrade_formal_priority_top40?select=symbol,price,mother_rank,mother_readiness_status,quote_age_seconds&order=mother_rank.asc&limit=100"),
    restGet(anonKey, "v_fugle_daytrade_priority_top40?select=symbol,price,mother_pool_rank,mother_readiness_status,quote_age_seconds&order=mother_pool_rank.asc&limit=100"),
    restGet(anonKey, "v_fugle_daytrade_mother_pool?select=*&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_priority_top40?select=*&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_mother_pool_contract_health?select=*&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_canonical_gate?select=payload,formal_pool_scope&limit=1"),
    restGet(anonKey, "v_fugle_daytrade_mother_pool?select=symbol,price&price=lt.50&limit=5"),
    optionalRestGet(anonKey, "v_fugle_daytrade_mother_pool_discovery_readback?select=*&order=mother_pool_rank.asc&limit=800"),
    optionalRestGet(anonKey, "source_status?source_name=eq.fugle_daytrade_source&select=payload&limit=1"),
  ]);

  const health = Array.isArray(healthRows) ? healthRows[0] || {} : {};
  const discoveryRows = Array.isArray(discoveryRowsRaw) ? discoveryRowsRaw : [];
  const discoveryViewError = discoveryRowsRaw && !Array.isArray(discoveryRowsRaw) ? discoveryRowsRaw.__error || "unknown_error" : "";
  const sourceStatusPayload = Array.isArray(sourceStatusRowsRaw)
    ? (sourceStatusRowsRaw[0]?.payload && typeof sourceStatusRowsRaw[0].payload === "object" ? sourceStatusRowsRaw[0].payload : {})
    : {};
  const canonicalRow = Array.isArray(canonicalRows) ? canonicalRows[0] || {} : {};
  const canonical = { ...canonicalRow, ...(canonicalRow.payload && typeof canonicalRow.payload === "object" ? canonicalRow.payload : {}) };
  const motherContractRow = Array.isArray(motherStarRows) ? motherStarRows[0] || {} : {};
  const priorityContractRow = Array.isArray(priorityStarRows) ? priorityStarRows[0] || {} : {};
  const motherPoolSymbols = numberValue(health.mother_pool_symbols, numberValue(canonical.mother_pool_symbols));
  const formalPrioritySymbols = numberValue(health.formal_priority_symbols);
  const formalPriorityLimit = numberValue(health.formal_priority_limit, 40);
  const formalMaxMotherRank = numberValue(health.formal_max_mother_rank);
  const priorityTop40Rows = Array.isArray(priorityRows) ? priorityRows.length : 0;
  const formalTop40Rows = Array.isArray(formalRows) ? formalRows.length : 0;
  const motherPoolRows = discoveryRows;
  const motherPoolTop20 = motherPoolRows.slice(0, 20);
  const top40Symbols = new Set((Array.isArray(priorityRows) ? priorityRows : []).map((row) => String(row.symbol || "").trim()).filter(Boolean));
  const nonTop40Rows = motherPoolRows.filter((row) => !top40Symbols.has(String(row.symbol || "").trim()));
  const top40SubsetOfMotherPool = top40Symbols.size === 0 || [...top40Symbols].every((symbol) => motherPoolRows.some((row) => String(row.symbol || "").trim() === symbol));
  const avg5Below3000TrialOrWatchExamples = motherPoolRows.filter((row) => numberValue(row.avg5_volume) < 3000 && String(row.liquidity_grade || "") !== "watch_only").slice(0, 10);
  const dataGapRows = motherPoolRows.filter((row) => String(row.data_gap?.status || row.data_gap_status || "").toUpperCase() === "DATA_GAP");
  const delta = sourceStatusPayload.mother_pool_delta && typeof sourceStatusPayload.mother_pool_delta === "object" ? sourceStatusPayload.mother_pool_delta : {};
  const intradayAddedRows = motherPoolRows.filter((row) => (Array.isArray(row.pool_reasons) ? row.pool_reasons : []).some((reason) => /intraday|gain_rank|volume_|opening_range|ma3_5_10|tracked_buy_point/i.test(String(reason))));
  const upgradedToPriorityExamples = (Array.isArray(delta.upgraded_to_priority_symbols) ? delta.upgraded_to_priority_symbols : [])
    .map((symbol) => motherPoolRows.find((row) => String(row.symbol || "") === String(symbol)))
    .filter(Boolean)
    .slice(0, 20);
  const priorityTop40MaxRank = Array.isArray(priorityRows) ? Math.max(0, ...priorityRows.map((item) => numberValue(item.mother_pool_rank))) : 0;
  const formalTop40MaxRank = Array.isArray(formalRows) ? Math.max(0, ...formalRows.map((item) => numberValue(item.mother_rank))) : 0;
  const issues = [];
  if (motherPoolSymbols > 600) issues.push("mother_pool_symbols_above_max_600");
  if (Array.isArray(lowPriceRows) && lowPriceRows.length > 0) issues.push("mother_pool_price_below_50:" + lowPriceRows.map((row) => row.symbol).join(","));
  const warnings = [];
  const sourceWindow = formalSourceWindowStatus();
  if (discoveryViewError) issues.push("mother_pool_discovery_view_unavailable:" + discoveryViewError);
  if (!Array.isArray(motherRows) || motherRows.length === 0) issues.push("mother_pool_view_empty_or_missing");
  if (discoveryRows.length === 0 && !discoveryViewError) issues.push("mother_pool_discovery_view_empty");
  if (!top40SubsetOfMotherPool && discoveryRows.length > 0) issues.push("priority_top40_not_subset_of_mother_pool");
  if (!Array.isArray(formalRows) || formalRows.length === 0) issues.push("formal_priority_top40_view_empty_or_missing");
  if (!Array.isArray(priorityRows) || priorityRows.length === 0) issues.push("priority_top40_view_empty_or_missing");
  if (!motherContractRow || Object.keys(motherContractRow).length === 0) issues.push("mother_pool_star_contract_empty_or_missing");
  if (!priorityContractRow || Object.keys(priorityContractRow).length === 0) issues.push("priority_top40_star_contract_empty_or_missing");
  if (!health || Object.keys(health).length === 0) issues.push("mother_pool_contract_health_empty_or_missing");
  if (motherPoolSymbols < 300) issues.push(`mother_pool_symbols_${motherPoolSymbols}_below_min_300`);
  if (formalPriorityLimit !== 40) issues.push(`formal_priority_limit_${formalPriorityLimit}_must_equal_40`);
  if (formalPrioritySymbols !== 40) issues.push(`formal_priority_symbols_${formalPrioritySymbols}_must_equal_40`);
  if (formalMaxMotherRank > 40) issues.push(`formal_max_mother_rank_${formalMaxMotherRank}_above_40`);
  if (priorityTop40Rows > 40) issues.push(`priority_top40_view_returned_${priorityTop40Rows}_rows_above_40`);
  if (formalTop40Rows > 40) issues.push(`formal_priority_top40_view_returned_${formalTop40Rows}_rows_above_40`);
  if (priorityTop40MaxRank > 40) issues.push(`priority_top40_max_rank_${priorityTop40MaxRank}_above_40`);
  if (formalTop40MaxRank > 40) issues.push(`formal_priority_top40_max_rank_${formalTop40MaxRank}_above_40`);
  for (const field of requiredContractFields) {
    if (!Object.prototype.hasOwnProperty.call(motherContractRow, field)) issues.push(`mother_pool_missing_field:${field}`);
    if (!Object.prototype.hasOwnProperty.call(priorityContractRow, field)) issues.push(`priority_top40_missing_field:${field}`);
  }
  for (const field of discoveryRequiredContractFields) {
    if (motherPoolRows.length > 0 && !Object.prototype.hasOwnProperty.call(motherPoolRows[0], field)) issues.push(`mother_pool_discovery_missing_field:${field}`);
  }
  if (String(health.mother_pool_source || "") !== "dynamic_daytrade_mother_pool") {
    issues.push(`mother_pool_source_not_dynamic:${health.mother_pool_source || "missing"}`);
  }
  const formalScope = String(health.formal_scope || "");
  const acceptedFormalScopes = new Set(["mother_pool_300_rotating_deep_scan"]);
  const legacyFormalScopeAliases = new Set(["mother_pool_rotation_priority_top40", "priority_top40", "top40_only"]);
  if (!acceptedFormalScopes.has(formalScope)) {
    if (legacyFormalScopeAliases.has(formalScope)) {
      warnings.push(`formal_scope_legacy_alias_needs_db_normalization:${formalScope}`);
    } else {
      issues.push(`formal_scope_not_mother_pool:${formalScope || "missing"}`);
    }
  }
  const formalScanPoolSymbols = numberValue(health.formal_scan_pool_symbols, numberValue(canonical.formal_scan_pool_symbols));
  const priorityTop40Symbols = numberValue(health.priority_top40_symbols, numberValue(canonical.priority_top40_symbols, formalPrioritySymbols));
  const motherFreshQuoteCoverage120s = numberValue(health.mother_fresh_quote_coverage_120s, numberValue(canonical.mother_pool_fresh_quote_coverage_120s));
  const formalFreshQuoteCoverage120s = numberValue(health.formal_fresh_quote_coverage_120s, numberValue(canonical.priority_fresh_quote_coverage_120s));
  if (formalScanPoolSymbols < 300) issues.push("formal_scan_pool_symbols_" + formalScanPoolSymbols + "_below_300");
  if (priorityTop40Symbols !== 40) issues.push("priority_top40_symbols_" + priorityTop40Symbols + "_must_equal_40");
  if (sourceWindow.inWindow && motherFreshQuoteCoverage120s < 0.8) {
    issues.push("mother_fresh_quote_coverage_" + motherFreshQuoteCoverage120s + "_below_0.8");
  } else if (!sourceWindow.inWindow && motherFreshQuoteCoverage120s < 0.8) {
    warnings.push("off_session_mother_fresh_quote_coverage_" + motherFreshQuoteCoverage120s + "_not_formal_blocker");
  }
  if (sourceWindow.inWindow && formalFreshQuoteCoverage120s < 0.95) {
    issues.push("formal_fresh_quote_coverage_" + formalFreshQuoteCoverage120s + "_below_0.95");
  } else if (!sourceWindow.inWindow && formalFreshQuoteCoverage120s < 0.95) {
    warnings.push("off_session_formal_fresh_quote_coverage_" + formalFreshQuoteCoverage120s + "_not_formal_blocker");
  }

  const result = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    sourceWindow,
    views: {
      motherPool: "v_fugle_daytrade_mother_pool",
      discoveryReadback: "v_fugle_daytrade_mother_pool_discovery_readback",
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
      formalMaxMotherRank,
      priorityTop40Rows,
      formalTop40Rows,
      priorityTop40MaxRank,
      formalTop40MaxRank,
      motherFreshQuoteCoverage120s,
      formalScanPoolSymbols,
      priorityTop40Symbols,
      formalFreshQuoteCoverage120s,
      formalMaxQuoteAgeSeconds: numberValue(health.formal_max_quote_age_seconds, 999999),
      contractStatus: health.contract_status || "",
      contractReason: health.contract_reason || "",
      motherPoolSource: health.mother_pool_source || "",
      motherPoolRuleVersion: health.mother_pool_rule_version || "",
      motherPoolMinPrice: numberValue(health.mother_pool_min_price, 50),
      lowPriceRows: Array.isArray(lowPriceRows) ? lowPriceRows : [],
      motherPoolRows: motherPoolRows.length,
      motherPoolTop20,
      nonTop40Count: nonTop40Rows.length,
      nonTop40Symbols: nonTop40Rows.map((row) => row.symbol),
      intradayAddedCount: numberValue(delta.added_count, intradayAddedRows.length),
      intradayAddedExamples: intradayAddedRows.slice(0, 20),
      avg5Below3000TrialOrWatchExamples,
      upgradedToPriorityCount: numberValue(delta.upgraded_to_priority_count, upgradedToPriorityExamples.length),
      upgradedToPriorityExamples,
      dataGapRows,
      top40SubsetOfMotherPool,
      motherPoolDelta: delta,
      basePoolFailureCounts: sourceStatusPayload.mother_pool_base_pool_failure_counts
        || sourceStatusPayload.motherPoolBasePoolFailureCounts
        || {},
      basePoolPendingCounts: sourceStatusPayload.mother_pool_base_pool_pending_counts
        || sourceStatusPayload.motherPoolBasePoolPendingCounts
        || {},
      formalScope: health.formal_scope || "",
    },
    samples: {
      motherPool: motherRows,
      motherPoolDiscovery: motherPoolTop20,
      priorityTop40: priorityRows,
      nonTop40: nonTop40Rows.slice(0, 20),
      formalPriorityTop40: formalRows,
      motherPoolContractFields: Object.keys(motherContractRow),
      priorityTop40ContractFields: Object.keys(priorityContractRow),
    },
    issues,
    warnings,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[daytrade-mother-pool-contract] ${error.message}`);
  process.exitCode = 2;
});
