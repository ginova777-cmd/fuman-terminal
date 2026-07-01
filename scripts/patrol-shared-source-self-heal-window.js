const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";

function argValue(name, fallback = "") {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function flag(name) {
  return process.argv.includes(name);
}

function readSecret(name) {
  for (const file of [
    path.join(RUNTIME_DIR, "secrets", name),
    path.join(ROOT, "secrets", name),
  ]) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function numberValue(value, fallback = 0) {
  const number = Number(String(value ?? "").replace(/[,%]/g, "").trim());
  return Number.isFinite(number) ? number : fallback;
}

function boolValue(value) {
  if (value === true) return true;
  if (value === false) return false;
  return /^(1|true|yes|ok|ready)$/i.test(String(value ?? "").trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function taipeiClock(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    text: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function isRegularSession(clock = taipeiClock()) {
  const minutes = clock.hour * 60 + clock.minute;
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 35;
}

async function restGet(pathAndQuery) {
  const baseUrl = process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || process.env.FUMAN_SUPABASE_URL
    || "https://cpmpfhbzutkiecccekfr.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || readSecret("supabase-service-role-key.txt")
    || readSecret("supabase-anon-key.txt");
  if (!key) throw new Error("missing Supabase key");
  const url = `${baseUrl.replace(/\/$/, "")}/rest/v1/${pathAndQuery}`;
  const response = await fetch(url, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  return JSON.parse(text);
}

function normalizeSourceStatus(row) {
  const payload = row?.payload || {};
  const activeSymbols = numberValue(payload.active_symbols ?? payload.seeded_symbols ?? payload.symbols);
  const today1mSymbols = numberValue(payload.today_1m_symbols ?? payload.intraday_1m_symbols_today);
  const readyGe35 = numberValue(payload.ready_ge_35_symbols ?? payload.ready_ge_35 ?? payload.ready_ma35_continuous_symbols);
  const freshQuoteCoverage = numberValue(payload.fresh_quote_coverage_120s ?? payload.eligible_quote_coverage);
  const intraday1mStaleSeconds = numberValue(payload.intraday_1m_stale_seconds, 999999);
  const quoteAgeSeconds = numberValue(payload.quote_age_seconds, 999999);
  return {
    sourceName: row?.source_name || "",
    status: row?.status || "",
    updatedAt: row?.updated_at || "",
    message: row?.message || "",
    activeSymbols,
    quoteAgeSeconds,
    freshQuoteCoverage120s: freshQuoteCoverage,
    today1mSymbols,
    today1mCoverage: activeSymbols > 0 ? today1mSymbols / activeSymbols : 0,
    readyGe35,
    readyGe35Coverage: activeSymbols > 0 ? readyGe35 / activeSymbols : 0,
    intraday1mStaleSeconds,
    intraday1mStatus: payload.intraday_1m_status || "",
    scannerCanRunMa35: boolValue(payload.scanner_can_run_ma35),
    scannerCanRunFullIntraday: boolValue(payload.scanner_can_run_full_intraday),
    scannerBlockReason: payload.scanner_block_reason || "",
    selfHealEnabled: boolValue(payload.intraday_1m_self_heal_enabled),
    selfHealTriggered: boolValue(payload.intraday_1m_self_heal_triggered),
    selfHealReason: payload.intraday_1m_self_heal_reason || "",
    selfHealRows: numberValue(payload.intraday_1m_self_heal_rows),
    selfHealThresholdSeconds: numberValue(payload.intraday_1m_self_heal_threshold_seconds),
    selfHealCooldownSeconds: numberValue(payload.intraday_1m_self_heal_cooldown_seconds),
    statsSource: payload.intraday_1m_stats_source || "",
  };
}

function evaluateSample(sample, options) {
  const issues = [];
  const warnings = [];
  const regular = sample.regularSession;

  if (!sample.sourceName) issues.push({ code: "source_status_missing" });
  if (!sample.selfHealEnabled) issues.push({ code: "self_heal_not_enabled" });
  if (!sample.selfHealThresholdSeconds || sample.selfHealThresholdSeconds > options.maxSelfHealThresholdSeconds) {
    issues.push({ code: "self_heal_threshold_too_loose", value: sample.selfHealThresholdSeconds });
  }

  if (!regular) {
    if (sample.intraday1mStaleSeconds > options.maxIntraday1mStaleSeconds) {
      warnings.push({ code: "off_session_intraday_1m_stale", value: sample.intraday1mStaleSeconds });
    }
    return { issues, warnings };
  }

  if (!["ok", "ready"].includes(String(sample.intraday1mStatus).toLowerCase())) {
    issues.push({ code: "intraday_1m_status_not_ok", value: sample.intraday1mStatus });
  }
  if (String(sample.status).toLowerCase() !== "ok" && !sample.scannerCanRunMa35) {
    issues.push({ code: "source_status_not_ok_for_ma35", status: sample.status, scannerBlockReason: sample.scannerBlockReason });
  }
  if (sample.quoteAgeSeconds > options.maxQuoteAgeSeconds) {
    issues.push({ code: "quote_age_over_limit", value: sample.quoteAgeSeconds, max: options.maxQuoteAgeSeconds });
  }
  if (sample.freshQuoteCoverage120s < options.minFreshQuoteCoverage120s) {
    issues.push({ code: "fresh_quote_coverage_low", value: sample.freshQuoteCoverage120s, min: options.minFreshQuoteCoverage120s });
  }
  if (sample.intraday1mStaleSeconds > options.maxIntraday1mStaleSeconds) {
    issues.push({ code: "intraday_1m_stale_over_limit", value: sample.intraday1mStaleSeconds, max: options.maxIntraday1mStaleSeconds });
  }
  if (sample.today1mCoverage < options.minToday1mCoverage) {
    issues.push({ code: "today_1m_coverage_low", value: sample.today1mCoverage, min: options.minToday1mCoverage, today1mSymbols: sample.today1mSymbols, activeSymbols: sample.activeSymbols });
  }
  if (sample.readyGe35Coverage < options.minReadyGe35Coverage) {
    issues.push({ code: "ready_ge35_coverage_low", value: sample.readyGe35Coverage, min: options.minReadyGe35Coverage, readyGe35: sample.readyGe35, activeSymbols: sample.activeSymbols });
  }
  if (!sample.scannerCanRunMa35) {
    issues.push({ code: "scanner_can_run_ma35_false", scannerBlockReason: sample.scannerBlockReason });
  }

  return { issues, warnings };
}

function aggregate(samples) {
  return {
    samples: samples.length,
    regularSamples: samples.filter((sample) => sample.regularSession).length,
    minFreshQuoteCoverage120s: Math.min(...samples.map((sample) => sample.freshQuoteCoverage120s)),
    minToday1mCoverage: Math.min(...samples.map((sample) => sample.today1mCoverage)),
    minReadyGe35Coverage: Math.min(...samples.map((sample) => sample.readyGe35Coverage)),
    maxIntraday1mStaleSeconds: Math.max(...samples.map((sample) => sample.intraday1mStaleSeconds)),
    maxQuoteAgeSeconds: Math.max(...samples.map((sample) => sample.quoteAgeSeconds)),
    selfHealTriggeredSamples: samples.filter((sample) => sample.selfHealTriggered).length,
    latestSelfHealReason: [...samples].reverse().find((sample) => sample.selfHealReason)?.selfHealReason || "",
  };
}

async function collectOne(index, options) {
  const rows = await restGet("source_status?source_name=eq.fugle_shared_source&select=source_name,status,updated_at,message,payload&limit=1");
  const row = Array.isArray(rows) ? rows[0] : null;
  const clock = taipeiClock();
  const normalized = normalizeSourceStatus(row);
  const sample = {
    index,
    checkedAt: new Date().toISOString(),
    clockTaipei: clock.text,
    regularSession: isRegularSession(clock),
    ...normalized,
  };
  const verdict = evaluateSample(sample, options);
  return { ...sample, issues: verdict.issues, warnings: verdict.warnings };
}

async function main() {
  const options = {
    samples: Math.max(1, Number(argValue("--samples", "1")) || 1),
    intervalMs: Math.max(0, Number(argValue("--interval-ms", "0")) || 0),
    requireRegular: flag("--require-regular"),
    minFreshQuoteCoverage120s: Number(argValue("--min-fresh-quote-coverage", "0.9")) || 0.9,
    minToday1mCoverage: Number(argValue("--min-today-1m-coverage", "0.95")) || 0.95,
    minReadyGe35Coverage: Number(argValue("--min-ready-ge35-coverage", "0.95")) || 0.95,
    maxIntraday1mStaleSeconds: Number(argValue("--max-1m-stale-seconds", "120")) || 120,
    maxQuoteAgeSeconds: Number(argValue("--max-quote-age-seconds", "120")) || 120,
    maxSelfHealThresholdSeconds: Number(argValue("--max-self-heal-threshold-seconds", "75")) || 75,
  };

  const samples = [];
  for (let index = 0; index < options.samples; index += 1) {
    samples.push(await collectOne(index + 1, options));
    if (index < options.samples - 1 && options.intervalMs > 0) await sleep(options.intervalMs);
  }

  const blockers = samples.flatMap((sample) => sample.issues.map((issue) => ({ sample: sample.index, ...issue })));
  const warnings = samples.flatMap((sample) => sample.warnings.map((warning) => ({ sample: sample.index, ...warning })));
  const summary = aggregate(samples);
  if (options.requireRegular && summary.regularSamples === 0) {
    blockers.push({ code: "no_regular_session_samples", detail: "run during 09:00-13:35 Asia/Taipei or remove --require-regular" });
  }

  const result = {
    ok: blockers.length === 0,
    unattendedScope: "shared_source_intraday_1m_market_window_patrol",
    options,
    summary,
    blockers,
    warnings,
    samples,
    checkedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    unattendedScope: "shared_source_intraday_1m_market_window_patrol",
    error: error?.message || String(error),
    checkedAt: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
});
