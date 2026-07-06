const fs = require("fs");
const path = require("path");

const {
  FUGLE_FUTOPT_WS_CANDLES_FILE,
  FUGLE_FUTOPT_WS_QUOTES_FILE,
  FUGLE_FUTOPT_WS_STATUS_FILE,
  normalizeFutureSymbol,
  normalizeFutoptCandle,
  normalizeFutoptQuote,
  readJson,
  writeJson,
} = require("../lib/fugle-futopt-websocket");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const API_KEY_FILES = [
  path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt"),
  "C:/fuman-terminal/secrets/fugle-api-key.txt",
];
const FUTOPT_TICKERS_CACHE_FILES = [
  path.join(RUNTIME_DIR, "cache", "intraday", "fugle-futopt-tickers.json"),
  "C:/fuman-terminal/ops/public-slot/runtime/public-slot-futopt-tickers-cache.json",
];
const STOCKS_SLIM_FILES = [
  path.join(RUNTIME_DIR, "data", "stocks-slim.json"),
  "C:/fuman-terminal/data/stocks-slim.json",
];

const STREAMING_URL = process.env.FUGLE_FUTOPT_STREAMING_URL || "wss://api.fugle.tw/marketdata/v1.0/futopt/streaming";
const STREAMING_CHANNELS = [...new Set(String(process.env.FUGLE_FUTOPT_STREAMING_CHANNELS || "trades,aggregates,candles")
  .split(",")
  .map((channel) => channel.trim().toLowerCase())
  .filter(Boolean))];
const STREAMING_MAX_SYMBOLS = Math.max(1, Number(process.env.FUGLE_FUTOPT_STREAMING_MAX_SYMBOLS || 500));
const STREAMING_MAX_TOTAL_SUBSCRIPTIONS = Math.max(STREAMING_CHANNELS.length, Number(process.env.FUGLE_FUTOPT_STREAMING_MAX_TOTAL_SUBSCRIPTIONS || 1800));
const STREAMING_SUBSCRIBE_CHUNK_SIZE = Math.max(1, Math.min(50, Number(process.env.FUGLE_FUTOPT_STREAMING_SUBSCRIBE_CHUNK_SIZE || 50)));
const STREAMING_RESUBSCRIBE_MS = Math.max(30000, Number(process.env.FUGLE_FUTOPT_STREAMING_RESUBSCRIBE_MS || 60000));
const STREAMING_RECONNECT_MS = Math.max(3000, Number(process.env.FUGLE_FUTOPT_STREAMING_RECONNECT_MS || 10000));
const STREAMING_STATUS_MS = Math.max(1000, Number(process.env.FUGLE_FUTOPT_STREAMING_STATUS_MS || 5000));
const CACHE_TTL_MS = Math.max(30000, Number(process.env.FUGLE_FUTOPT_WS_CACHE_TTL_MS || 5 * 60 * 1000));

let lastMessageAt = "";

function readSecret(paths) {
  for (const file of paths) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function nowIso() {
  return new Date().toISOString();
}

function cleanStockName(value) {
  return String(value || "")
    .trim()
    .replace(/期貨\d*$/u, "")
    .replace(/\s+/g, "");
}

function normalizeCode(value) {
  const text = String(value || "").replace(/\D/g, "").slice(0, 4);
  return /^\d{4}$/.test(text) ? text : "";
}

function readStocksLookup() {
  for (const file of STOCKS_SLIM_FILES) {
    const payload = readJson(file, null);
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.stocks) ? payload.stocks : Array.isArray(payload?.data) ? payload.data : [];
    if (!rows.length) continue;
    const lookup = new Map();
    for (const row of rows) {
      const code = normalizeCode(row.code || row.symbol);
      const name = cleanStockName(row.name);
      if (code && name && !lookup.has(name)) lookup.set(name, { symbol: code, name: row.name || name });
    }
    if (lookup.size) return lookup;
  }
  return new Map();
}

function readFutoptTickersPayload() {
  for (const file of FUTOPT_TICKERS_CACHE_FILES) {
    const payload = readJson(file, null);
    if (payload && Array.isArray(payload.data) && payload.data.length) return { payload, file };
  }
  return { payload: { data: [] }, file: "" };
}

function buildTickerRows() {
  const { payload, file } = readFutoptTickersPayload();
  const stockLookup = readStocksLookup();
  const rows = [];
  for (const item of payload.data || []) {
    const futureSymbol = normalizeFutureSymbol(item.symbol);
    if (!futureSymbol) continue;
    const contractType = String(item.contractType || "");
    const name = String(item.name || futureSymbol);
    let product = "FUTURE";
    let underlyingSymbol = "";
    let underlyingName = "";
    if (contractType === "S") {
      product = "STOCK_FUTURE";
      const key = cleanStockName(name);
      const stock = stockLookup.get(key);
      underlyingSymbol = stock?.symbol || "";
      underlyingName = stock?.name || key;
    } else if (/^TXF/i.test(futureSymbol)) {
      product = "TXF";
      underlyingSymbol = "TXF";
      underlyingName = "TAIEX";
    }
    rows.push({
      future_symbol: futureSymbol,
      name,
      product,
      contract_type: contractType,
      end_date: item.endDate || "",
      exchange: item.exchange || "TAIFEX",
      underlying_symbol: underlyingSymbol,
      underlying_name: underlyingName,
      session: payload.session || item.session || "REGULAR",
      payload: item,
    });
  }
  rows.cacheFile = file;
  rows.stockLookupCount = stockLookup.size;
  return rows;
}

function futureEndTime(row) {
  const parsed = Date.parse(row.end_date || "");
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function selectStreamingTickers() {
  const rows = buildTickerRows();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const byUnderlying = new Map();
  for (const row of rows) {
    if (row.product !== "STOCK_FUTURE" || !normalizeCode(row.underlying_symbol)) continue;
    const prev = byUnderlying.get(row.underlying_symbol);
    if (!prev || futureEndTime(row) < futureEndTime(prev)) byUnderlying.set(row.underlying_symbol, row);
  }
  const txf = rows
    .filter((row) => row.product === "TXF" && /^TXF/i.test(row.future_symbol) && !/-[FS]$/i.test(row.future_symbol))
    .sort((a, b) => futureEndTime(a) - futureEndTime(b) || a.future_symbol.localeCompare(b.future_symbol))
    .slice(0, 2);
  const selectedRows = [...txf, ...byUnderlying.values()]
    .filter((row) => futureEndTime(row) >= today.getTime())
    .sort((a, b) => {
      if (a.product === "TXF" && b.product !== "TXF") return -1;
      if (b.product === "TXF" && a.product !== "TXF") return 1;
      return a.future_symbol.localeCompare(b.future_symbol);
    });
  const maxSymbolsBySubscriptionBudget = Math.max(1, Math.floor(STREAMING_MAX_TOTAL_SUBSCRIPTIONS / Math.max(1, STREAMING_CHANNELS.length)));
  const symbolLimit = Math.min(STREAMING_MAX_SYMBOLS, maxSymbolsBySubscriptionBudget);
  return {
    allRows: rows,
    selectedRows: selectedRows.slice(0, symbolLimit),
    selectedSymbols: selectedRows.slice(0, symbolLimit).map((row) => row.future_symbol),
    requestedSymbols: selectedRows.length,
    symbolLimit,
    tickerCacheFile: rows.cacheFile || "",
    stockLookupCount: rows.stockLookupCount || 0,
  };
}

function chunkArray(values, size) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function mergeQuotes(newQuotes) {
  const current = readJson(FUGLE_FUTOPT_WS_QUOTES_FILE, {});
  const rows = Array.isArray(current.quotes) ? current.quotes : [];
  const cutoff = Date.now() - CACHE_TTL_MS;
  const bySymbol = new Map();
  for (const row of rows) {
    const seen = Date.parse(row.quoteSeenAt || row.updated_at || current.updatedAt || "");
    const futureSymbol = normalizeFutureSymbol(row.future_symbol);
    if (futureSymbol && Number.isFinite(seen) && seen >= cutoff) bySymbol.set(futureSymbol, row);
  }
  for (const quote of newQuotes) bySymbol.set(quote.future_symbol, quote);
  const quotes = [...bySymbol.values()].sort((a, b) => a.future_symbol.localeCompare(b.future_symbol));
  writeJson(FUGLE_FUTOPT_WS_QUOTES_FILE, {
    source: "fugle-futopt-websocket-streaming",
    channel: `websocket:${STREAMING_CHANNELS.join(",")}`,
    channels: STREAMING_CHANNELS,
    updatedAt: nowIso(),
    count: quotes.length,
    quotes,
  });
  return quotes.length;
}

function mergeCandles(newCandles) {
  const current = readJson(FUGLE_FUTOPT_WS_CANDLES_FILE, {});
  const rows = Array.isArray(current.candles) ? current.candles : [];
  const cutoff = Date.now() - Math.max(CACHE_TTL_MS, 10 * 60 * 1000);
  const byKey = new Map();
  for (const row of rows) {
    const seen = Date.parse(row.candleSeenAt || row.updated_at || current.updatedAt || "");
    const futureSymbol = normalizeFutureSymbol(row.future_symbol);
    const candleTime = row.candle_time || row.candleTime || row.date || "";
    if (futureSymbol && candleTime && Number.isFinite(seen) && seen >= cutoff) byKey.set(`${futureSymbol}|${candleTime}`, row);
  }
  for (const candle of newCandles) byKey.set(`${candle.future_symbol}|${candle.candle_time}`, candle);
  const candles = [...byKey.values()].sort((a, b) => {
    const bySymbol = a.future_symbol.localeCompare(b.future_symbol);
    if (bySymbol) return bySymbol;
    return Date.parse(a.candle_time || "") - Date.parse(b.candle_time || "");
  });
  writeJson(FUGLE_FUTOPT_WS_CANDLES_FILE, {
    source: "fugle-futopt-websocket-streaming",
    channel: "websocket:candles",
    updatedAt: nowIso(),
    count: candles.length,
    candles,
  });
  return candles.length;
}

function getNotice(payload, text) {
  const eventName = String(payload?.event || payload?.type || "").toLowerCase();
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const notice = [payload?.message, payload?.error, payload?.reason, data.message, data.error, data.reason].filter(Boolean).join(" ");
  if (notice.trim()) return { eventName, noticeText: notice.trim() };
  if (!payload && /forbidden|rate.?limit|subscribe.?limit|exceed/i.test(String(text || ""))) return { eventName: "raw", noticeText: String(text || "").slice(0, 600) };
  return { eventName, noticeText: "" };
}

function writeStatus(extra = {}) {
  writeJson(FUGLE_FUTOPT_WS_STATUS_FILE, {
    ok: extra.ok !== false,
    pid: process.pid,
    mode: "streaming",
    source: "fugle-futopt-websocket",
    streamingUrl: STREAMING_URL,
    streamingChannels: STREAMING_CHANNELS,
    subscriptionLimit: STREAMING_MAX_TOTAL_SUBSCRIPTIONS,
    maxSymbols: STREAMING_MAX_SYMBOLS,
    updatedAt: nowIso(),
    ...extra,
  });
}

async function run() {
  const apiKey = readSecret(API_KEY_FILES);
  if (!apiKey) {
    writeStatus({ ok: false, error: "fugle api key missing" });
    return;
  }

  const runOnce = () => new Promise((resolve) => {
    let selection = selectStreamingTickers();
    let chunks = chunkArray(selection.selectedSymbols, STREAMING_SUBSCRIBE_CHUNK_SIZE);
    const tickerBySymbol = new Map(selection.selectedRows.map((row) => [row.future_symbol, row]));
    let ws;
    let openedAt = "";
    let authenticated = false;
    let messages = 0;
    let quoteMessages = 0;
    let candleMessages = 0;
    let chunksSent = 0;
    let cycles = 0;
    let closed = false;
    let lastSubscribeSignature = "";
    let forbiddenChunks = 0;
    let lastForbiddenAt = "";
    let lastForbiddenMessage = "";

    const writeStreamingStatus = (extra = {}) => {
      writeStatus({
        websocketConnected: Boolean(ws && ws.readyState === WebSocket.OPEN),
        websocketAuthenticated: authenticated,
        streamingOpenedAt: openedAt,
        streamingMessages: messages,
        streamingQuotes: quoteMessages,
        streamingCandles: candleMessages,
        selectedSymbols: selection.selectedSymbols.length,
        requestedSymbols: selection.requestedSymbols,
        tickerRows: selection.allRows.length,
        tickerCacheFile: selection.tickerCacheFile,
        stockLookupCount: selection.stockLookupCount,
        subscribed: selection.selectedSymbols.length * STREAMING_CHANNELS.length,
        subscribedSymbols: selection.selectedSymbols.length,
        subscribedChannels: STREAMING_CHANNELS.length,
        subscribeChunkSize: STREAMING_SUBSCRIBE_CHUNK_SIZE,
        subscribeChunks: chunks.length * STREAMING_CHANNELS.length,
        subscribeChunksSent: chunksSent,
        subscribeCycles: cycles,
        resubscribeEveryMs: STREAMING_RESUBSCRIBE_MS,
        subscribeForbiddenChunks: forbiddenChunks,
        subscribeForbiddenLastAt: lastForbiddenAt,
        subscribeForbiddenLastMessage: lastForbiddenMessage,
        lastMessageAt,
        ...extra,
      });
    };

    const subscribe = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      selection = selectStreamingTickers();
      chunks = chunkArray(selection.selectedSymbols, STREAMING_SUBSCRIBE_CHUNK_SIZE);
      const signature = `${STREAMING_CHANNELS.join(",")}|${selection.selectedSymbols.join(",")}`;
      if (lastSubscribeSignature && signature === lastSubscribeSignature) {
        writeStreamingStatus();
        return;
      }
      if (lastSubscribeSignature && signature !== lastSubscribeSignature) {
        ws.close(1000, "ticker selection changed; reconnect before resubscribe");
        return;
      }
      lastSubscribeSignature = signature;
      tickerBySymbol.clear();
      selection.selectedRows.forEach((row) => tickerBySymbol.set(row.future_symbol, row));
      cycles += 1;
      for (const channel of STREAMING_CHANNELS) {
        for (const symbols of chunks) {
          ws.send(JSON.stringify({ event: "subscribe", data: { channel, symbols } }));
          chunksSent += 1;
        }
      }
      writeStreamingStatus();
    };

    try {
      ws = new WebSocket(STREAMING_URL);
      ws.addEventListener("open", () => {
        openedAt = nowIso();
        ws.send(JSON.stringify({ event: "auth", data: { apikey: apiKey } }));
        setTimeout(subscribe, 800);
        writeStreamingStatus();
      });
      ws.addEventListener("message", (event) => {
        messages += 1;
        let payload = null;
        try { payload = JSON.parse(String(event.data || "")); } catch {}
        const text = String(event.data || "");
        if (/authenticated|auth/i.test(text)) authenticated = true;
        const notice = getNotice(payload, text);
        if (/forbidden|rate.?limit|subscribe.?limit|exceed/i.test(notice.noticeText)) {
          forbiddenChunks += 1;
          lastForbiddenAt = nowIso();
          lastForbiddenMessage = notice.noticeText.slice(0, 600);
        }
        const data = payload?.data || payload || {};
        const payloadChannel = String(data.channel || payload?.channel || "").toLowerCase();
        const inferredChannel = payloadChannel
          || (Object.prototype.hasOwnProperty.call(data, "serial") || Object.prototype.hasOwnProperty.call(data, "size") ? "trades" : "")
          || (Object.prototype.hasOwnProperty.call(data, "open") && Object.prototype.hasOwnProperty.call(data, "close") && data.date ? "candles" : "")
          || (data.total || data.bids || data.asks || Object.prototype.hasOwnProperty.call(data, "openPrice") ? "aggregates" : "")
          || STREAMING_CHANNELS[0];
        const futureSymbol = normalizeFutureSymbol(data.symbol || data.future_symbol);
        const ticker = tickerBySymbol.get(futureSymbol) || null;
        if (inferredChannel === "candles") {
          const candle = normalizeFutoptCandle(payload, ticker);
          if (candle) {
            candleMessages += 1;
            lastMessageAt = nowIso();
            mergeCandles([candle]);
          }
          return;
        }
        const quote = normalizeFutoptQuote(payload, ticker);
        if (quote) {
          quoteMessages += 1;
          lastMessageAt = nowIso();
          mergeQuotes([quote]);
        }
      });
      ws.addEventListener("error", (event) => {
        writeStreamingStatus({ ok: false, websocketError: event?.message || "websocket_error" });
      });
      ws.addEventListener("close", () => {
        closed = true;
        writeStreamingStatus({ websocketConnected: false });
        resolve();
      });
      const statusTimer = setInterval(() => {
        if (closed) clearInterval(statusTimer);
        else writeStreamingStatus();
      }, STREAMING_STATUS_MS);
      const subscribeTimer = setInterval(() => {
        if (closed) clearInterval(subscribeTimer);
        else subscribe();
      }, STREAMING_RESUBSCRIBE_MS);
    } catch (error) {
      writeStreamingStatus({ ok: false, websocketError: error?.message || String(error) });
      resolve();
    }
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runOnce();
    await new Promise((resolve) => setTimeout(resolve, STREAMING_RECONNECT_MS));
  }
}

writeStatus({ starting: true });
run().catch((error) => {
  writeStatus({ ok: false, error: error?.message || String(error) });
  process.exit(1);
});
