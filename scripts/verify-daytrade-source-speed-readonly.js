const fs = require("fs");
const path = require("path");

const PROJECT_URL = process.env.SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co";
const SOURCE_NAME = process.env.DAYTRADE_SOURCE_NAME || "fugle_daytrade_source";
const WINDOW_SECONDS = Number(process.env.DAYTRADE_FRESH_WINDOW_SECONDS || 120);
const TARGET_FRESH_QUOTES = Number(process.env.DAYTRADE_TARGET_FRESH_QUOTES || 1500);
const MIN_FRESH_QUOTE_COVERAGE = Number(process.env.DAYTRADE_MIN_FRESH_QUOTE_COVERAGE || 0.9);
const MAX_SOURCE_AGE_SECONDS = Number(process.env.DAYTRADE_MAX_SOURCE_AGE_SECONDS || 90);
const MAX_QUOTE_AGE_SECONDS = Number(process.env.DAYTRADE_MAX_QUOTE_AGE_SECONDS || 90);
const OBSERVATION_MAX_QUOTE_AGE_SECONDS = Number(process.env.DAYTRADE_OBSERVATION_MAX_QUOTE_AGE_SECONDS || 180);
const MAX_INTRADAY_1M_STALE_SECONDS = Number(process.env.DAYTRADE_MAX_INTRADAY_1M_STALE_SECONDS || 120);
const MIN_READY_MA20_CONTINUOUS = Number(process.env.DAYTRADE_MIN_READY_MA20_CONTINUOUS || 1500);
const MIN_READY_MA35_CONTINUOUS = Number(process.env.DAYTRADE_MIN_READY_MA35_CONTINUOUS || 1500);
const MIN_PRIORITY_SYMBOLS = Number(process.env.DAYTRADE_MIN_PRIORITY_SYMBOLS || 1);
const MIN_PRIORITY_POOL_SYMBOLS = Number(process.env.DAYTRADE_MIN_PRIORITY_POOL_SYMBOLS || 300);
const MIN_PRIORITY_FRESH_QUOTE_COVERAGE = Number(process.env.DAYTRADE_MIN_PRIORITY_FRESH_QUOTE_COVERAGE || 0.95);
const TARGET_PRIORITY_FRESH_QUOTE_COVERAGE = Number(process.env.DAYTRADE_TARGET_PRIORITY_FRESH_QUOTE_COVERAGE || 1);
const SELECTED_SYMBOL_MAX_QUOTE_AGE_SECONDS = Number(process.env.DAYTRADE_SELECTED_SYMBOL_MAX_QUOTE_AGE_SECONDS || 60);
const RECENT_429_BLOCK_SECONDS = Number(process.env.DAYTRADE_RECENT_429_BLOCK_SECONDS || 90);
const FULL_MARKET_MAX_ROUND_SECONDS = Number(process.env.DAYTRADE_FULL_MARKET_MAX_ROUND_SECONDS || 180);
const MIN_FUTOPT_MAPPED = Number(process.env.DAYTRADE_MIN_FUTOPT_MAPPED || 1);
const ASSUMED_BATCH_SIZE = Number(process.env.DAYTRADE_ASSUMED_BATCH_SIZE || 40);
const JSON_ONLY = process.argv.includes("--json-only");
const REPO_ROOT = path.join(__dirname, "..");
const SOURCE_ISOLATION_FILES = [
  "scripts/run-daytrade-source-writer.js",
];
const FORBIDDEN_DAYTRADE_SOURCE_MARKERS = [
  "fugle_shared_source",
  "raw_supabase_source_coverage_aggregate_readthrough",
  "raw_supabase_source_status_payload_readthrough",
  "raw_supabase_intraday_1m_status_readthrough",
  "raw_supabase_stock_future_contract_readthrough",
  "raw_supabase_strategy12_stock_future_contract_health",
  "v_fugle_intraday_1m_status",
  "v_stock_future_live_contract",
  "v_strategy12_stock_future_contract_health",
];

const REQUIRED_PAYLOAD_FIELDS = [
  "daytrade_gate_grade",
  "daytrade_source_speed_ok",
  "fresh_quote_window_seconds",
  "fresh_quotes_120s",
  "fresh_quote_coverage_120s",
  "active_symbols",
  "quote_age_seconds",
  "required_quote_speed_per_sec",
  "actual_quote_speed_per_sec",
  "batch_size",
  "batch_interval_seconds",
  "priority_symbols",
  "gate_mode",
  "priority_gate_grade",
  "full_market_gate_grade",
  "selected_symbols_fresh_ok",
  "priority_pool_symbols",
  "priority_fresh_quotes_120s",
  "priority_fresh_quote_coverage_120s",
  "eligible_quote_rows",
  "scanner_can_run_opening",
  "scanner_can_run_quote_only",
  "daily_volume_status",
  "avg_volume5_eligible",
  "ready_ma20_continuous",
  "ready_ma35_continuous",
  "intraday_1m_stale_seconds",
  "today_1m_symbols",
  "today_1m_rows",
  "futopt_stock_mapped",
  "rate_limit_status",
  "last_429_at",
  "cooldown_until",
  "full_market_round_seconds",
  "full_market_batch_interval_seconds",
  "full_market_paused_until",
  "finmind_cooldown_until",
  "last_429_age_seconds",
  "quota_competing_stages",
  "self_heal_count",
  "last_self_heal_at",
  "last_self_heal_reason",
];

function readTextSecret(paths) {
  for (const file of paths) {
    try {
      if (!fs.existsSync(file)) continue;
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // Ignore unreadable optional secret paths.
    }
  }
  return "";
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|ok|ready)$/i.test(String(value || ""));
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function payloadValue(payload, names, fallback = undefined) {
  if (!payload || typeof payload !== "object") return fallback;
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(payload, name)) continue;
    const value = payload[name];
    if (value === null || value === undefined || value === "") return fallback;
    return value;
  }
  return fallback;
}

function isoAgeSeconds(value, fallback = 999999) {
  if (!value) return fallback;
  const ts = Date.parse(String(value));
  if (!Number.isFinite(ts)) return fallback;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function futureSeconds(value, fallback = 0) {
  if (!value) return fallback;
  const ts = Date.parse(String(value));
  if (!Number.isFinite(ts)) return fallback;
  return Math.max(0, Math.ceil((ts - Date.now()) / 1000));
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === null || value === undefined || value === "") return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function taipeiMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function daytradePhase() {
  const minutes = taipeiMinutes();
  if (minutes < 360) return "closed_before_0600";
  if (minutes < 510) return "warmup_0600_0829";
  if (minutes < 525) return "preopen_prepare_0830_0844";
  if (minutes < 540) return "opening_boost_0845_0859";
  if (minutes < 575) return "opening_detection_0900_0934";
  if (minutes <= 810) return "regular_daytrade_0935_1330";
  return "after_daytrade_window";
}

function normalizeGateGrade(value) {
  const grade = String(value || "").trim().toUpperCase();
  return ["A", "B", "C", "D"].includes(grade) ? grade : "";
}

function getWorstGateGrade(grades) {
  const rank = { A: 0, B: 1, C: 2, D: 3 };
  return grades.reduce((worst, grade) => {
    const normalized = normalizeGateGrade(grade) || "D";
    return rank[normalized] > rank[worst] ? normalized : worst;
  }, "A");
}

function issue(code, severity, detail = {}) {
  return { code, severity, detail };
}

function auditSourceIsolation() {
  const violations = [];
  for (const relativePath of SOURCE_ISOLATION_FILES) {
    const file = path.join(REPO_ROOT, relativePath);
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      violations.push({ file: relativePath, marker: "file_unreadable", message: error.message });
      continue;
    }
    for (const marker of FORBIDDEN_DAYTRADE_SOURCE_MARKERS) {
      if (text.includes(marker)) violations.push({ file: relativePath, marker });
    }
  }
  return {
    ok: violations.length === 0,
    checkedFiles: SOURCE_ISOLATION_FILES,
    forbiddenMarkers: FORBIDDEN_DAYTRADE_SOURCE_MARKERS,
    violations,
  };
}

function buildMissingResult(phase) {
  return {
    ok: false,
    gateGrade: "D",
    formalEntryAllowed: false,
    observationOnly: false,
    stopNewSignals: true,
    phase,
    mode: "read-only",
    report: "dedicated-daytrade-source-speed",
    sourceIsolation: "dedicated",
    issues: [
      issue("source_status_missing", "critical", {
        sourceName: SOURCE_NAME,
        rule: "missing dedicated daytrade source => D",
      }),
    ],
    warnings: [],
    evidence: {
      rowCount: 0,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function readSourceStatus(anonKey) {
  const url = new URL("/rest/v1/source_status", PROJECT_URL.replace(/\/+$/, ""));
  url.searchParams.set("source_name", `eq.${SOURCE_NAME}`);
  url.searchParams.set("select", "source_name,status,updated_at,message,payload");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`source_status HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return text ? JSON.parse(text) : [];
}

async function main() {
  const phase = daytradePhase();
  const currentTaipeiMinutes = taipeiMinutes();
  const openingPriorityFirstWindow = currentTaipeiMinutes >= 525 && currentTaipeiMinutes < 550;
  const anonKey = process.env.SUPABASE_ANON_KEY || readTextSecret([
    path.join("C:", "fuman-runtime", "secrets", "supabase-anon-key.txt"),
    path.join(__dirname, "..", "secrets", "supabase-anon-key.txt"),
  ]);
  if (!anonKey) throw new Error("SUPABASE_ANON_KEY is required for the read-only dedicated daytrade source speed report.");

  const rows = await readSourceStatus(anonKey);
  if (!Array.isArray(rows) || !rows[0]) {
    const result = buildMissingResult(phase);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
    return;
  }

  const row = rows[0];
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const issues = [];
  const warnings = [];
  const sourceIsolationAudit = auditSourceIsolation();
  const missingPayloadFields = REQUIRED_PAYLOAD_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(payload, field));

  const sourceStatus = stringValue(row.status).toLowerCase();
  const sourceAge = isoAgeSeconds(row.updated_at);
  const writerGateGradeRaw = payloadValue(payload, ["daytrade_gate_grade"], "");
  const writerGateGrade = normalizeGateGrade(writerGateGradeRaw);
  const daytradeSourceSpeedOk = boolValue(payloadValue(payload, ["daytrade_source_speed_ok"], false));
  const freshQuoteWindowSeconds = numberValue(payloadValue(payload, ["fresh_quote_window_seconds"], WINDOW_SECONDS), WINDOW_SECONDS);
  const activeSymbols = numberValue(payloadValue(payload, ["active_symbols", "mother_pool_symbols", "seeded_symbols"], 0));
  const motherPoolSymbols = numberValue(payloadValue(payload, ["mother_pool_symbols", "active_symbols"], 0));
  const quotes = numberValue(payloadValue(payload, ["quotes", "quote_count"], 0));
  const freshQuotes120 = numberValue(payloadValue(payload, ["fresh_quotes_120s", "eligible_quote_rows"], 0));
  let freshQuoteCoverage120 = numberValue(payloadValue(payload, ["fresh_quote_coverage_120s", "eligible_quote_coverage", "quote_coverage_ratio"], 0));
  if (freshQuoteCoverage120 <= 0 && activeSymbols > 0) {
    freshQuoteCoverage120 = Number((freshQuotes120 / Math.max(1, activeSymbols)).toFixed(4));
  }
  const quoteAgeSeconds = numberValue(payloadValue(payload, ["quote_age_seconds"], 999999), 999999);
  const requiredQuoteSpeedPerSecPayload = numberValue(payloadValue(payload, ["required_quote_speed_per_sec"], 0));
  const actualQuoteSpeedPerSecPayload = numberValue(payloadValue(payload, ["actual_quote_speed_per_sec"], 0));
  const batchSizePayload = numberValue(payloadValue(payload, ["batch_size"], ASSUMED_BATCH_SIZE), ASSUMED_BATCH_SIZE);
  const batchIntervalSecondsPayload = numberValue(payloadValue(payload, ["batch_interval_seconds"], 0));
  const lastQuoteAt = stringValue(payloadValue(payload, ["last_quote_at"], ""));
  const gateMode = stringValue(payloadValue(payload, ["gate_mode"], "priority_first"));
  const writerPriorityGateGrade = normalizeGateGrade(payloadValue(payload, ["priority_gate_grade"], ""));
  const writerFullMarketGateGrade = normalizeGateGrade(payloadValue(payload, ["full_market_gate_grade"], ""));
  const selectedSymbolsFreshOk = boolValue(payloadValue(payload, ["selected_symbols_fresh_ok"], false));
  const prioritySymbols = numberValue(payloadValue(payload, ["priority_symbols"], 0));
  const priorityPoolSymbols = numberValue(payloadValue(payload, ["priority_pool_symbols", "priority_symbols"], 0));
  const priorityFreshQuotes120 = numberValue(payloadValue(payload, ["priority_fresh_quotes_120s"], 0));
  const priorityFreshQuoteCoverage120 = numberValue(payloadValue(payload, ["priority_fresh_quote_coverage_120s"], 0));
  const eligibleQuoteRows = numberValue(payloadValue(payload, ["eligible_quote_rows"], freshQuotes120), freshQuotes120);
  const terminalPrioritySymbols = numberValue(payloadValue(payload, ["terminal_priority_symbols"], 0));
  const strategyPrioritySymbols = numberValue(payloadValue(payload, ["strategy_priority_symbols"], 0));
  const openingPrioritySymbols = numberValue(payloadValue(payload, ["opening_priority_symbols"], 0));
  const dailyVolumeStatus = stringValue(payloadValue(payload, ["daily_volume_status"], ""));
  const dailyVolumeRows = numberValue(payloadValue(payload, ["daily_volume_rows"], 0));
  const avgVolume5Eligible = numberValue(payloadValue(payload, ["avg_volume5_eligible"], 0));
  const scannerCanRunQuoteOnly = boolValue(payloadValue(payload, ["scanner_can_run_quote_only"], false));
  const scannerCanRunOpening = boolValue(payloadValue(payload, ["scanner_can_run_opening"], false));
  const scannerBlockReason = stringValue(payloadValue(payload, ["scanner_block_reason"], ""));
  const intraday1mStaleSeconds = numberValue(payloadValue(payload, ["intraday_1m_stale_seconds"], 999999), 999999);
  const intraday1mStatus = stringValue(payloadValue(payload, ["intraday_1m_status"], ""));
  const today1mSymbols = numberValue(payloadValue(payload, ["today_1m_symbols", "intraday_1m_symbols_today"], 0));
  const today1mRows = numberValue(payloadValue(payload, ["today_1m_rows", "today_candle_count", "intraday_1m_rows_today"], 0));
  const readyMa20 = numberValue(payloadValue(payload, ["ready_ma20_continuous", "ready_ma20_continuous_symbols", "ready_ge_20_symbols"], 0));
  const readyMa35 = numberValue(payloadValue(payload, ["ready_ma35_continuous", "ready_ma35_continuous_symbols", "ready_ge_35_symbols"], 0));
  const futoptMapped = numberValue(payloadValue(payload, ["futopt_stock_mapped"], 0));
  const futoptThisLoop = numberValue(payloadValue(payload, ["futopt_stock_this_loop", "futopt_stock_quotes_this_loop"], 0));
  const openingBoostActive = boolValue(payloadValue(payload, ["opening_boost_active"], false));
  const restQuoteRateLimited = boolValue(payloadValue(payload, ["rest_quote_rate_limited"], false));
  const collectorRateLimited = boolValue(payloadValue(payload, ["collector_adaptive_rate_limited", "adaptive_rate_limited"], false));
  const collectorAdaptiveRpm = numberValue(payloadValue(payload, ["collector_adaptive_rpm", "adaptive_rpm"], 0));
  const collectorAdaptiveDelayMs = numberValue(payloadValue(payload, ["collector_adaptive_delay_ms", "adaptive_delay_ms"], 0));
  const collectorPriorityOnly = boolValue(payloadValue(payload, ["collector_adaptive_priority_only"], false));
  const collector429WindowCount = numberValue(payloadValue(payload, ["collector_adaptive_429_window_count"], 0));
  const rateLimitStatus = stringValue(payloadValue(payload, ["rate_limit_status"], ""));
  const last429At = stringValue(payloadValue(payload, ["last_429_at"], ""));
  const cooldownUntil = stringValue(payloadValue(payload, ["cooldown_until"], ""));
  const last429AgeSeconds = numberValue(payloadValue(payload, ["last_429_age_seconds"], isoAgeSeconds(last429At, 999999)), isoAgeSeconds(last429At, 999999));
  const cooldownRemainingSeconds = futureSeconds(cooldownUntil, 0);
  const fullMarketRoundSeconds = numberValue(payloadValue(payload, ["full_market_round_seconds"], 999999), 999999);
  const fullMarketBatchIntervalSeconds = numberValue(payloadValue(payload, ["full_market_batch_interval_seconds"], 0));
  const fullMarketPausedUntil = stringValue(payloadValue(payload, ["full_market_paused_until"], ""));
  const finmindCooldownUntil = stringValue(payloadValue(payload, ["finmind_cooldown_until"], ""));
  const quotaCompetingStages = arrayValue(payloadValue(payload, ["quota_competing_stages"], []));
  const selfHealCount = numberValue(payloadValue(payload, ["self_heal_count"], 0));
  const lastSelfHealAt = stringValue(payloadValue(payload, ["last_self_heal_at"], ""));
  const lastSelfHealReason = stringValue(payloadValue(payload, ["last_self_heal_reason"], ""));

  const requiredSymbolsPerSecond = Number((TARGET_FRESH_QUOTES / Math.max(1, WINDOW_SECONDS)).toFixed(4));
  const measuredSymbolsPerSecond = Number((freshQuotes120 / Math.max(1, WINDOW_SECONDS)).toFixed(4));
  const requiredRpm = Math.ceil(requiredSymbolsPerSecond * 60);
  const maxBatchIntervalSeconds = Number((ASSUMED_BATCH_SIZE / Math.max(0.0001, requiredSymbolsPerSecond)).toFixed(2));
  const measuredBatchIntervalSeconds = measuredSymbolsPerSecond > 0 ? Number((ASSUMED_BATCH_SIZE / measuredSymbolsPerSecond).toFixed(2)) : 0;
  const freshQuoteGap = Math.max(0, TARGET_FRESH_QUOTES - freshQuotes120);
  const freshRateGapPerSecond = Number(Math.max(0, requiredSymbolsPerSecond - measuredSymbolsPerSecond).toFixed(4));
  const collectorRpmGap = Math.max(0, requiredRpm - collectorAdaptiveRpm);
  const dedicatedSourceFullMarketSpeedFeasible = collectorAdaptiveRpm >= requiredRpm;

  const after0830 = ["preopen_prepare_0830_0844", "opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0845 = ["opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const after0900 = ["opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);
  const formalWindow = ["opening_boost_0845_0859", "opening_detection_0900_0934", "regular_daytrade_0935_1330"].includes(phase);

  if (sourceAge > MAX_SOURCE_AGE_SECONDS) issues.push(issue("source_status_stale", "critical", { ageSeconds: sourceAge, max: MAX_SOURCE_AGE_SECONDS }));
  if (sourceStatus !== "ok") issues.push(issue("source_status_not_ok_for_daytrade", "critical", { sourceStatus, allowed: "ok" }));
  if (missingPayloadFields.length) issues.push(issue("daytrade_payload_required_fields_missing", "critical", { missing: missingPayloadFields }));
  if (!writerGateGrade) issues.push(issue("daytrade_gate_grade_missing_or_invalid", "critical", { value: stringValue(writerGateGradeRaw), rule: "missing or invalid daytrade_gate_grade => D" }));
  if (!daytradeSourceSpeedOk) issues.push(issue("daytrade_source_speed_ok_false", "critical", { daytradeSourceSpeedOk }));
  if (gateMode !== "priority_first") issues.push(issue("daytrade_gate_mode_not_priority_first", "critical", { gateMode, required: "priority_first" }));
  if (freshQuoteCoverage120 < MIN_FRESH_QUOTE_COVERAGE) warnings.push(issue("daytrade_full_market_fresh_quote_coverage_low_nonblocking", "warning", { coverage: freshQuoteCoverage120, min: MIN_FRESH_QUOTE_COVERAGE, freshQuotes120, targetFreshQuotes: TARGET_FRESH_QUOTES, rule: "full market is scorecard-only for priority-first daytrade gate" }));
  if (freshQuotes120 < TARGET_FRESH_QUOTES) warnings.push(issue("daytrade_full_market_fresh_quote_speed_low_nonblocking", "warning", { freshQuotes120, targetFreshQuotes: TARGET_FRESH_QUOTES, measuredSymbolsPerSecond, requiredSymbolsPerSecond, rule: "full market is scorecard-only for priority-first daytrade gate" }));
  if (quoteAgeSeconds > MAX_QUOTE_AGE_SECONDS) issues.push(issue("daytrade_quote_age_too_old", "critical", { quoteAgeSeconds, max: MAX_QUOTE_AGE_SECONDS }));
  if (prioritySymbols < MIN_PRIORITY_SYMBOLS) {
    (after0830 ? issues : warnings).push(issue("priority_symbols_empty", after0830 ? "critical" : "warning", { prioritySymbols, min: MIN_PRIORITY_SYMBOLS, phase }));
  }
  if (after0845 && priorityPoolSymbols < MIN_PRIORITY_POOL_SYMBOLS) issues.push(issue("priority_pool_too_small_for_daytrade", "critical", { priorityPoolSymbols, min: MIN_PRIORITY_POOL_SYMBOLS, targetRange: "300-500" }));
  if (after0845 && priorityFreshQuoteCoverage120 < MIN_PRIORITY_FRESH_QUOTE_COVERAGE) issues.push(issue("priority_pool_fresh_coverage_low", "critical", { priorityFreshQuoteCoverage120s: priorityFreshQuoteCoverage120, min: MIN_PRIORITY_FRESH_QUOTE_COVERAGE, priorityFreshQuotes120s: priorityFreshQuotes120, priorityPoolSymbols }));
  if (after0845 && priorityFreshQuoteCoverage120 < TARGET_PRIORITY_FRESH_QUOTE_COVERAGE) warnings.push(issue("priority_pool_not_100_percent_fresh", "warning", { priorityFreshQuoteCoverage120s: priorityFreshQuoteCoverage120, target: TARGET_PRIORITY_FRESH_QUOTE_COVERAGE, note: "A gate accepts 95%, but production tuning should target 100% for the priority pool." }));
  if (after0845 && !selectedSymbolsFreshOk) issues.push(issue("selected_symbols_not_fresh_for_daytrade", "critical", { selectedSymbolsFreshOk, maxQuoteAgeSeconds: SELECTED_SYMBOL_MAX_QUOTE_AGE_SECONDS }));
  if (after0830 && dailyVolumeStatus !== "ready") issues.push(issue("daily_volume_not_ready_for_daytrade", "critical", { dailyVolumeStatus, dailyVolumeRows, avgVolume5Eligible }));
  if (after0845 && !scannerCanRunOpening) issues.push(issue("scanner_can_run_opening_false", "critical", { scannerBlockReason }));
  if (after0845 && readyMa20 < MIN_READY_MA20_CONTINUOUS) issues.push(issue("ma20_continuous_not_ready_for_daytrade", "critical", { readyMa20Continuous: readyMa20, min: MIN_READY_MA20_CONTINUOUS }));
  if (after0845 && readyMa35 < MIN_READY_MA35_CONTINUOUS) issues.push(issue("ma35_continuous_not_ready_for_daytrade", "critical", { readyMa35Continuous: readyMa35, min: MIN_READY_MA35_CONTINUOUS }));
  if (after0845 && futoptMapped < MIN_FUTOPT_MAPPED) issues.push(issue("futopt_stock_mapping_missing_for_daytrade", "critical", { futoptStockMapped: futoptMapped, min: MIN_FUTOPT_MAPPED }));
  if (after0845 && futoptThisLoop <= 0) warnings.push(issue("futopt_stock_quote_this_loop_zero", "warning", { futoptStockThisLoop: futoptThisLoop, phase }));
  if (after0845 && !openingBoostActive && priorityFreshQuoteCoverage120 < MIN_PRIORITY_FRESH_QUOTE_COVERAGE) issues.push(issue("opening_boost_inactive_while_priority_coverage_low", "critical", { openingBoostActive, priorityFreshQuoteCoverage120, min: MIN_PRIORITY_FRESH_QUOTE_COVERAGE }));
  if (after0900 && intraday1mStaleSeconds > MAX_INTRADAY_1M_STALE_SECONDS) issues.push(issue("intraday_1m_stale_for_daytrade", "critical", { intraday1mStaleSeconds, max: MAX_INTRADAY_1M_STALE_SECONDS, status: intraday1mStatus, today1mSymbols, today1mRows }));
  if ((restQuoteRateLimited || collectorRateLimited) && priorityFreshQuoteCoverage120 < MIN_PRIORITY_FRESH_QUOTE_COVERAGE) issues.push(issue("rate_limited_while_priority_speed_low", "critical", { restQuoteRateLimited, collectorRateLimited, collectorPriorityOnly, collector429WindowCount, priorityFreshQuoteCoverage120 }));
  if (cooldownRemainingSeconds > 0) issues.push(issue("daytrade_rate_limit_cooldown_active", "critical", { cooldownUntil, cooldownRemainingSeconds }));
  if (last429AgeSeconds <= RECENT_429_BLOCK_SECONDS) issues.push(issue("daytrade_recent_429_blocks_a", "critical", { last429At, last429AgeSeconds, blockSeconds: RECENT_429_BLOCK_SECONDS }));
  if (after0845 && fullMarketBatchIntervalSeconds > 0 && fullMarketBatchIntervalSeconds < 3.2) warnings.push(issue("full_market_batch_interval_too_aggressive", "warning", { fullMarketBatchIntervalSeconds, minRecommended: 3.2, note: "Do not let full market compete with priority pool during opening." }));
  if (after0845 && fullMarketRoundSeconds > FULL_MARKET_MAX_ROUND_SECONDS && fullMarketRoundSeconds < 999999) warnings.push(issue("full_market_round_slow_but_nonblocking", "warning", { fullMarketRoundSeconds, target: `<=${FULL_MARKET_MAX_ROUND_SECONDS}`, note: "This is acceptable only if priority pool remains ready." }));
  if (!dedicatedSourceFullMarketSpeedFeasible) warnings.push(issue("dedicated_daytrade_source_rpm_below_target_math", "warning", { collectorAdaptiveRpm, requiredRpmFor1500In120s: requiredRpm, gapRpm: collectorRpmGap, note: "Dedicated daytrade source must use its own quota/key/table or a strict priority pool; do not borrow the shared display source." }));
  if (!sourceIsolationAudit.ok) issues.push(issue("daytrade_source_isolation_violation", "critical", sourceIsolationAudit));

  const aReady = sourceAge <= MAX_SOURCE_AGE_SECONDS
    && sourceStatus === "ok"
    && gateMode === "priority_first"
    && quoteAgeSeconds <= MAX_QUOTE_AGE_SECONDS
    && prioritySymbols >= MIN_PRIORITY_SYMBOLS
    && priorityPoolSymbols >= MIN_PRIORITY_POOL_SYMBOLS
    && priorityFreshQuoteCoverage120 >= MIN_PRIORITY_FRESH_QUOTE_COVERAGE
    && selectedSymbolsFreshOk
    && cooldownRemainingSeconds <= 0
    && last429AgeSeconds > RECENT_429_BLOCK_SECONDS
    && (!after0830 || dailyVolumeStatus === "ready")
    && (!after0845 || scannerCanRunOpening)
    && (!after0845 || readyMa20 >= MIN_READY_MA20_CONTINUOUS)
    && (!after0845 || readyMa35 >= MIN_READY_MA35_CONTINUOUS)
    && (!after0845 || futoptMapped >= MIN_FUTOPT_MAPPED)
    && (!after0900 || intraday1mStaleSeconds <= MAX_INTRADAY_1M_STALE_SECONDS);
  const bObserve = !aReady
    && sourceAge <= 180
    && quoteAgeSeconds <= OBSERVATION_MAX_QUOTE_AGE_SECONDS
    && prioritySymbols >= MIN_PRIORITY_SYMBOLS
    && (priorityFreshQuoteCoverage120 >= 0.5 || priorityFreshQuotes120 >= 150 || freshQuoteCoverage120 >= 0.5 || freshQuotes120 >= 500)
    && (readyMa20 > 0 || !after0845)
    && (readyMa35 > 0 || !after0845);
  const cDisplay = !aReady && !bObserve && sourceAge <= 300 && quoteAgeSeconds <= 300 && quotes > 0;

  const computedGateGrade = aReady ? "A" : bObserve ? "B" : cDisplay ? "C" : "D";
  const sourceStatusGateGrade = sourceStatus === "ok" ? "A" : ["degraded", "stale"].includes(sourceStatus) ? "C" : "D";
  const computedPriorityGateGrade = aReady ? "A" : bObserve ? "B" : "D";
  const computedFullMarketGateGrade = freshQuoteCoverage120 >= MIN_FRESH_QUOTE_COVERAGE && freshQuotes120 >= TARGET_FRESH_QUOTES && fullMarketRoundSeconds <= FULL_MARKET_MAX_ROUND_SECONDS ? "A" : "C";
  const writerGateForFinal = writerGateGrade || "D";
  const writerPriorityGateForFinal = writerPriorityGateGrade || computedPriorityGateGrade;
  const speedGateForFinal = daytradeSourceSpeedOk ? "A" : "D";
  const payloadGateForFinal = missingPayloadFields.length === 0 ? "A" : "D";
  const gateGrade = getWorstGateGrade([computedPriorityGateGrade, sourceStatusGateGrade, writerGateForFinal, writerPriorityGateForFinal, speedGateForFinal, payloadGateForFinal]);
  if (writerGateGrade === "A" && computedGateGrade !== "A") {
    issues.push(issue("writer_gate_grade_a_but_evidence_not_a", "critical", { writerGateGrade, computedGateGrade }));
  }

  const result = {
    ok: gateGrade === "A",
    gateGrade,
    writerGateGrade,
    computedGateGrade,
    computedPriorityGateGrade,
    computedFullMarketGateGrade,
    sourceStatusGateGrade,
    gateMode,
    openingPriorityFirstWindow,
    formalEntryAllowed: gateGrade === "A" && formalWindow,
    observationOnly: ["B", "C"].includes(gateGrade),
    stopNewSignals: gateGrade === "D",
    phase,
    mode: "read-only",
    report: "dedicated-daytrade-source-speed",
    sourceIsolation: "dedicated",
    sourceIsolationAudit,
    scope: "dedicated daytrade source speed gate only; not shared display source YES and not production unattended YES",
    checkedAt: new Date().toISOString(),
    scannerContract: {
      loopSeconds: 5,
      prefilterCount: 180,
      fastTrackCount: 40,
      deepScanCount: 60,
      barsPerSymbol: 80,
      formalEntryRule: "formal entry only when gateGrade=A",
      degradedRule: "source insufficient => observation/display only; no formal entry",
      fugleFallbackAllowed: false,
      bulkFallbackAllowed: false,
      writerAllowed: false,
    },
    speedMath: {
      windowSeconds: WINDOW_SECONDS,
      payloadFreshQuoteWindowSeconds: freshQuoteWindowSeconds,
      targetFreshQuotes: TARGET_FRESH_QUOTES,
      requiredSymbolsPerSecond,
      payloadRequiredQuoteSpeedPerSec: requiredQuoteSpeedPerSecPayload,
      payloadActualQuoteSpeedPerSec: actualQuoteSpeedPerSecPayload,
      requiredRpm,
      assumedBatchSize: ASSUMED_BATCH_SIZE,
      payloadBatchSize: batchSizePayload,
      maxBatchIntervalSeconds,
      payloadBatchIntervalSeconds: batchIntervalSecondsPayload,
      measuredFreshQuotes120: freshQuotes120,
      measuredSymbolsPerSecond,
      measuredBatchIntervalSeconds,
      freshQuoteGap,
      freshRateGapPerSecond,
      collectorAdaptiveRpm,
      collectorRpmGap,
      dedicatedSourceFullMarketSpeedFeasible,
      fullMarketRoundSeconds,
      fullMarketTargetRoundSeconds: "120-180",
      priorityPoolTargetSymbols: "300-500",
      priorityFreshCoverageMinForA: MIN_PRIORITY_FRESH_QUOTE_COVERAGE,
      priorityFreshCoverageTarget: TARGET_PRIORITY_FRESH_QUOTE_COVERAGE,
      fullMarketBlocksA: false,
    },
    issues,
    warnings,
    evidence: {
      sourceName: SOURCE_NAME,
      sourceStatus,
      sourceUpdatedAt: stringValue(row.updated_at),
      sourceAgeSeconds: sourceAge,
      message: stringValue(row.message),
      daytradeGateGrade: writerGateGrade,
      priorityGateGrade: writerPriorityGateGrade,
      fullMarketGateGrade: writerFullMarketGateGrade,
      selectedSymbolsFreshOk,
      daytradeSourceSpeedOk,
      missingPayloadFields,
      activeSymbols,
      motherPoolSymbols,
      quotes,
      freshQuotes120s: freshQuotes120,
      freshQuoteCoverage120s: freshQuoteCoverage120,
      quoteAgeSeconds,
      eligibleQuoteRows,
      lastQuoteAt,
      prioritySymbols,
      priorityPoolSymbols,
      priorityFreshQuotes120s: priorityFreshQuotes120,
      priorityFreshQuoteCoverage120s: priorityFreshQuoteCoverage120,
      terminalPrioritySymbols,
      strategyPrioritySymbols,
      openingPrioritySymbols,
      dailyVolumeStatus,
      dailyVolumeRows,
      avgVolume5Eligible,
      scannerCanRunQuoteOnly,
      scannerCanRunOpening,
      scannerBlockReason,
      intraday1mStatus,
      intraday1mStaleSeconds,
      today1mSymbols,
      today1mRows,
      readyMa20Continuous: readyMa20,
      readyMa35Continuous: readyMa35,
      futoptStockMapped: futoptMapped,
      futoptStockThisLoop: futoptThisLoop,
      openingBoostActive,
      restQuoteRateLimited,
      collectorRateLimited,
      collectorPriorityOnly,
      rateLimitStatus,
      last429At,
      last429AgeSeconds,
      cooldownUntil,
      cooldownRemainingSeconds,
      fullMarketRoundSeconds,
      fullMarketBatchIntervalSeconds,
      fullMarketPausedUntil,
      finmindCooldownUntil,
      quotaCompetingStages,
      selfHealCount,
      lastSelfHealAt,
      lastSelfHealReason,
      collectorAdaptiveDelayMs,
      collector429WindowCount,
    },
  };

  if (!JSON_ONLY) {
    console.log(`[dedicated-daytrade-source-speed] source=${SOURCE_NAME} grade=${gateGrade} phase=${phase} formalEntryAllowed=${result.formalEntryAllowed} fresh=${freshQuotes120}/${TARGET_FRESH_QUOTES} coverage=${freshQuoteCoverage120} quoteAge=${quoteAgeSeconds}s required=${requiredSymbolsPerSecond}sym/s batch${ASSUMED_BATCH_SIZE}<=${maxBatchIntervalSeconds}s`);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = gateGrade === "A" ? 0 : ["B", "C"].includes(gateGrade) ? 1 : 2;
}

main().catch((error) => {
  console.error(`[dedicated-daytrade-source-speed] failed: ${error.message}`);
  process.exitCode = 2;
});
