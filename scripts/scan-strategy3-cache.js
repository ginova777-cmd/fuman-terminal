const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { fetchMisQuotes } = require("../lib/mis-quotes");
const {
  fetchStrategy3CapitalMap,
  fetchStrategy3Intraday1mStatus,
  fetchStrategy3Intraday1mLatestN,
  fetchStrategy3LiveSideVolumeMap,
  fetchStrategy3QuoteLatestReady,
  fetchStrategy3QuoteReady,
  verifyStrategy3ReadAccess,
} = require("../lib/supabase-public-slot");
const {
  chipTradeExclusion,
  loadChipTradeBlacklist,
} = require("../lib/chip-trade-exclusions");
const { publishStrategyCacheStatus } = require("../lib/strategy-cache-status");
const { upsertSnapshot } = require("../lib/supabase-snapshots");
const { fetchStrategy3TvCandles } = require("../lib/strategy3-tv-candles");
const { analyzeTradingViewOvernightEntry } = require("../lib/strategy3-tv-entry");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(ROOT, "data");
const OUT_FILE = path.join(DATA_DIR, "strategy3-latest.json");
const BACKUP_FILE = path.join(DATA_DIR, "strategy3-backup.json");
const SCORECARD_SOURCE_FILE = path.join(DATA_DIR, "strategy3-scorecard-source.json");
const STRATEGY3_NOTIFICATION_RECEIPT_FILE = path.join(DATA_DIR, "scan-receipts", "strategy3-notification-receipts.json");
const CHIP_EXCLUSIONS_FILE = path.join(DATA_DIR, "chip-trade-exclusions.json");
const STOCK_URL = process.env.STOCK_UNIVERSE_URL || "https://fuman-terminal.vercel.app/api/stocks";
const CAPITAL_URLS = [
  "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv",
  "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv",
];
const SOURCE_WARNING_LIMIT = Number(process.env.STRATEGY3_SOURCE_WARNING_LIMIT || 3);
const MIN_ISSUED_SHARES_COUNT = Number(process.env.STRATEGY3_MIN_ISSUED_SHARES_COUNT || 1000);
const MIN_VOLUME_AVERAGE_COUNT = Number(process.env.STRATEGY3_MIN_VOLUME_AVERAGE_COUNT || 1000);
const STRATEGY3_REQUIRE_TV_ENTRY = process.env.STRATEGY3_REQUIRE_TV_ENTRY !== "0";
const STRATEGY3_TV_CANDIDATE_LIMIT = Number(process.env.STRATEGY3_TV_CANDIDATE_LIMIT || 0);
const STRATEGY3_TV_CANDLE_LIMIT = Number(process.env.STRATEGY3_TV_CANDLE_LIMIT || 160);
const STRATEGY3_TV_CONCURRENCY = Number(process.env.STRATEGY3_TV_CONCURRENCY || 8);
const STRATEGY3_1M_READBACK_LIMIT = Number(process.env.STRATEGY3_1M_READBACK_LIMIT || 360);
const STRATEGY3_1M_READBACK_CONCURRENCY = Number(process.env.STRATEGY3_1M_READBACK_CONCURRENCY || 8);
const STRATEGY3_REQUIRE_TURNOVER = process.env.STRATEGY3_REQUIRE_TURNOVER === "1";
const STRATEGY3_REQUIRE_VOLUME_AVERAGE = process.env.STRATEGY3_REQUIRE_VOLUME_AVERAGE === "1";
const STRATEGY3_USE_SUPABASE = process.env.STRATEGY3_USE_SUPABASE !== "0";
const STRATEGY3_REQUIRE_AFTER_1300 = process.env.STRATEGY3_REQUIRE_AFTER_1300 !== "0";
const STRATEGY3_MIN_AFTER_1300_CANDIDATES = Number(process.env.STRATEGY3_MIN_AFTER_1300_CANDIDATES || 20);
const STRATEGY3_APPLY_BLACKLIST = process.env.STRATEGY3_APPLY_BLACKLIST !== "0";
const STRATEGY3_MIN_CHANGE_PERCENT = Number(process.env.STRATEGY3_MIN_CHANGE_PERCENT || 3);
const STRATEGY3_MAX_CHANGE_PERCENT = Number(process.env.STRATEGY3_MAX_CHANGE_PERCENT || 5);
const STRATEGY3_MIN_VOLUME_RATIO = Number(process.env.STRATEGY3_MIN_VOLUME_RATIO || 1);
const STRATEGY3_MIN_TRADE_VOLUME_LOTS = Number(process.env.STRATEGY3_MIN_TRADE_VOLUME_LOTS || 0);
const STRATEGY3_REQUIRE_OUTSIDE_GT_INSIDE = process.env.STRATEGY3_REQUIRE_OUTSIDE_GT_INSIDE !== "0";
const STRATEGY3_REQUIRE_NEAR_100_HIGH = process.env.STRATEGY3_REQUIRE_NEAR_100_HIGH === "1";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || (() => { try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"), "utf8").trim(); } catch { return ""; } })();
const SYNC_SUPABASE_RESULTS = process.env.STRATEGY3_SYNC_SUPABASE_RESULTS !== "0";
const SUPABASE_RESULTS_TABLE = process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results";
const SUPABASE_RUNS_TABLE = process.env.STRATEGY3_SUPABASE_RUNS_TABLE || "strategy3_scan_runs";
const STRATEGY3_API_ONLY = true;
const SUPABASE_RESULTS_ATTEMPTS = Math.max(1, Number(process.env.STRATEGY3_SUPABASE_RESULTS_ATTEMPTS || 3));
const STRATEGY3_NO_TV_PASS_REASON = "資源已就緒；硬門檻後 TradingView 隔日沖條件本輪 0 檔通過";
const STRATEGY3_MIN_FIELD_GATE_CANDIDATES = Number(process.env.STRATEGY3_MIN_FIELD_GATE_CANDIDATES || 12);
const STRATEGY3_DRIFT_MIN_QUOTE_ROWS = Number(process.env.STRATEGY3_DRIFT_MIN_QUOTE_ROWS || 1000);
const STRATEGY3_DRIFT_MIN_SNAPSHOT_ROWS = Number(process.env.STRATEGY3_DRIFT_MIN_SNAPSHOT_ROWS || 1000);
const STRATEGY3_DRIFT_MIN_FUGLE_ROWS = Number(process.env.STRATEGY3_DRIFT_MIN_FUGLE_ROWS || 1000);
const STRATEGY3_DRIFT_MIN_DAILY_VOLUME_ROWS = Number(process.env.STRATEGY3_DRIFT_MIN_DAILY_VOLUME_ROWS || 1000);
const STRATEGY3_NOTIFICATION_DISABLED = process.env.STRATEGY3_NOTIFICATION_DISABLED === "1";
const STRATEGY3_NOTIFICATION_MAX_SYMBOLS = Number(process.env.STRATEGY3_NOTIFICATION_MAX_SYMBOLS || 12);
const STRATEGY3_NOTIFICATION_REQUIRE_1300_WINDOW = process.env.STRATEGY3_NOTIFICATION_REQUIRE_1300_WINDOW !== "0";
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function preserveScorecardSource(payload) {
  if (!(payload.matches || []).length) return;
  fs.mkdirSync(path.dirname(SCORECARD_SOURCE_FILE), { recursive: true });
  fs.writeFileSync(SCORECARD_SOURCE_FILE, `${JSON.stringify({
    ...payload,
    source: "strategy3-scorecard-source",
    preservedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function buildSourceHealth(stocks, issuedSharesMap, volumeAverageMap, sourceWarnings, exclusionStats = {}) {
  const issues = [];
  const warnings = [];
  const after1300Count = cleanNumber(exclusionStats.resourceAfter1300Count)
    || stocks.filter((stock) => stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0).length;
  if (STRATEGY3_REQUIRE_TURNOVER && issuedSharesMap.size < MIN_ISSUED_SHARES_COUNT) {
    issues.push(`issuedSharesCount ${issuedSharesMap.size} below ${MIN_ISSUED_SHARES_COUNT}`);
  } else if (issuedSharesMap.size < MIN_ISSUED_SHARES_COUNT) {
    warnings.push(`issuedSharesCount ${issuedSharesMap.size} below ${MIN_ISSUED_SHARES_COUNT}; turnover filter disabled until stock_capital_latest is populated`);
  }
  if (STRATEGY3_REQUIRE_VOLUME_AVERAGE && volumeAverageMap.size < MIN_VOLUME_AVERAGE_COUNT) {
    issues.push(`volumeAverageCount ${volumeAverageMap.size} below ${MIN_VOLUME_AVERAGE_COUNT}`);
  } else if (volumeAverageMap.size < MIN_VOLUME_AVERAGE_COUNT) {
    warnings.push(`volumeAverageCount ${volumeAverageMap.size} below ${MIN_VOLUME_AVERAGE_COUNT}; volume ratio is advisory for TV-only strategy3`);
  }
  if (STRATEGY3_REQUIRE_AFTER_1300 && after1300Count < STRATEGY3_MIN_AFTER_1300_CANDIDATES) {
    issues.push(`after1300ReadyCount ${after1300Count} below ${STRATEGY3_MIN_AFTER_1300_CANDIDATES}`);
  }
  const warningCount = sourceWarnings.length + warnings.length;
  if (warningCount > SOURCE_WARNING_LIMIT) {
    issues.push(`warningCount ${warningCount} above ${SOURCE_WARNING_LIMIT}`);
  }
  return {
    status: issues.length ? "failed" : "ok",
    issuedSharesCount: issuedSharesMap.size,
    volumeAverageCount: volumeAverageMap.size,
    stockUniverseCount: stocks.length,
    after1300ReadyCount: after1300Count,
    exclusionStats,
    warningCount,
    warningLimit: SOURCE_WARNING_LIMIT,
    minIssuedSharesCount: MIN_ISSUED_SHARES_COUNT,
    minVolumeAverageCount: MIN_VOLUME_AVERAGE_COUNT,
    minAfter1300Candidates: STRATEGY3_MIN_AFTER_1300_CANDIDATES,
    requireTurnover: STRATEGY3_REQUIRE_TURNOVER,
    requireVolumeAverage: STRATEGY3_REQUIRE_VOLUME_AVERAGE,
    requireAfter1300: STRATEGY3_REQUIRE_AFTER_1300,
    issues,
    warnings,
  };
}

function loadStrategy3Blacklist() {
  const codes = loadChipTradeBlacklist();
  const generated = readJson(CHIP_EXCLUSIONS_FILE, {});
  (generated.blacklistCodes || []).map(normalizeCode).filter(Boolean).forEach((code) => codes.add(code));
  return codes;
}

function applyStrategy3Exclusions(stocks, blacklistCodes) {
  if (!STRATEGY3_APPLY_BLACKLIST) {
    return { stocks, stats: { enabled: false, input: stocks.length, excluded: 0, kept: stocks.length, byReason: {} } };
  }
  const byReason = {};
  const examples = [];
  const kept = [];
  for (const stock of stocks) {
    const exclusion = chipTradeExclusion({
      ...stock,
      tradeVolume: stock.tradeVolume,
      is_blacklisted: stock.is_blacklisted ?? stock.isBlacklisted,
      is_daytrade_unsuitable: stock.is_daytrade_unsuitable ?? stock.isDaytradeUnsuitable,
      is_halted: stock.is_halted ?? stock.isHalted,
      is_trial: stock.is_trial ?? stock.isTrial,
    }, blacklistCodes);
    if (!exclusion.excluded) {
      kept.push(stock);
      continue;
    }
    exclusion.reasons.forEach((reason) => {
      byReason[reason] = (byReason[reason] || 0) + 1;
    });
    if (examples.length < 40) examples.push({ code: stock.code, name: stock.name, reasons: exclusion.reasons });
  }
  return {
    stocks: kept,
    stats: {
      enabled: true,
      input: stocks.length,
      excluded: stocks.length - kept.length,
      kept: kept.length,
      byReason,
      examples,
    },
  };
}

function sourceDate(payload) {
  return String(payload?.usedDate || payload?.date || payload?.quoteDate || "").replace(/\D/g, "");
}

function taipeiDateKeyFromValue(value) {
  const text = String(value || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(parsed));
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${get("year")}${get("month")}${get("day")}`;
  }
  const compact = text.replace(/\D/g, "");
  return compact.length >= 8 ? compact.slice(0, 8) : "";
}

function latestStockDateKey(stocks) {
  return [...new Set((stocks || []).flatMap((stock) => [
    taipeiDateKeyFromValue(stock.quoteDate),
    taipeiDateKeyFromValue(stock.latestCandleTime),
    taipeiDateKeyFromValue(stock.updatedAt),
    taipeiDateKeyFromValue(stock.quoteTimeRaw),
  ]).filter((dateKey) => /^\d{8}$/.test(dateKey)))]
    .sort()
    .at(-1) || "";
}

function preservePreviousTradingSource(previousPayload, currentPayload) {
  const previousDate = sourceDate(previousPayload);
  const currentDate = sourceDate(currentPayload);
  if (!(previousPayload.matches || []).length) return;
  if (!/^\d{8}$/.test(previousDate) || !/^\d{8}$/.test(currentDate)) return;
  if (previousDate >= currentDate) return;
  preserveScorecardSource(previousPayload);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function buildSupabaseHeaders(preferCount = false) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (preferCount) headers.Prefer = "count=exact";
  return headers;
}

async function fetchSupabaseRest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("missing Supabase service credentials");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
      headers: buildSupabaseHeaders(Boolean(options.count)),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 240)}`);
    const range = response.headers.get("content-range") || "";
    const exactCount = range.includes("/") ? Number(range.split("/").pop()) : null;
    return { rows: text ? JSON.parse(text) : [], exactCount };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStrategy3SourceDriftHealth() {
  const checks = [];
  const add = (item) => checks.push(item);
  try {
    const result = await fetchSupabaseRest("v_strategy3_quote_ready?select=symbol&limit=1", { count: true });
    add({ source: "v_strategy3_quote_ready", rowCount: cleanNumber(result.exactCount), minRequired: STRATEGY3_DRIFT_MIN_QUOTE_ROWS, status: cleanNumber(result.exactCount) >= STRATEGY3_DRIFT_MIN_QUOTE_ROWS ? "ready" : "failed" });
  } catch (error) {
    add({ source: "v_strategy3_quote_ready", rowCount: 0, minRequired: STRATEGY3_DRIFT_MIN_QUOTE_ROWS, status: "failed", reason: error?.message || String(error) });
  }
  try {
    const result = await fetchSupabaseRest("strategy3_ready_snapshot?select=symbol&limit=1", { count: true });
    add({ source: "strategy3_ready_snapshot", rowCount: cleanNumber(result.exactCount), minRequired: STRATEGY3_DRIFT_MIN_SNAPSHOT_ROWS, status: cleanNumber(result.exactCount) >= STRATEGY3_DRIFT_MIN_SNAPSHOT_ROWS ? "ready" : "failed" });
  } catch (error) {
    add({ source: "strategy3_ready_snapshot", rowCount: 0, minRequired: STRATEGY3_DRIFT_MIN_SNAPSHOT_ROWS, status: "failed", reason: error?.message || String(error) });
  }
  try {
    const result = await fetchSupabaseRest("fugle_quotes_latest?select=symbol&limit=1", { count: true });
    add({ source: "fugle_quotes_latest", rowCount: cleanNumber(result.exactCount), minRequired: STRATEGY3_DRIFT_MIN_FUGLE_ROWS, status: cleanNumber(result.exactCount) >= STRATEGY3_DRIFT_MIN_FUGLE_ROWS ? "ready" : "failed" });
  } catch (error) {
    add({ source: "fugle_quotes_latest", rowCount: 0, minRequired: STRATEGY3_DRIFT_MIN_FUGLE_ROWS, status: "failed", reason: error?.message || String(error) });
  }
  try {
    const result = await fetchSupabaseRest("stock_daily_volume?select=trade_date&order=trade_date.desc&limit=1", { count: true });
    const latestDate = String(result.rows?.[0]?.trade_date || "");
    add({ source: "stock_daily_volume", rowCount: cleanNumber(result.exactCount), latestDate, minRequired: STRATEGY3_DRIFT_MIN_DAILY_VOLUME_ROWS, status: cleanNumber(result.exactCount) >= STRATEGY3_DRIFT_MIN_DAILY_VOLUME_ROWS && latestDate ? "ready" : "failed" });
  } catch (error) {
    add({ source: "stock_daily_volume", rowCount: 0, minRequired: STRATEGY3_DRIFT_MIN_DAILY_VOLUME_ROWS, status: "failed", reason: error?.message || String(error) });
  }
  const failed = checks.filter((item) => item.status !== "ready");
  return {
    status: failed.length ? "failed" : "ready",
    checks,
    reason: failed.length
      ? failed.map((item) => `${item.source} rows=${item.rowCount}/${item.minRequired}${item.reason ? ` ${item.reason}` : ""}`).join("; ")
      : "strategy3 source counts ready",
  };
}

function validateStrategy3PrePublish(output) {
  const issues = [];
  const matches = Array.isArray(output.matches) ? output.matches : [];
  const fieldGateCount = matches.length;
  const tvPassCount = cleanNumber(output.tvPassCount);
  if (output.sourceHealth?.status === "failed") issues.push(`sourceHealth failed: ${(output.sourceHealth.issues || []).join("; ")}`);
  if (output.sourceDriftHealth?.status !== "ready") issues.push(`sourceDrift ${output.sourceDriftHealth?.status || "missing"}: ${output.sourceDriftHealth?.reason || ""}`);
  if (fieldGateCount < STRATEGY3_MIN_FIELD_GATE_CANDIDATES) issues.push(`fieldGateReadyCount ${fieldGateCount}<${STRATEGY3_MIN_FIELD_GATE_CANDIDATES}`);
  if (!Object.prototype.hasOwnProperty.call(output, "tvPassCount")) issues.push("missing tvPassCount");
  if (!matches.every((stock) => stock && stock.tvOvernightEntry && typeof stock.tvOvernightEntry.ok === "boolean")) issues.push("missing per-row tvOvernightEntry breakdown");
  return { ok: issues.length === 0, fieldGateReadyCount: fieldGateCount, expectedFieldGateReadyCount: STRATEGY3_MIN_FIELD_GATE_CANDIDATES, tvPassCount, issues };
}

async function verifyStrategy3PublishedRun(expectedRunId, expectedCount) {
  const table = encodeURIComponent(SUPABASE_RESULTS_TABLE);
  const runId = encodeURIComponent(expectedRunId);
  const result = await fetchSupabaseRest(`${table}?select=code,name,payload&run_id=eq.${runId}&strategy=eq.strategy3&limit=80`, { count: true, timeoutMs: 25000 });
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const tvPassCount = rows.filter((row) => row?.payload?.tvOk === true || row?.payload?.tvFlame === true || row?.payload?.tvOvernightEntry?.ok === true).length;
  const missingBreakdown = rows.filter((row) => !row?.payload?.tvBreakdown && !row?.payload?.tvOvernightEntry).length;
  return { ok: rows.length === expectedCount && missingBreakdown === 0, runId: expectedRunId, count: rows.length, expectedCount, tvPassCount, missingBreakdown };
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scanDateFromOutput(output) {
  const stamp = String(output.usedDate || output.date || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(stamp)) return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  const updatedAt = String(output.updatedAt || "");
  return /^\d{4}-\d{2}-\d{2}/.test(updatedAt) ? updatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function strategy3RunIdFromOutput(output) {
  const scanDate = scanDateFromOutput(output).replace(/-/g, "");
  const stamp = Date.parse(String(output.updatedAt || ""));
  const time = Number.isFinite(stamp)
    ? new Date(stamp).toISOString().replace(/\D/g, "").slice(0, 14)
    : new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return String(process.env.STRATEGY3_RUN_ID || `strategy3-${scanDate}-${time}`).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normalizeStrategy3Signals(stock) {
  const rows = Array.isArray(stock?.matches) ? stock.matches : [];
  return rows.map((signal) => ({
    id: String(signal?.id || "").trim(),
    reason: String(signal?.reason || "").trim(),
  })).filter((signal) => signal.id || signal.reason);
}

function buildSupabaseRunRow(output, runId, status = "complete") {
  const scanTime = String(output.updatedAt || new Date().toISOString());
  return {
    run_id: runId,
    strategy: "strategy3",
    scan_date: scanDateFromOutput(output),
    started_at: String(output.startedAt || output.updatedAt || new Date().toISOString()),
    finished_at: status === "complete" ? scanTime : null,
    status,
    expected_total: cleanNumber(output.total),
    scanned_count: cleanNumber(output.total),
    result_count: status === "complete" ? cleanNumber(output.count) : 0,
    error_count: status === "failed" ? 1 : 0,
    complete: status === "complete",
    quality_status: String(output.qualityStatus || "").trim(),
    source: String(output.source || "").trim(),
    generated_at: scanTime,
    updated_at: scanTime,
    payload: {
      count: cleanNumber(output.count),
      tvPassCount: cleanNumber(output.tvPassCount),
      total: cleanNumber(output.total),
      usedDate: output.usedDate || "",
      displayMode: output.displayMode || "",
      noMatchReason: output.noMatchReason || "",
      sourceWarnings: (output.sourceWarnings || []).slice(0, 20),
      sourceHealth: output.sourceHealth || null,
      sourceDriftHealth: output.sourceDriftHealth || null,
      selfTest: output.selfTest || null,
      publishedSelfTest: output.publishedSelfTest || null,
    },
  };
}

function buildSupabaseScanRows(output, runId) {
  const scanDate = scanDateFromOutput(output);
  const scanTime = String(output.updatedAt || new Date().toISOString());
  return (output.matches || []).map((stock, index) => {
    const signals = normalizeStrategy3Signals(stock);
    const rawName = String(stock.rawName || stock.name || stock.code || "").trim();
    const displayName = String(
      stock.displayName || (stock.tvOk && rawName ? `${rawName} 🔥` : rawName) || stock.code || ""
    ).trim();
    return {
      run_id: runId,
      strategy: "strategy3",
      scan_date: scanDate,
      code: normalizeCode(stock.code),
      name: displayName,
      price: cleanNumber(stock.close || stock.price),
      close: cleanNumber(stock.close || stock.price),
      change_percent: cleanNumber(stock.percent ?? stock.changePercent),
      volume: cleanNumber(stock.tradeVolume || stock.volume),
      trade_volume: cleanNumber(stock.tradeVolume || stock.volume),
      trade_value: cleanNumber(stock.value || stock.tradeValue),
      score: cleanNumber(stock.score || stock.overnightScore),
      rank: index + 1,
      reason: String(stock.tvOvernightEntry?.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
      signals,
      complete: true,
      quality_status: String(output.qualityStatus || "").trim(),
      generated_at: scanTime,
      updated_at: scanTime,
      payload: {
        ...stock,
        rawName,
        displayName,
        name: displayName,
        tvOk: Boolean(stock.tvOvernightEntry?.ok),
        tvFlame: Boolean(stock.tvOvernightEntry?.ok),
        tvBreakdown: {
          controlOk: stock.tvOvernightEntry?.controlOk === true,
          obvOk: stock.tvOvernightEntry?.obvOk === true,
          nearHigh: stock.tvOvernightEntry?.nearHigh === true,
          nearHighOk: stock.tvOvernightEntry?.nearHighOk === true,
          candleRows: cleanNumber(stock.tvOvernightEntry?.candleCount),
          candleSource: String(stock.tvOvernightEntry?.candleSource || ""),
          degenerateRatio: cleanNumber(stock.tvOvernightEntry?.candleQuality?.degenerateRatio),
          degenerateRows: cleanNumber(stock.tvOvernightEntry?.candleQuality?.degenerateRows),
          after1300Rows: cleanNumber(stock.tvOvernightEntry?.candleQuality?.after1300Rows),
          formulaVersion: String(stock.tvOvernightEntry?.formulaVersion || ""),
          controlSource: String(stock.tvOvernightEntry?.controlSource || ""),
        },
      },
    };
  }).filter((row) => /^\d{4}$/.test(row.code));
}

async function upsertSupabaseRows(table, rows, conflictTarget) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictTarget}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 500)}`.trim());
}

async function upsertStrategy3ResultsToSupabase(output) {
  if (!SYNC_SUPABASE_RESULTS) return false;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("strategy3 supabase upsert skipped: missing Supabase service credentials");
    return false;
  }
  const runId = strategy3RunIdFromOutput(output);
  const runningOutput = { ...output, count: 0 };
  const rows = buildSupabaseScanRows(output, runId);
  let lastMessage = "";
  for (let attempt = 1; attempt <= SUPABASE_RESULTS_ATTEMPTS; attempt += 1) {
    try {
      await upsertSupabaseRows(SUPABASE_RUNS_TABLE, [buildSupabaseRunRow(runningOutput, runId, "running")], "run_id");
      if (rows.length) {
        await upsertSupabaseRows(SUPABASE_RESULTS_TABLE, rows, "run_id,strategy,code");
      }
      await upsertSupabaseRows(SUPABASE_RUNS_TABLE, [buildSupabaseRunRow(output, runId, "complete")], "run_id");
      console.log(`strategy3 supabase upsert ok: ${rows.length} rows into ${SUPABASE_RESULTS_TABLE}, run ${runId}`);
      output.runId = runId;
      output.cacheSource = "supabase-snapshot";
      output.transport = {
        source: "supabase-snapshot",
        table: SUPABASE_RESULTS_TABLE,
        runId,
        gate: "run_id",
        via: "scripts/scan-strategy3-cache",
        updatedAt: output.updatedAt || new Date().toISOString(),
      };
      return runId;
    } catch (error) {
      lastMessage = error?.message || String(error);
      console.warn(`strategy3 supabase upsert attempt ${attempt}/${SUPABASE_RESULTS_ATTEMPTS} failed: ${lastMessage}`);
      if (attempt < SUPABASE_RESULTS_ATTEMPTS) await sleep(Math.min(15000, 1500 * attempt));
    }
  }
  console.warn(`strategy3 supabase upsert failed: ${lastMessage}`);
  return false;
}

async function upsertStrategy3Snapshot(output) {
  if (!output?.runId) return { ok: false, skipped: true, error: "missing_run_id" };
  const payload = {
    ...output,
    source: output.source || "strategy3_scan_results",
    cacheSource: "supabase-snapshot",
    transport: {
      ...(output.transport || {}),
      source: "supabase-snapshot",
      snapshotKey: "strategy3_latest",
      runId: output.runId,
      gate: "snapshot",
      via: "scripts/scan-strategy3-cache",
      updatedAt: output.updatedAt || new Date().toISOString(),
    },
  };
  return upsertSnapshot("strategy3_latest", payload, {
    snapshotId: output.runId,
    source: "strategy3-latest",
    reason: "strategy3-complete-run",
    tradeDate: output.usedDate,
    timeoutMs: Number(process.env.STRATEGY3_SNAPSHOT_WRITE_TIMEOUT_MS || 20000),
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function emaSeries(values, length) {
  const rows = (values || []).map(cleanNumber);
  const k = 2 / (length + 1);
  let ema = 0;
  return rows.map((value, index) => {
    ema = index === 0 ? value : value * k + ema * (1 - k);
    return ema;
  });
}

function smaAt(values, index, length) {
  if (index < length - 1) return 0;
  const slice = values.slice(index - length + 1, index + 1).map(cleanNumber);
  return slice.reduce((sum, value) => sum + value, 0) / length;
}

function candleMinutes(candle) {
  const text = String(candle?.candleTime || candle?.time || "");
  if (/T/.test(text) || /(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Taipei",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(new Date(parsed));
      const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
      return get("hour") * 60 + get("minute");
    }
  }
  const match = text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (!match) {
    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Taipei",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(parsed));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    return get("hour") * 60 + get("minute");
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

function candleTaipeiDateKey(candle) {
  const text = String(candle?.candleTime || candle?.time || candle?.tradeDate || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(parsed));
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${get("year")}${get("month")}${get("day")}`;
  }
  const match = text.match(/\b(\d{4})[-/]?(\d{2})[-/]?(\d{2})\b/);
  return match ? `${match[1]}${match[2]}${match[3]}` : "";
}

function after1300CandleRows(candles, quoteDate = "") {
  const expectedDate = String(quoteDate || "").replace(/\D/g, "");
  return (candles || []).filter((candle) => {
    const minutes = candleMinutes(candle);
    if (minutes == null || minutes < 13 * 60) return false;
    const dateKey = candleTaipeiDateKey(candle);
    return !expectedDate || !dateKey || dateKey === expectedDate;
  });
}

async function mapLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function strategy3ReadbackCandidates(stocks) {
  return [...(stocks || [])]
    .filter((stock) => cleanNumber(stock.close) > 0 && cleanNumber(stock.tradeVolume || stock.volume) > 0)
    .sort((a, b) => {
      const scoreA = cleanNumber(a.value || a.tradeValue) / 1000000
        + cleanNumber(a.tradeVolume || a.volume) / 100000
        + Math.max(0, cleanNumber(a.percent)) * 8
        + cleanNumber(a.volumeRatio || a.projectedRatio) * 5;
      const scoreB = cleanNumber(b.value || b.tradeValue) / 1000000
        + cleanNumber(b.tradeVolume || b.volume) / 100000
        + Math.max(0, cleanNumber(b.percent)) * 8
        + cleanNumber(b.volumeRatio || b.projectedRatio) * 5;
      return scoreB - scoreA;
    })
    .slice(0, Math.max(20, STRATEGY3_1M_READBACK_LIMIT));
}

async function repairAfter1300StatusFromRpc(stocks, warnings) {
  const currentReady = (stocks || []).filter((stock) => stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0).length;
  if (currentReady >= STRATEGY3_MIN_AFTER_1300_CANDIDATES) return { repaired: 0, checked: 0 };
  const candidates = strategy3ReadbackCandidates(stocks);
  let repaired = 0;
  let checked = 0;
  await mapLimit(candidates, STRATEGY3_1M_READBACK_CONCURRENCY, async (stock) => {
    if (stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0) return;
    checked += 1;
    try {
      const result = await fetchStrategy3Intraday1mLatestN(stock.code, STRATEGY3_TV_CANDLE_LIMIT);
      const candles = result.candles || result.rows || [];
      const afterRows = after1300CandleRows(candles, stock.quoteDate);
      if (!afterRows.length) return;
      stock.after1300CandleCount = afterRows.length;
      stock.hasAfter1300Candle = true;
      stock.has1300Candle = afterRows.some((row) => candleMinutes(row) === 13 * 60);
      stock.intradayCandleCount = candles.length;
      stock.latestCandleTime = afterRows.at(-1)?.candleTime || afterRows.at(-1)?.time || stock.latestCandleTime || "";
      stock.intradayStatusSource = "rpc-readback";
      repaired += 1;
    } catch (error) {
      return;
    }
  });
  if (repaired > 0) {
    warnings.push(`strategy3 1m status repaired from RPC readback: ${repaired}/${checked}`);
  }
  return { repaired, checked };
}

async function hydrateAfter1300StatusFromSupabase(stocks, warnings) {
  if (!Array.isArray(stocks) || !stocks.length) return { statusRows: 0, repaired: 0, checked: 0 };
  let statusRows = 0;
  try {
    const statusResult = await fetchStrategy3Intraday1mStatus(stocks.map((stock) => stock.code));
    stocks.forEach((stock) => {
      const status = statusResult.byCode.get(stock.code);
      if (!status) return;
      const after1300Count = cleanNumber(status.after_1300_candle_count ?? status.candles_after_1300);
      stock.after1300CandleCount = after1300Count;
      stock.hasAfter1300Candle = status.has_after_1300_candle === true || after1300Count > 0;
      stock.has1300Candle = status.has_1300_candle === true;
      stock.intradayCandleCount = cleanNumber(status.today_candle_count ?? status.candle_count ?? status.rows_today);
      stock.latestCandleTime = status.latest_candle_time || stock.latestCandleTime;
      stock.intradayStatusSource = statusResult.source || stock.intradayStatusSource || "supabase-status";
      statusRows += 1;
    });
  } catch (error) {
    warnings.push(`strategy3 intraday 1m status read skipped: ${error?.message || String(error)}`);
  }
  const repaired = await repairAfter1300StatusFromRpc(stocks, warnings);
  return { statusRows, ...repaired };
}

async function hydrateSideVolumeFromSupabase(stocks, warnings) {
  if (!Array.isArray(stocks) || !stocks.length) return { sideRows: 0 };
  try {
    const sideResult = await fetchStrategy3LiveSideVolumeMap(stocks.map((stock) => stock.code));
    let sideRows = 0;
    stocks.forEach((stock) => {
      const side = sideResult.byCode.get(stock.code);
      if (!side) return;
      stock.outsideVolume = cleanNumber(side.outsideVolume);
      stock.insideVolume = cleanNumber(side.insideVolume);
      stock.cumulativeAskVolume = cleanNumber(side.cumulativeAskVolume);
      stock.cumulativeBidVolume = cleanNumber(side.cumulativeBidVolume);
      stock.cumulativeBidAskVolume = cleanNumber(side.cumulativeBidAskVolume);
      stock.sideVolumeTotal = cleanNumber(side.sideVolumeTotal);
      stock.sideVolumeUpdatedAt = side.sideVolumeUpdatedAt || "";
      stock.sideVolumeSource = side.source || sideResult.source || "fugle_quotes_live";
      sideRows += 1;
    });
    return { sideRows };
  } catch (error) {
    warnings.push(`strategy3 fugle live side-volume read skipped: ${error?.message || String(error)}`);
    return { sideRows: 0 };
  }
}

async function fetchJson(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "text/csv,text/plain,*/*",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map((item) => item.replace(/\s/g, ""));
  return rows.slice(1).map((items) => {
    const record = {};
    headers.forEach((header, index) => { record[header] = items[index] || ""; });
    return record;
  });
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function normalizeStock(row) {
  const code = normalizeCode(row.Code || row.code);
  const name = String(row.Name || row.name || "").trim();
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || !name) return null;
  return {
    code,
    name,
    close: cleanNumber(row.ClosingPrice || row.close),
    change: cleanNumber(row.Change || row.change),
    percent: cleanNumber(row.Percent || row.percent),
    value: cleanNumber(row.TradeValue || row.value),
    tradeVolume: cleanNumber(row.TradeVolume || row.tradeVolume),
  };
}

async function fetchUniverse() {
  const payload = await fetchJson(STOCK_URL);
  const rows = Array.isArray(payload) ? payload : (payload.stocks || []);
  const base = rows.map(normalizeStock).filter(Boolean);
  const realtimeQuotes = await fetchMisQuotes(base.map((stock) => stock.code));
  return base.map((stock) => {
    const quote = realtimeQuotes.get(stock.code);
    return quote ? { ...stock, ...quote, name: quote.name || stock.name } : stock;
  });
}

async function fetchSupabaseStrategy3Universe() {
  const access = await verifyStrategy3ReadAccess();
  const warnings = [];
  let quoteResult = null;
  try {
    quoteResult = await fetchStrategy3QuoteReady({ minQuotes: 500 });
    if (!quoteResult.ok) throw new Error(quoteResult.error || "strategy3 quote ready unavailable");
  } catch (error) {
    warnings.push(`strategy3 quote-ready view fallback to latest quotes: ${error?.message || String(error)}`);
    quoteResult = await fetchStrategy3QuoteLatestReady({ minQuotes: 500 });
    if (!quoteResult.ok) throw new Error(quoteResult.error || "strategy3 latest quotes unavailable");
  }
  const stocks = quoteResult.quotes.map((quote) => ({
    code: quote.code,
    name: quote.name,
    close: quote.close,
    change: quote.change,
    percent: quote.percent,
    value: quote.value || quote.tradeValue,
    tradeVolume: quote.tradeVolume,
    quoteDate: String(quote.updatedAt || quote.quoteTimeRaw || "").slice(0, 10).replace(/\D/g, ""),
    avgVolume: quote.avgVolume,
    volumeRatio: quote.volumeRatio,
    projectedRatio: quote.projectedRatio,
    updatedAt: quote.updatedAt,
    quoteTimeRaw: quote.quoteTimeRaw,
    issuedShares: quote.issuedShares,
    after1300CandleCount: quote.after1300CandleCount,
    hasAfter1300Candle: quote.hasAfter1300Candle,
    has1300Candle: quote.has1300Candle,
    intradayCandleCount: quote.intradayCandleCount,
    latestCandleTime: quote.latestCandleTime,
    quoteSource: quote.quoteReadySource,
    stockType: quote.stockType,
    market: quote.market,
    isHalted: quote.isHalted,
    isTrial: quote.isTrial,
    is_blacklisted: quote.is_blacklisted,
    is_daytrade_unsuitable: quote.is_daytrade_unsuitable,
    is_etf: quote.is_etf,
    is_warrant: quote.is_warrant,
    is_cb: quote.is_cb,
  }));
  await hydrateAfter1300StatusFromSupabase(stocks, warnings);
  let capitalResult = { byCode: new Map() };
  try {
    capitalResult = await fetchStrategy3CapitalMap(stocks.map((stock) => stock.code));
  } catch (error) {
    warnings.push(`stock_capital_latest read skipped: ${error?.message || String(error)}`);
  }
  const sideVolumeResult = await hydrateSideVolumeFromSupabase(stocks, warnings);
  const issuedSharesMap = new Map(capitalResult.byCode);
  stocks.forEach((stock) => {
    if (cleanNumber(stock.issuedShares) > 0) issuedSharesMap.set(stock.code, cleanNumber(stock.issuedShares));
  });
  const volumeAverageMap = new Map();
  stocks.forEach((stock) => {
    if (stock.avgVolume > 0) volumeAverageMap.set(stock.code, stock.avgVolume);
  });
  if (!access.ok) warnings.push(`strategy3 supabase read access partial: ${access.failed.map((item) => item.table).join(",")}`);
  if (STRATEGY3_REQUIRE_OUTSIDE_GT_INSIDE && sideVolumeResult.sideRows < STRATEGY3_MIN_AFTER_1300_CANDIDATES) {
    warnings.push(`strategy3 outside/inside side-volume coverage low: ${sideVolumeResult.sideRows}<${STRATEGY3_MIN_AFTER_1300_CANDIDATES}`);
  }
  return {
    stocks,
    issuedSharesMap,
    volumeAverageMap,
    warnings,
    source: "supabase-strategy3",
  };
}

async function fetchIssuedShares() {
  const map = new Map();
  const warnings = [];
  await Promise.all(CAPITAL_URLS.map(async (url) => {
    try {
      const rows = parseCsv(await fetchText(url));
      rows.forEach((row) => {
        const code = normalizeCode(row["公司代號"]);
        const shares = cleanNumber(row["已發行普通股數或TDR原股發行股數"]);
        if (/^\d{4}$/.test(code) && shares > 0) map.set(code, shares);
      });
    } catch (error) {
      warnings.push(`issued shares fetch failed: ${url} :: ${error.message}`);
    }
  }));
  return { map, warnings };
}

function formatTwseDate(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatTpexDate(date) {
  return `${String(date.getFullYear() - 1911).padStart(3, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function recentTradingDates(limit = 8) {
  const dates = [];
  const date = new Date();
  date.setDate(date.getDate() - 1);
  for (let i = 0; dates.length < limit && i < 18; i++) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(date));
    date.setDate(date.getDate() - 1);
  }
  return dates;
}

function collectVolume(bucket, code, volume) {
  if (!/^\d{4}$/.test(code) || /^00/.test(code) || volume <= 0) return;
  const list = bucket.get(code) || [];
  list.push(volume);
  bucket.set(code, list);
}

async function fetchHistoricalVolumes() {
  const bucket = new Map();
  const warnings = [];
  for (const date of recentTradingDates()) {
    try {
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${formatTwseDate(date)}&type=ALLBUT0999&response=json`, 25000);
      const table = (payload.tables || []).find((item) => String(item.title || "").includes("每日收盤行情"));
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("證券代號"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && volumeIndex >= 0) data.forEach((row) => collectVolume(bucket, normalizeCode(row[codeIndex]), cleanNumber(row[volumeIndex])));
    } catch (error) {
      warnings.push(`twse volume fetch failed: ${formatTwseDate(date)} :: ${error.message}`);
    }
    try {
      const payload = await fetchJson(`https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(formatTpexDate(date))}&s=0,asc,0`, 25000);
      const table = (payload.tables || []).find((item) => (item.data || []).length);
      const fields = table?.fields || [];
      const data = table?.data || [];
      const codeIndex = fields.findIndex((field) => String(field).includes("代號"));
      const volumeIndex = fields.findIndex((field) => String(field).includes("成交股數"));
      if (codeIndex >= 0 && volumeIndex >= 0) data.forEach((row) => collectVolume(bucket, normalizeCode(row[codeIndex]), cleanNumber(row[volumeIndex])));
    } catch (error) {
      warnings.push(`tpex volume fetch failed: ${formatTpexDate(date)} :: ${error.message}`);
    }
  }
  const averages = new Map();
  bucket.forEach((values, code) => {
    const usable = values.slice(0, 5);
    if (usable.length) averages.set(code, usable.reduce((sum, value) => sum + value, 0) / usable.length);
  });
  return { map: averages, warnings };
}

function rankMap(stocks, key) {
  const sorted = [...stocks].sort((a, b) => cleanNumber(b[key]) - cleanNumber(a[key]));
  const total = Math.max(sorted.length - 1, 1);
  const ranks = new Map();
  sorted.forEach((stock, index) => {
    ranks.set(stock.code, Math.round(((total - index) / total) * 100));
  });
  return ranks;
}

function strategy3FieldGate(stock, volumeRatio, volumeLots) {
  const pct = cleanNumber(stock.percent);
  const outsideVolume = cleanNumber(stock.outsideVolume ?? stock.cumulativeAskVolume);
  const insideVolume = cleanNumber(stock.insideVolume ?? stock.cumulativeBidVolume);
  const outsideInsideDiff = outsideVolume - insideVolume;
  const outsideInsideRatio = insideVolume > 0
    ? outsideVolume / insideVolume
    : (outsideVolume > 0 ? 99 : 0);
  const checks = {
    changePercent3To5: pct >= STRATEGY3_MIN_CHANGE_PERCENT && pct <= STRATEGY3_MAX_CHANGE_PERCENT,
    volumeRatioGt1: volumeRatio > STRATEGY3_MIN_VOLUME_RATIO,
    outsideGtInside: !STRATEGY3_REQUIRE_OUTSIDE_GT_INSIDE || (outsideVolume > 0 && insideVolume > 0 && outsideVolume > insideVolume),
    tradeVolumeLots: STRATEGY3_MIN_TRADE_VOLUME_LOTS <= 0 || volumeLots >= STRATEGY3_MIN_TRADE_VOLUME_LOTS,
  };
  const ok = Object.values(checks).every(Boolean);
  const reason = `硬門檻：漲幅=${pct.toFixed(2)}% (${STRATEGY3_MIN_CHANGE_PERCENT}-${STRATEGY3_MAX_CHANGE_PERCENT}%)、量比=${volumeRatio.toFixed(2)} (> ${STRATEGY3_MIN_VOLUME_RATIO})、外盤=${Math.round(outsideVolume)}、內盤=${Math.round(insideVolume)}、外內差=${Math.round(outsideInsideDiff)}、外內比=${outsideInsideRatio.toFixed(2)}、成交張數=${Math.round(volumeLots)}${STRATEGY3_MIN_TRADE_VOLUME_LOTS > 0 ? ` (>=${STRATEGY3_MIN_TRADE_VOLUME_LOTS})` : ""}`;
  return { ok, checks, reason, outsideVolume, insideVolume, outsideInsideDiff, outsideInsideRatio };
}

async function buildMatches(stocks, issuedSharesMap, volumeAverageMap, sourceWarnings) {
  const valueRanks = rankMap(stocks, "value");
  const volumeRanks = rankMap(stocks, "tradeVolume");
  const scored = stocks.map((stock) => {
    const valueRank = valueRanks.get(stock.code) || 0;
    const volumeRank = volumeRanks.get(stock.code) || 0;
    const pct = Number(stock.percent) || 0;
    const volumeLots = stock.tradeVolume / 1000;
    const issuedShares = issuedSharesMap.get(stock.code) || 0;
    const turnoverRate = issuedShares ? (stock.tradeVolume / issuedShares) * 100 : 0;
    const avgVolume = volumeAverageMap.get(stock.code) || cleanNumber(stock.avgVolume) || 0;
    const volumeRatio = cleanNumber(stock.volumeRatio || stock.projectedRatio || stock.volume_ratio || stock.volume_ratio_5)
      || (avgVolume ? stock.tradeVolume / avgVolume : 0);
    const fieldGate = strategy3FieldGate(stock, volumeRatio, volumeLots);
    const heatPenalty = pct > 8.8 ? 24 : pct > 6.5 ? 12 : pct < 0 ? 30 : 0;
    const outsideDominanceScore = Math.min(Math.max(fieldGate.outsideInsideDiff, 0) / 500, 18)
      + Math.min(Math.max(fieldGate.outsideInsideRatio - 1, 0) * 16, 16);
    const overnightScore = clamp(Math.round(
      Math.min((pct - 3) * 18, 36) +
      Math.min(volumeLots / 80, 18) +
      Math.min(turnoverRate * 6, 30) +
      Math.min(volumeRatio * 12, 20) +
      outsideDominanceScore -
      heatPenalty
    ), 0, 100);
    const turnoverPass = STRATEGY3_REQUIRE_TURNOVER ? turnoverRate > 5 : true;
    const fixedPass = stock.close > 0
      && (stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0)
      && fieldGate.ok
      && turnoverPass;
    const fixedReason = fixedPass
      ? `進入 TradingView 隔日沖判斷：有 13:00 後1分K，且通過漲幅/量比/外內盤/成交張數門檻。${fieldGate.reason}`
      : `未進入 TradingView 隔日沖判斷：價格、13:00後1分K或硬門檻未通過。close=${stock.close}、after1300=${stock.after1300CandleCount || 0}、volumeRatio=${volumeRatio.toFixed(2)}。${fieldGate.reason}`;
    return {
      ...stock,
      valueRank,
      volumeRank,
      volumeLots: Math.round(volumeLots),
      tradeVolumeLots: Math.round(volumeLots),
      turnoverRate: Number(turnoverRate.toFixed(2)),
      volumeRatio: Number(volumeRatio.toFixed(2)),
      projectedRatio: Number(volumeRatio.toFixed(2)),
      outsideVolume: Math.round(fieldGate.outsideVolume),
      insideVolume: Math.round(fieldGate.insideVolume),
      outsideGtInside: fieldGate.outsideVolume > fieldGate.insideVolume,
      outsideInsideDiff: Math.round(fieldGate.outsideInsideDiff),
      outsideInsideRatio: Number(fieldGate.outsideInsideRatio.toFixed(2)),
      outsideDominanceScore: Number(outsideDominanceScore.toFixed(2)),
      strategy3FieldGate: fieldGate,
      strategy3FixedPass: fixedPass,
      overnightScore,
      overnightState: fixedPass ? "待TV判斷" : "觀察",
      score: overnightScore,
      matches: [{ id: "overnight_chip", reason: fixedReason }],
    };
  })
    .filter((stock) => stock.close > 0 && (stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0))
    .filter((stock) => stock.strategy3FixedPass)
    .sort((a, b) => b.overnightScore - a.overnightScore || b.value - a.value)
    .slice(0, STRATEGY3_TV_CANDIDATE_LIMIT > 0 ? STRATEGY3_TV_CANDIDATE_LIMIT : undefined);

  if (!STRATEGY3_REQUIRE_TV_ENTRY) return scored.slice(0, 80);

  const analyzed = await mapLimit(scored, STRATEGY3_TV_CONCURRENCY, async (stock) => {
    try {
      const result = await fetchStrategy3TvCandles(stock.code, STRATEGY3_TV_CANDLE_LIMIT);
      const rawTvEntry = analyzeTradingViewOvernightEntry(result.candles || result.rows || []);
      const quality = result.quality || {};
      const sourceNote = `K線來源=${result.source || "unknown"}、rows=${quality.rows ?? 0}、after1300=${quality.after1300Rows ?? 0}、退化=${quality.degenerateRows ?? 0}/${quality.rows ?? 0}`;
      const tvEntry = {
        ...rawTvEntry,
        reason: `${rawTvEntry.reason} ${sourceNote}。`,
        candleSource: result.source || "",
        candleQuality: quality,
        candleFallbackFrom: result.fallbackFrom || "",
        candleFallbackReason: result.fallbackReason || "",
        candleFallbackError: result.fallbackError || "",
        supabaseCandleQuality: result.supabaseQuality || null,
        fugleCandleQuality: result.fugleQuality || null,
      };
      return {
        ...stock,
        tvOvernightEntry: tvEntry,
        overnightScore: clamp(stock.overnightScore + (tvEntry.ok ? 12 : 0), 0, 100),
        score: clamp(stock.overnightScore + (tvEntry.ok ? 12 : 0), 0, 100),
        overnightState: tvEntry.ok ? "通過" : "觀察",
        matches: [
          ...stock.matches,
          { id: "tv_overnight_entry", reason: tvEntry.reason },
        ],
      };
    } catch (error) {
      const message = `strategy3 TV entry fetch failed ${stock.code}: ${error?.message || String(error)}`;
      sourceWarnings.push(message);
      return {
        ...stock,
        tvOvernightEntry: { ok: false, signal: "tv_overnight_entry", reason: message },
        overnightState: "觀察",
        matches: [
          ...stock.matches,
          { id: "tv_overnight_entry", reason: message },
        ],
      };
    }
  });

  return analyzed
    .sort((a, b) => {
      const tvDiff = Number(Boolean(b.tvOvernightEntry?.ok)) - Number(Boolean(a.tvOvernightEntry?.ok));
      if (tvDiff) return tvDiff;
      return b.overnightScore - a.overnightScore
        || cleanNumber(b.outsideInsideDiff) - cleanNumber(a.outsideInsideDiff)
        || b.value - a.value;
    })
    .slice(0, 80)
    .map((stock) => {
      const tvOk = Boolean(stock.tvOvernightEntry?.ok);
      return {
        ...stock,
        tvOk,
        tvFlame: tvOk,
        rawName: stock.name,
        displayName: tvOk ? `${stock.name} 🔥` : stock.name,
        displayMode: tvOk ? "tv_pass" : "field_gate_watch",
      };
    });
}



function readNotificationSecret(envName, fileName) {
  const value = String(process.env[envName] || "").trim();
  if (value) return value;
  try {
    return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", fileName), "utf8").trim();
  } catch {
    return "";
  }
}

function notificationHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function loadStrategy3NotificationReceipts() {
  const raw = readJson(STRATEGY3_NOTIFICATION_RECEIPT_FILE, { receipts: {} });
  return raw && typeof raw === "object" && raw.receipts && typeof raw.receipts === "object"
    ? raw
    : { receipts: {} };
}

function saveStrategy3NotificationReceipts(receipts) {
  fs.mkdirSync(path.dirname(STRATEGY3_NOTIFICATION_RECEIPT_FILE), { recursive: true });
  fs.writeFileSync(STRATEGY3_NOTIFICATION_RECEIPT_FILE, JSON.stringify(receipts, null, 2) + "\n");
}

function taipeiTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isStrategy3NotificationWindow(date = new Date()) {
  if (!STRATEGY3_NOTIFICATION_REQUIRE_1300_WINDOW) return true;
  const t = taipeiTimeParts(date);
  const minutes = t.hour * 60 + t.minute;
  return minutes >= (12 * 60 + 55) && minutes <= (13 * 60 + 30);
}

function compactPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "-";
}

function compactPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n >= 100 ? n.toFixed(1) : n.toFixed(2);
}

function buildStrategy3NotificationPayload(output, runId, snapshotResult) {
  const matches = Array.isArray(output?.matches) ? output.matches : [];
  const top = matches.slice(0, STRATEGY3_NOTIFICATION_MAX_SYMBOLS).map((stock, index) => ({
    rank: index + 1,
    symbol: String(stock.code || stock.symbol || "").trim(),
    name: String(stock.rawName || stock.name || stock.displayName || "").replace(/🔥/g, "").trim(),
    close: compactPrice(stock.close),
    changePercent: compactPercent(stock.changePercent ?? stock.change_percent ?? stock.change),
    tvOk: Boolean(stock.tvOk || stock.tvFlame || stock.tvOvernightEntry?.ok),
  }));
  return {
    strategy: "Strategy3",
    event: "strategy3_1300_complete_run",
    runId,
    tradeDate: output?.usedDate || output?.tradeDate || "",
    count: Number(output?.count || matches.length || 0),
    tvPassCount: Number(output?.tvPassCount || top.filter((row) => row.tvOk).length || 0),
    source: output?.source || "strategy3_scan_results",
    snapshotStatus: snapshotResult?.ok ? "ok" : "not_ok",
    symbols: top,
    updatedAt: output?.updatedAt || new Date().toISOString(),
  };
}

function strategy3NotificationText(payload, channel) {
  const rows = (payload.symbols || []).map((row) => {
    const flame = row.tvOk ? " 🔥" : "";
    return `${row.rank}. ${row.symbol} ${row.name}${flame} ${row.close} ${row.changePercent}`;
  }).join("\n");
  const header = channel === "line"
    ? `Strategy3 13:00 隔日沖\n${payload.tradeDate}｜${payload.count}檔｜TV火焰${payload.tvPassCount}檔`
    : `[Strategy3 隔日沖 13:00]\n日期: ${payload.tradeDate}\n正式檔數: ${payload.count}\nTV火焰: ${payload.tvPassCount}\nrunId: ${payload.runId}`;
  return `${header}\n${rows}`.trim();
}

async function sendTelegramStrategy3Notification(payload) {
  const token = readNotificationSecret("TELEGRAM_BOT_TOKEN", "telegram-bot-token.txt");
  const chatId = readNotificationSecret("TELEGRAM_CHAT_ID", "telegram-chat-id.txt");
  if (!token || !chatId) return { status: "disabled", reason: "missing telegram token/chat id" };
  const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: strategy3NotificationText(payload, "telegram"),
      disable_web_page_preview: true,
    }),
  });
  const responseText = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`telegram HTTP ${response.status} ${responseText.slice(0, 300)}`);
  return { status: "sent" };
}

async function sendLineStrategy3Notification(payload) {
  const token = readNotificationSecret("LINE_CHANNEL_ACCESS_TOKEN", "line-channel-access-token.txt");
  const targetId = readNotificationSecret("LINE_TARGET_ID", "line-target-id.txt");
  if (!token || !targetId) return { status: "disabled", reason: "missing line token/target id" };
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      to: targetId,
      messages: [{ type: "text", text: strategy3NotificationText(payload, "line").slice(0, 4800) }],
    }),
  });
  const responseText = await response.text().catch(() => "");
  if (!response.ok) throw new Error(`line HTTP ${response.status} ${responseText.slice(0, 300)}`);
  return { status: "sent" };
}

async function sendStrategy3CompleteNotifications(output, runId, snapshotResult) {
  if (STRATEGY3_NOTIFICATION_DISABLED) return { ok: true, skipped: true, reason: "disabled" };
  if (!runId) return { ok: true, skipped: true, reason: "missing runId" };
  if (!output?.complete || !output?.count) return { ok: true, skipped: true, reason: "no complete strategy3 matches" };
  if (output?.selfTest && output.selfTest.ok !== true) return { ok: true, skipped: true, reason: "self-test not ok" };
  if (!snapshotResult?.ok) return { ok: true, skipped: true, reason: "snapshot not ok" };
  if (!isStrategy3NotificationWindow()) return { ok: true, skipped: true, reason: "outside 13:00 notification window" };

  const payload = buildStrategy3NotificationPayload(output, runId, snapshotResult);
  const receiptKey = `strategy3:${payload.tradeDate}:1300:${runId}`;
  const receipts = loadStrategy3NotificationReceipts();
  if (receipts.receipts[receiptKey]) return { ok: true, skipped: true, reason: "duplicate", receiptKey };

  const result = { ok: true, receiptKey, channels: {}, payloadHash: notificationHash(payload), sentAt: new Date().toISOString() };
  for (const channel of ["telegram", "line"]) {
    try {
      result.channels[channel] = channel === "telegram"
        ? await sendTelegramStrategy3Notification(payload)
        : await sendLineStrategy3Notification(payload);
    } catch (error) {
      result.ok = false;
      result.channels[channel] = { status: "failed", reason: error?.message || String(error) };
    }
  }
  receipts.receipts[receiptKey] = result;
  saveStrategy3NotificationReceipts(receipts);
  return result;
}

async function main() {
  const startedAt = new Date().toISOString();
  const backup = readJson(BACKUP_FILE, { ok: true, matches: [] });
  const previousRaw = readJson(OUT_FILE, { ok: true, matches: [] });
  let source = "github-actions-mis-realtime";
  let stocks = [];
  let issuedSharesMap = new Map();
  let volumeAverageMap = new Map();
  let sourceWarnings = [];
  let exclusionStats = {};
  if (STRATEGY3_USE_SUPABASE) {
    try {
      const supabase = await fetchSupabaseStrategy3Universe();
      source = supabase.source;
      stocks = supabase.stocks;
      issuedSharesMap = supabase.issuedSharesMap;
      volumeAverageMap = supabase.volumeAverageMap;
      sourceWarnings = supabase.warnings;
    } catch (error) {
      sourceWarnings.push(`strategy3 supabase fallback: ${error?.message || String(error)}`);
    }
  }
  if (!stocks.length) {
    const [fallbackStocks, issuedSharesResult, volumeAverageResult] = await Promise.all([
      fetchUniverse(),
      fetchIssuedShares(),
      fetchHistoricalVolumes(),
    ]);
    stocks = fallbackStocks;
    issuedSharesMap = issuedSharesResult.map;
    volumeAverageMap = volumeAverageResult.map;
    sourceWarnings = [
      ...sourceWarnings,
      ...issuedSharesResult.warnings,
      ...volumeAverageResult.warnings,
    ];
    await hydrateAfter1300StatusFromSupabase(stocks, sourceWarnings);
    await hydrateSideVolumeFromSupabase(stocks, sourceWarnings);
  }
  if (!stocks.length) throw new Error("No stock universe");
  const resourceAfter1300Count = stocks.filter((stock) => stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0).length;
  const exclusionResult = applyStrategy3Exclusions(stocks, loadStrategy3Blacklist());
  stocks = exclusionResult.stocks;
  exclusionStats = { ...exclusionResult.stats, resourceAfter1300Count };
  if (!stocks.length) throw new Error("No stock universe after strategy3 exclusions");
  sourceWarnings.forEach((warning) => console.warn(`strategy3 source warning: ${warning}`));
  const sourceHealth = buildSourceHealth(stocks, issuedSharesMap, volumeAverageMap, sourceWarnings, exclusionStats);
  (sourceHealth.warnings || []).forEach((warning) => console.warn(`strategy3 source warning: ${warning}`));
  if (sourceHealth.status !== "ok") {
    console.warn(`strategy3 source health ${sourceHealth.status}: ${sourceHealth.issues.join("; ") || "warnings present"}`);
  }
  if (sourceHealth.status === "failed") {
    throw new Error(`Strategy3 source health failed: ${sourceHealth.issues.join("; ")}`);
  }
  const sourceDriftHealth = await fetchStrategy3SourceDriftHealth();
  if (sourceDriftHealth.status !== "ready") {
    throw new Error(`Strategy3 source drift failed: ${sourceDriftHealth.reason}`);
  }
  const matches = await buildMatches(stocks, issuedSharesMap, volumeAverageMap, sourceWarnings);
  const quoteDate = latestStockDateKey(stocks);
  const tvPassCount = matches.filter((stock) => stock.tvOvernightEntry?.ok).length;
  const displayMode = matches.length ? "field_gate_with_tv_flame" : "no_tv_pass";
  const noMatchReason = matches.length ? "" : STRATEGY3_NO_TV_PASS_REASON;
  const output = {
    ok: true,
    source,
    startedAt,
    updatedAt: new Date().toISOString(),
    usedDate: quoteDate,
    total: stocks.length,
    count: matches.length,
    tvPassCount,
    complete: true,
    sourceWarnings,
    qualityStatus: sourceHealth.status,
    sourceHealth,
    sourceDriftHealth,
    displayMode,
    noMatchReason,
    matches,
  };

  const prePublishSelfTest = validateStrategy3PrePublish(output);
  output.selfTest = prePublishSelfTest;
  if (!prePublishSelfTest.ok) {
    throw new Error(`Strategy3 pre-publish self-test failed: ${prePublishSelfTest.issues.join("; ")}`);
  }

  preservePreviousTradingSource((previousRaw.matches || []).length ? previousRaw : backup, output);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const runId = await upsertStrategy3ResultsToSupabase(output);
  if (runId) {
    const publishedSelfTest = await verifyStrategy3PublishedRun(runId, output.count);
    output.publishedSelfTest = publishedSelfTest;
    if (!publishedSelfTest.ok) {
      throw new Error(`Strategy3 published self-test failed: count=${publishedSelfTest.count}/${publishedSelfTest.expectedCount}; missingBreakdown=${publishedSelfTest.missingBreakdown}`);
    }
    await upsertSupabaseRows(SUPABASE_RUNS_TABLE, [buildSupabaseRunRow(output, runId, "complete")], "run_id");
    const snapshotResult = await upsertStrategy3Snapshot(output);
    if (snapshotResult.ok) {
      console.log(`strategy3 snapshot upsert ok: strategy3_latest run ${runId}`);
    } else {
      console.warn(`strategy3 snapshot upsert failed: ${snapshotResult.error || "unknown_error"}`);
    }
    const notificationResult = await sendStrategy3CompleteNotifications(output, runId, snapshotResult);
    console.log(`strategy3 notification result: ${JSON.stringify(notificationResult)}`);
  }
  await publishStrategyCacheStatus("strategy3", "策略3-隔日沖", output, {
    used_date: output.usedDate,
    updated_at: output.updatedAt,
    scan_status: output.complete ? "complete" : "failed",
    scanned: output.total,
    total: output.total,
    match_count: output.count,
    source: "strategy3_scan_results",
    log: `quality=${output.qualityStatus || ""}`,
  });
  if (STRATEGY3_API_ONLY) {
    console.log(`strategy3 API-only: skipped static strategy3*.json output, matches ${matches.length}`);
    return;
  }
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  console.log(`strategy3 cache updated: matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

