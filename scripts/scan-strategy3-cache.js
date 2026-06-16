const fs = require("fs");
const path = require("path");
const { fetchMisQuotes } = require("../lib/mis-quotes");
const {
  fetchStrategy3CapitalMap,
  fetchStrategy3Intraday1mLatestN,
  fetchStrategy3QuoteReady,
  verifyStrategy3ReadAccess,
} = require("../lib/supabase-public-slot");
const {
  chipTradeExclusion,
  loadChipTradeBlacklist,
} = require("../lib/chip-trade-exclusions");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(ROOT, "data");
const OUT_FILE = path.join(DATA_DIR, "strategy3-latest.json");
const BACKUP_FILE = path.join(DATA_DIR, "strategy3-backup.json");
const SCORECARD_SOURCE_FILE = path.join(DATA_DIR, "strategy3-scorecard-source.json");
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
const STRATEGY3_REQUIRE_TURNOVER = process.env.STRATEGY3_REQUIRE_TURNOVER === "1";
const STRATEGY3_REQUIRE_VOLUME_AVERAGE = process.env.STRATEGY3_REQUIRE_VOLUME_AVERAGE === "1";
const STRATEGY3_USE_SUPABASE = process.env.STRATEGY3_USE_SUPABASE !== "0";
const STRATEGY3_REQUIRE_AFTER_1300 = process.env.STRATEGY3_REQUIRE_AFTER_1300 !== "0";
const STRATEGY3_MIN_AFTER_1300_CANDIDATES = Number(process.env.STRATEGY3_MIN_AFTER_1300_CANDIDATES || 20);
const STRATEGY3_APPLY_BLACKLIST = process.env.STRATEGY3_APPLY_BLACKLIST !== "0";
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || (() => { try { return fs.readFileSync(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"), "utf8").trim(); } catch { return ""; } })();
const SYNC_SUPABASE_RESULTS = process.env.STRATEGY3_SYNC_SUPABASE_RESULTS !== "0";
const SUPABASE_RESULTS_TABLE = process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results";
const SUPABASE_RUNS_TABLE = process.env.STRATEGY3_SUPABASE_RUNS_TABLE || "strategy3_scan_runs";
const SUPABASE_RESULTS_ATTEMPTS = Math.max(1, Number(process.env.STRATEGY3_SUPABASE_RESULTS_ATTEMPTS || 3));

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
  const after1300Count = stocks.filter((stock) => stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0).length;
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
  if (sourceWarnings.length > SOURCE_WARNING_LIMIT) {
    issues.push(`warningCount ${sourceWarnings.length} above ${SOURCE_WARNING_LIMIT}`);
  }
  return {
    status: issues.length ? "failed" : ((sourceWarnings.length || warnings.length) ? "degraded" : "ok"),
    issuedSharesCount: issuedSharesMap.size,
    volumeAverageCount: volumeAverageMap.size,
    stockUniverseCount: stocks.length,
    after1300ReadyCount: after1300Count,
    exclusionStats,
    warningCount: sourceWarnings.length + warnings.length,
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
      avgVolume5: stock.avgVolume,
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
      total: cleanNumber(output.total),
      usedDate: output.usedDate || "",
      sourceWarnings: (output.sourceWarnings || []).slice(0, 20),
      sourceHealth: output.sourceHealth || null,
    },
  };
}

function buildSupabaseScanRows(output, runId) {
  const scanDate = scanDateFromOutput(output);
  const scanTime = String(output.updatedAt || new Date().toISOString());
  return (output.matches || []).map((stock, index) => {
    const signals = normalizeStrategy3Signals(stock);
    return {
      run_id: runId,
      strategy: "strategy3",
      scan_date: scanDate,
      code: normalizeCode(stock.code),
      name: String(stock.name || stock.code || "").trim(),
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
      payload: stock,
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
  if (!rows.length) return false;
  let lastMessage = "";
  for (let attempt = 1; attempt <= SUPABASE_RESULTS_ATTEMPTS; attempt += 1) {
    try {
      await upsertSupabaseRows(SUPABASE_RUNS_TABLE, [buildSupabaseRunRow(runningOutput, runId, "running")], "run_id");
      await upsertSupabaseRows(SUPABASE_RESULTS_TABLE, rows, "run_id,strategy,code");
      await upsertSupabaseRows(SUPABASE_RUNS_TABLE, [buildSupabaseRunRow(output, runId, "complete")], "run_id");
      console.log(`strategy3 supabase upsert ok: ${rows.length} rows into ${SUPABASE_RESULTS_TABLE}, run ${runId}`);
      return true;
    } catch (error) {
      lastMessage = error?.message || String(error);
      console.warn(`strategy3 supabase upsert attempt ${attempt}/${SUPABASE_RESULTS_ATTEMPTS} failed: ${lastMessage}`);
      if (attempt < SUPABASE_RESULTS_ATTEMPTS) await sleep(Math.min(15000, 1500 * attempt));
    }
  }
  console.warn(`strategy3 supabase upsert failed: ${lastMessage}`);
  return false;
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

function analyzeTradingViewOvernightEntry(candles) {
  const rows = (candles || [])
    .map((row) => ({
      ...row,
      open: cleanNumber(row.open),
      high: cleanNumber(row.high),
      low: cleanNumber(row.low),
      close: cleanNumber(row.close),
      volume: cleanNumber(row.volume),
      minutes: candleMinutes(row),
    }))
    .filter((row) => row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0 && row.volume > 0);
  if (rows.length < 35) {
    return { ok: false, reason: `1分K不足 ${rows.length}/35`, signal: "tv_overnight_entry", candleCount: rows.length };
  }
  const moneyFlow = rows.map((row) => (row.high - row.low) === 0 ? 0 : ((row.close - row.open) / (row.high - row.low)) * row.volume);
  const mfAvg = emaSeries(moneyFlow, 8);
  const controlLine = mfAvg.map((_, index) => smaAt(mfAvg, index, 2));
  const rawObv = rows.map((row, index) => {
    if (index === 0) return 0;
    if (row.close > rows[index - 1].close) return row.volume;
    if (row.close < rows[index - 1].close) return -row.volume;
    return 0;
  });
  const obvLine = emaSeries(rawObv, 10);
  const lastSessionRows = rows
    .map((row, index) => ({ row, index }))
    .filter((item) => item.row.minutes != null && item.row.minutes >= 13 * 60 && item.row.minutes <= 13 * 60 + 30);
  if (!lastSessionRows.length) {
    return { ok: false, reason: "缺少 13:00-13:30 尾盤1分K", signal: "tv_overnight_entry", candleCount: rows.length };
  }
  const item = lastSessionRows.at(-1);
  const index = item.index;
  const highest100 = Math.max(...rows.slice(Math.max(0, index - 99), index + 1).map((row) => row.high));
  const isNearHigh = item.row.close >= highest100 * 0.98;
  const currentControl = cleanNumber(controlLine[index]);
  const previousControl = cleanNumber(controlLine[index - 1]);
  const currentObv = cleanNumber(obvLine[index]);
  const controlDirUp = currentControl > previousControl;
  const ok = isNearHigh && currentControl > 0 && controlDirUp && currentObv > 0;
  return {
    ok,
    signal: "tv_overnight_entry",
    candleCount: rows.length,
    lastCandleTime: item.row.candleTime || item.row.time || "",
    nearHigh: isNearHigh,
    highest100: Number(highest100.toFixed(2)),
    close: Number(item.row.close.toFixed(2)),
    controlLine: Number(currentControl.toFixed(2)),
    previousControlLine: Number(previousControl.toFixed(2)),
    controlDirUp,
    obvLine: Number(currentObv.toFixed(2)),
    reason: ok
      ? `TradingView隔日沖進場：13:00-13:30 尾盤、收盤貼近100根高點98%內、控盤線為正且上彎、OBV為正。`
      : `TradingView隔日沖未通過：尾盤=${Boolean(item)}、近高=${isNearHigh}、控盤線=${currentControl.toFixed(2)}、控盤上彎=${controlDirUp}、OBV=${currentObv.toFixed(2)}。`,
  };
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
  const quoteResult = await fetchStrategy3QuoteReady({ minQuotes: 500 });
  if (!quoteResult.ok) throw new Error(quoteResult.error || "strategy3 quote ready unavailable");
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
  const warnings = [];
  let capitalResult = { byCode: new Map() };
  try {
    capitalResult = await fetchStrategy3CapitalMap(stocks.map((stock) => stock.code));
  } catch (error) {
    warnings.push(`stock_capital_latest read skipped: ${error?.message || String(error)}`);
  }
  const issuedSharesMap = new Map(capitalResult.byCode);
  stocks.forEach((stock) => {
    if (cleanNumber(stock.issuedShares) > 0) issuedSharesMap.set(stock.code, cleanNumber(stock.issuedShares));
  });
  const volumeAverageMap = new Map();
  stocks.forEach((stock) => {
    if (stock.avgVolume > 0) volumeAverageMap.set(stock.code, stock.avgVolume);
  });
  if (!access.ok) warnings.push(`strategy3 supabase read access partial: ${access.failed.map((item) => item.table).join(",")}`);
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
    const avgVolume = volumeAverageMap.get(stock.code) || 0;
    const volumeRatio = cleanNumber(stock.volumeRatio) || (avgVolume ? stock.tradeVolume / avgVolume : 0);
    const heatPenalty = pct > 8.8 ? 24 : pct > 6.5 ? 12 : pct < 0 ? 30 : 0;
    const overnightScore = clamp(Math.round(
      Math.min((pct - 3) * 18, 36) +
      Math.min(volumeLots / 80, 18) +
      Math.min(turnoverRate * 6, 30) +
      Math.min(volumeRatio * 12, 20) -
      heatPenalty
    ), 0, 100);
    const turnoverPass = STRATEGY3_REQUIRE_TURNOVER ? turnoverRate > 5 : true;
    const fixedPass = stock.close > 0 && (stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0);
    const fixedReason = fixedPass
      ? `進入 TradingView 隔日沖判斷：有 13:00 後1分K，最終只看 TV 條件。`
      : "未進入 TradingView 隔日沖判斷：缺少價格或 13:00 後1分K。";
    return {
      ...stock,
      valueRank,
      volumeRank,
      volumeLots: Math.round(volumeLots),
      turnoverRate: Number(turnoverRate.toFixed(2)),
      volumeRatio: Number(volumeRatio.toFixed(2)),
      projectedRatio: Number(volumeRatio.toFixed(2)),
      overnightScore,
      overnightState: fixedPass ? "待TV判斷" : "觀察",
      score: overnightScore,
      matches: [{ id: "overnight_chip", reason: fixedReason }],
    };
  })
    .filter((stock) => stock.close > 0 && (stock.hasAfter1300Candle || cleanNumber(stock.after1300CandleCount) > 0))
    .sort((a, b) => b.overnightScore - a.overnightScore || b.value - a.value)
    .slice(0, STRATEGY3_TV_CANDIDATE_LIMIT > 0 ? STRATEGY3_TV_CANDIDATE_LIMIT : undefined);

  if (!STRATEGY3_REQUIRE_TV_ENTRY) return scored.slice(0, 80);

  const analyzed = await mapLimit(scored, STRATEGY3_TV_CONCURRENCY, async (stock) => {
    try {
      const result = await fetchStrategy3Intraday1mLatestN(stock.code, STRATEGY3_TV_CANDLE_LIMIT);
      const tvEntry = analyzeTradingViewOvernightEntry(result.candles || result.rows || []);
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
    .filter((stock) => stock.tvOvernightEntry?.ok)
    .sort((a, b) => b.overnightScore - a.overnightScore || b.value - a.value)
    .slice(0, 80);
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
  }
  if (!stocks.length) throw new Error("No stock universe");
  const exclusionResult = applyStrategy3Exclusions(stocks, loadStrategy3Blacklist());
  stocks = exclusionResult.stocks;
  exclusionStats = exclusionResult.stats;
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
  const matches = await buildMatches(stocks, issuedSharesMap, volumeAverageMap, sourceWarnings);
  const quoteDate = stocks.find((stock) => stock.quoteDate)?.quoteDate || "";
  const output = {
    ok: true,
    source,
    startedAt,
    updatedAt: new Date().toISOString(),
    usedDate: quoteDate,
    total: stocks.length,
    count: matches.length,
    complete: true,
    sourceWarnings,
    qualityStatus: sourceHealth.status,
    sourceHealth,
    matches,
  };

  preservePreviousTradingSource((previousRaw.matches || []).length ? previousRaw : backup, output);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  if (!matches.length) {
    const previousUsable = (previousRaw.matches || []).length && previousRaw.source !== "github-actions-backup-readonly";
    const fallback = previousUsable ? previousRaw : backup;
    if ((fallback.matches || []).length) {
      fs.writeFileSync(OUT_FILE, `${JSON.stringify({
        ...fallback,
        source: fallback.source === "github-actions-backup-readonly" ? "github-actions-backup" : fallback.source,
        preservedAt: new Date().toISOString(),
        preservedReason: "strategy3 current scan produced zero matches",
      }, null, 2)}\n`);
    }
    throw new Error("Strategy3 scan produced zero matches; preserved previous valid output and refused to publish an empty result");
  }
  await upsertStrategy3ResultsToSupabase(output);
  fs.writeFileSync(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(BACKUP_FILE, `${JSON.stringify({ ...output, source: "github-actions-backup" }, null, 2)}\n`);
  console.log(`strategy3 cache updated: matches ${matches.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

