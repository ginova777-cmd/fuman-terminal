const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");

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
const STREAMING_RECONNECT_INITIAL_MS = Math.max(1000, Number(
  process.env.FUGLE_FUTOPT_STREAMING_RECONNECT_INITIAL_MS
  || process.env.FUGLE_FUTOPT_STREAMING_RECONNECT_MS
  || 1000,
));
const STREAMING_RECONNECT_MAX_MS = Math.max(STREAMING_RECONNECT_INITIAL_MS, Number(
  process.env.FUGLE_FUTOPT_STREAMING_RECONNECT_MAX_MS
  || 30000,
));
const STREAMING_STATUS_MS = Math.max(1000, Number(process.env.FUGLE_FUTOPT_STREAMING_STATUS_MS || 5000));
const FORMAL_LIVE_MIRROR_MS = Math.max(30000, Number(process.env.FUGLE_FUTOPT_FORMAL_LIVE_MIRROR_MS || 30000));
const FORMAL_LIVE_MIRROR_RETRIES = Math.max(1, Math.min(4, Number(process.env.FUGLE_FUTOPT_FORMAL_LIVE_MIRROR_RETRIES || 3)));
const FORMAL_LIVE_MIRROR_BACKOFF_MS = Math.max(250, Number(process.env.FUGLE_FUTOPT_FORMAL_LIVE_MIRROR_BACKOFF_MS || 1000));
const FORMAL_LIVE_MIRROR_TIMEOUT_MS = Math.max(1000, Number(process.env.FUGLE_FUTOPT_FORMAL_LIVE_MIRROR_TIMEOUT_MS || 10000));
const CACHE_TTL_MS = Math.max(30000, Number(process.env.FUGLE_FUTOPT_WS_CACHE_TTL_MS || 5 * 60 * 1000));
const STREAMING_AFTER_HOURS_RAW = String(process.env.FUGLE_FUTOPT_STREAMING_AFTER_HOURS || "").trim().toLowerCase();
const STREAMING_AFTER_HOURS = /^(1|true|yes|on)$/.test(STREAMING_AFTER_HOURS_RAW)
  ? true
  : /^(0|false|no|off)$/.test(STREAMING_AFTER_HOURS_RAW)
    ? false
    : null;

const FORMAL_LIVE_MIRROR_RECEIPT_FILE = path.join(path.dirname(FUGLE_FUTOPT_WS_STATUS_FILE), "fugle-daytrade-futopt-live-mirror.json");
const COLLECTOR_RELEASE = "futopt-formal-live-mirror-v3";

let lastMessageAt = "";
let lastFormalLiveMirrorAt = 0;
let formalLiveMirrorInFlight = false;

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
    // Select the nearest still-tradable contract. Picking the nearest first and
    // filtering expiry later can eliminate an entire underlying after expiry.
    if (futureEndTime(row) < today.getTime()) continue;
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

function buildSubscribeMessage(channel, symbols) {
  const data = { channel, symbols };
  if (STREAMING_AFTER_HOURS !== null) data.afterHours = STREAMING_AFTER_HOURS;
  return { event: "subscribe", data };
}
function writeStatus(extra = {}) {
  const payload = {
    ok: extra.ok !== false,
    pid: process.pid,
    collector_release: COLLECTOR_RELEASE,
    mode: "streaming",
    source: "fugle-futopt-websocket",
    streamingUrl: STREAMING_URL,
    streamingChannels: STREAMING_CHANNELS,
    subscriptionLimit: STREAMING_MAX_TOTAL_SUBSCRIPTIONS,
    maxSymbols: STREAMING_MAX_SYMBOLS,
    updatedAt: nowIso(),
    ...extra,
  };
  writeJson(FUGLE_FUTOPT_WS_STATUS_FILE, payload);
  return payload;
}

function retryableFormalLiveMirrorError(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 521;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options, timeoutMs = FORMAL_LIVE_MIRROR_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error(`futopt_formal_live_mirror_timeout_${timeoutMs}ms`), { status: 408 });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function freshFormalFutoptRows(checkedAt) {
  const cache = readJson(FUGLE_FUTOPT_WS_QUOTES_FILE, {});
  const rows = Array.isArray(cache?.quotes) ? cache.quotes : [];
  const freshnessCutoff = Date.now() - 180000;
  return rows
    .filter((quote) => {
      const seen = Date.parse(quote.quoteSeenAt || quote.updated_at || cache.updatedAt || "");
      return normalizeFutureSymbol(quote.future_symbol) && Number.isFinite(seen) && seen >= freshnessCutoff && finiteNumber(quote.last_price ?? quote.price) > 0;
    })
    .map((quote) => {
      const futureSymbol = normalizeFutureSymbol(quote.future_symbol);
      const product = quote.product || (futureSymbol.startsWith("TXF") ? "TXF" : "STOCK_FUTURE");
      return {
        future_symbol: futureSymbol,
        underlying_symbol: quote.underlying_symbol || (futureSymbol.startsWith("TXF") ? "TXF" : null),
        underlying_name: quote.underlying_name || null,
        updated_at: quote.quoteSeenAt || quote.updated_at || cache.updatedAt || checkedAt,
        last_price: finiteNumber(quote.last_price ?? quote.price),
        open_price: finiteNumber(quote.open_price),
        high_price: finiteNumber(quote.high_price ?? quote.last_price ?? quote.price),
        low_price: finiteNumber(quote.low_price ?? quote.last_price ?? quote.price),
        previous_close: finiteNumber(quote.previous_close),
        change_percent: finiteNumber(quote.change_percent),
        total_volume: finiteNumber(quote.total_volume ?? quote.volume),
        product,
        session: quote.session || "",
        source: "fugle_futopt_websocket_collector:formal_live_mirror",
        payload: {
          ...(quote.payload || {}),
          source: "fugle_futopt_websocket_collector:formal_live_mirror",
          quote_seen_at: quote.quoteSeenAt || "",
          collector_checked_at: checkedAt,
          formal_fugle_websocket: true,
        },
      };
    });
}

async function mirrorFormalFutoptLive() {
  const checkedAt = nowIso();
  const receipt = {
    contract: "fugle_daytrade_futopt_formal_live_mirror_v1",
    checked_at: checkedAt,
    interval_seconds: Math.round(FORMAL_LIVE_MIRROR_MS / 1000),
    retry_limit: FORMAL_LIVE_MIRROR_RETRIES,
    attempts: 0,
    status: "pending",
    first_blocker: null,
  };
  const baseUrl = serverSupabaseUrl();
  const apiKey = serverSupabaseKey();
  if (!baseUrl || !apiKey) {
    receipt.status = "blocked";
    receipt.first_blocker = "formal_live_mirror_credentials_missing";
    writeJson(FORMAL_LIVE_MIRROR_RECEIPT_FILE, receipt);
    return receipt;
  }
  const rows = freshFormalFutoptRows(checkedAt);
  receipt.fresh_rows = rows.length;
  receipt.txf_rows = rows.filter((row) => row.product === "TXF" || String(row.future_symbol).startsWith("TXF")).length;
  receipt.stock_future_rows = rows.filter((row) => row.product === "STOCK_FUTURE").length;
  if (!rows.length) {
    receipt.status = "no_fresh_formal_futopt_rows";
    receipt.first_blocker = "futopt_websocket_cache_no_fresh_rows";
    writeJson(FORMAL_LIVE_MIRROR_RECEIPT_FILE, receipt);
    return receipt;
  }
  for (let attempt = 1; attempt <= FORMAL_LIVE_MIRROR_RETRIES; attempt += 1) {
    receipt.attempts = attempt;
    try {
      const response = await fetchWithTimeout(`${baseUrl}/rest/v1/fugle_daytrade_futopt_quotes_live?on_conflict=future_symbol`, {
        method: "POST",
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      if (!response.ok) throw Object.assign(new Error(`futopt_formal_live_mirror_http_${response.status}`), { status: response.status });
      receipt.status = "written";
      writeJson(FORMAL_LIVE_MIRROR_RECEIPT_FILE, receipt);
      return receipt;
    } catch (error) {
      const status = Number(error?.status || 0);
      receipt.last_error = error?.message || String(error);
      if (attempt >= FORMAL_LIVE_MIRROR_RETRIES || !retryableFormalLiveMirrorError(status)) {
        receipt.status = "retry_exhausted";
        receipt.first_blocker = status ? `futopt_formal_live_mirror_http_${status}` : "futopt_formal_live_mirror_exception";
        writeJson(FORMAL_LIVE_MIRROR_RECEIPT_FILE, receipt);
        return receipt;
      }
      const delayMs = Math.min(60000, FORMAL_LIVE_MIRROR_BACKOFF_MS * (2 ** (attempt - 1)));
      receipt.next_retry_at = new Date(Date.now() + delayMs).toISOString();
      writeJson(FORMAL_LIVE_MIRROR_RECEIPT_FILE, receipt);
      await delay(delayMs);
    }
  }
  return receipt;
}

function scheduleFormalFutoptLiveMirror() {
  if (formalLiveMirrorInFlight || Date.now() - lastFormalLiveMirrorAt < FORMAL_LIVE_MIRROR_MS) return;
  lastFormalLiveMirrorAt = Date.now();
  formalLiveMirrorInFlight = true;
  mirrorFormalFutoptLive()
    .catch((error) => writeJson(FORMAL_LIVE_MIRROR_RECEIPT_FILE, {
      contract: "fugle_daytrade_futopt_formal_live_mirror_v1",
      checked_at: nowIso(),
      status: "retry_exhausted",
      first_blocker: "futopt_formal_live_mirror_exception",
      error: error?.message || String(error),
    }))
    .finally(() => { formalLiveMirrorInFlight = false; });
}
async function run() {
  const apiKey = readSecret(API_KEY_FILES);
  if (!apiKey) {
    writeStatus({ ok: false, formalReady: false, formalReadyReason: "api_key_missing", error: "fugle api key missing" });
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
      const messageAgeSeconds = lastMessageAt ? Math.max(0, Math.round((Date.now() - Date.parse(lastMessageAt)) / 1000)) : null;
      const requiredChannelsReady = ["trades", "aggregates", "candles"].every((channel) => STREAMING_CHANNELS.includes(channel));
      const formalReady = extra.ok !== false
        && Boolean(ws && ws.readyState === WebSocket.OPEN)
        && authenticated
        && requiredChannelsReady
        && selection.selectedSymbols.length > 0
        && selection.allRows.length > 0
        && quoteMessages + candleMessages > 0
        && lastMessageAt
        && Number.isFinite(messageAgeSeconds)
        && messageAgeSeconds <= 300
        && forbiddenChunks === 0;
      const formalReadyReason = formalReady
        ? "streaming_authenticated_required_channels_and_subscription_ready"
        : extra.ok === false
          ? "websocket_status_error"
          : !ws || ws.readyState !== WebSocket.OPEN
            ? "websocket_not_open"
            : !authenticated
              ? "websocket_not_authenticated"
              : !requiredChannelsReady
                ? "websocket_required_channel_missing"
                : !lastMessageAt
                  ? "websocket_no_message"
                  : !Number.isFinite(messageAgeSeconds) || messageAgeSeconds > 300
                    ? "websocket_last_message_stale"
                    : forbiddenChunks > 0
                      ? "websocket_subscription_forbidden"
                      : "websocket_transport_not_formal_ready";
      const statusSnapshot = writeStatus({
        websocketConnected: Boolean(ws && ws.readyState === WebSocket.OPEN),
        websocketAuthenticated: authenticated,
        formalReady,
        formalReadyReason,
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
        afterHours: STREAMING_AFTER_HOURS,
        afterHoursMode: STREAMING_AFTER_HOURS === null ? "default" : STREAMING_AFTER_HOURS ? "afterhours" : "regular",
        subscribeChunkSize: STREAMING_SUBSCRIBE_CHUNK_SIZE,
        subscribeChunks: chunks.length * STREAMING_CHANNELS.length,
        subscribeChunksSent: chunksSent,
        subscribeCycles: cycles,
        resubscribeEveryMs: STREAMING_RESUBSCRIBE_MS,
        reconnectInitialMs: STREAMING_RECONNECT_INITIAL_MS,
        reconnectMaxMs: STREAMING_RECONNECT_MAX_MS,
        subscribeForbiddenChunks: forbiddenChunks,
        subscribeForbiddenLastAt: lastForbiddenAt,
        subscribeForbiddenLastMessage: lastForbiddenMessage,
        lastMessageAt,
        ...extra,
      });
      scheduleFormalFutoptLiveMirror(statusSnapshot);
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
          ws.send(JSON.stringify(buildSubscribeMessage(channel, symbols)));
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
  let reconnectDelayMs = STREAMING_RECONNECT_INITIAL_MS;
  while (true) {
    const runStartedAt = Date.now();
    await runOnce();
    const delayMs = reconnectDelayMs;
    const connectedLongEnough = Date.now() - runStartedAt >= STREAMING_RECONNECT_MAX_MS;
    reconnectDelayMs = connectedLongEnough
      ? STREAMING_RECONNECT_INITIAL_MS
      : Math.min(STREAMING_RECONNECT_MAX_MS, reconnectDelayMs * 2);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

writeStatus({ starting: true });
run().catch((error) => {
  writeStatus({ ok: false, error: error?.message || String(error) });
  process.exit(1);
});
