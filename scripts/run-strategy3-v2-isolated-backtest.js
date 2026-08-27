const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const BACKTEST_DIR = path.join(RUNTIME_DIR, "data", "backtest", "strategy3-v2");
const args = process.argv.slice(2);

function valueArg(name, fallback = "") {
  const value = args.find((arg) => arg.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : fallback;
}

function normalizeDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits)
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : "";
}

function normalizeSymbol(value) {
  const symbol = String(value || "").replace(/\D/g, "").slice(0, 4);
  return /^\d{4}$/.test(symbol) ? symbol : "";
}

function normalizeSymbols(value) {
  return [...new Set(String(value || "").split(/[,:;\s]+/).map(normalizeSymbol).filter(Boolean))];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readSecret(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function taipeiDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function taipeiMinute(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return get("hour") * 60 + get("minute");
}

function normalizeCandles(rawCandles, tradeDate) {
  const seen = new Map();
  for (const raw of Array.isArray(rawCandles) ? rawCandles : []) {
    const candleTime = String(raw.date || raw.candleTime || raw.time || "");
    const time = new Date(candleTime);
    const close = Number(raw.close);
    const volume = Number(raw.volume);
    const minute = taipeiMinute(time);
    if (taipeiDate(time) !== tradeDate || !Number.isFinite(close) || close <= 0 || minute === null) continue;
    if (minute < 9 * 60 || minute > 13 * 60 + 30) continue;
    seen.set(time.toISOString(), {
      candle_time: time.toISOString(),
      minute,
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return [...seen.values()].sort((a, b) => a.candle_time.localeCompare(b.candle_time));
}

async function fetchHistoricalCandles(symbol, tradeDate, apiKey) {
  const query = new URLSearchParams({
    timeframe: "1",
    from: tradeDate,
    to: tradeDate,
    sort: "asc",
    fields: "open,high,low,close,volume",
  });
  const response = await fetch(
    `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/${encodeURIComponent(symbol)}?${query}`,
    { headers: { "X-API-KEY": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(45_000) },
  );
  const text = await response.text();
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`HTTP_${response.status}:${text.slice(0, 160)}`);
  const parsed = text ? JSON.parse(text) : [];
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : []);
}

function inspectSymbol(symbol, candles) {
  const entryCandles = candles.filter((candle) => candle.minute >= 12 * 60 + 59 && candle.minute <= 13 * 60 + 2);
  const historyBeforeEntry = candles.filter((candle) => candle.minute < 12 * 60 + 59);
  const reasons = [];
  if (!candles.length) reasons.push("no_formal_1m_rows_same_trade_date");
  if (candles.length > 0 && candles.length < 20) reasons.push("candle_count_under_20");
  if (!entryCandles.length) reasons.push("entry_window_1259_1302_missing");
  if (entryCandles.length && historyBeforeEntry.length < 5) reasons.push("entry_history_under_5");
  return {
    symbol,
    status: reasons.length ? "DATA_GAP" : "READY_FOR_BACKTEST",
    reason_code: reasons[0] || "same_day_formal_1m_ready",
    data_gap_reasons: reasons,
    candle_count: candles.length,
    first_candle_time: candles[0]?.candle_time || null,
    last_candle_time: candles.at(-1)?.candle_time || null,
    entry_window_count: entryCandles.length,
    history_before_entry_count: historyBeforeEntry.length,
    entry_candle_time: entryCandles[0]?.candle_time || null,
    entry_price: entryCandles[0]?.close ?? null,
  };
}

async function main() {
  const tradeDate = normalizeDate(valueArg("--trade-date"));
  const inputFile = valueArg("--input-file");
  const suppliedSymbols = normalizeSymbols(valueArg("--symbols"));
  if (!tradeDate) throw new Error("missing --trade-date=YYYY-MM-DD");

  const fixture = inputFile ? readJson(path.resolve(inputFile)) : null;
  const symbols = fixture
    ? [...new Set([...(fixture.symbols || []), ...Object.keys(fixture.candles_by_symbol || {})].map(normalizeSymbol).filter(Boolean))]
    : suppliedSymbols;
  if (!symbols.length) throw new Error("provide --symbols=2330,2317 or --input-file=fixture.json");

  const apiKey = fixture ? "fixture" : (process.env.FUGLE_API_KEY || readSecret(path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt")));
  if (!apiKey) throw new Error("missing Fugle API key for historical-only backtest");

  const symbolsReadback = [];
  for (const symbol of symbols) {
    try {
      const rawCandles = fixture
        ? (fixture.candles_by_symbol?.[symbol] || [])
        : await fetchHistoricalCandles(symbol, tradeDate, apiKey);
      symbolsReadback.push(inspectSymbol(symbol, normalizeCandles(rawCandles, tradeDate)));
    } catch (error) {
      symbolsReadback.push({
        symbol,
        status: "DATA_GAP",
        reason_code: "historical_candle_fetch_failed",
        data_gap_reasons: ["historical_candle_fetch_failed"],
        candle_count: 0,
        first_candle_time: null,
        last_candle_time: null,
        entry_window_count: 0,
        history_before_entry_count: 0,
        entry_candle_time: null,
        entry_price: null,
        error: error.message || String(error),
      });
    }
  }

  const ready = symbolsReadback.filter((row) => row.status === "READY_FOR_BACKTEST");
  const receipt = {
    schema_version: "strategy3-v2-isolated-backtest-v1",
    backtest_only: true,
    formal_allowed: false,
    publish_allowed: false,
    line_allowed: false,
    supabase_write_allowed: false,
    formal_receipt_write_allowed: false,
    source: fixture ? "fixture" : "fugle_historical_candles",
    endpoint: fixture ? null : "https://api.fugle.tw/marketdata/v1.0/stock/historical/candles",
    trade_date: tradeDate,
    generated_at: new Date().toISOString(),
    input_symbols: symbols,
    input_symbol_count: symbols.length,
    ready_symbol_count: ready.length,
    data_gap_count: symbolsReadback.length - ready.length,
    strategy: {
      entry_window: "12:59-13:02 Asia/Taipei",
      min_candles_per_symbol: 20,
      min_history_before_entry: 5,
    },
    symbols: symbolsReadback,
    write_target: path.join(BACKTEST_DIR, `strategy3-v2-isolated-backtest-${tradeDate.replace(/-/g, "")}.json`),
  };

  fs.mkdirSync(BACKTEST_DIR, { recursive: true });
  fs.writeFileSync(receipt.write_target, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, backtest_only: true, error: error.message || String(error) }, null, 2));
  process.exit(1);
});
