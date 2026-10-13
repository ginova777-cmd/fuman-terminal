const fs = require("fs");
const { nativeEventAt, nativePrice, nativeQuoteFields } = require("../lib/futopt-native-event-time.cjs");
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
const readTxfReference = require('../lib/futopt-txf-reference.cjs').createReader(RUNTIME_DIR);
const txfCandlePipeline = require('../lib/txf-candle-pipeline.cjs').createPipeline({runtime:RUNTIME_DIR,readJson,writeJson});
const {createControl,hash:stopHash} = require('../lib/futopt-graceful-shutdown.cjs');
let shutdown, activeSocket=null, acceptedWriteError=null;
const backgroundWork=new Set(),savedCaches=new Map();
const acceptedBoundary={events:0,quotes:0,candles:0,last_event:null};
function track(promise){backgroundWork.add(promise);promise.then(()=>backgroundWork.delete(promise),()=>backgroundWork.delete(promise));return promise;}
function saveCache(file,payload){writeJson(file,payload);savedCaches.set(file,payload);}
const API_KEY_FILES = [
  path.join(RUNTIME_DIR, "secrets", "fugle-api-key.txt"),
];
const FUTOPT_TICKERS_CACHE_FILES = [
  path.join(RUNTIME_DIR, "cache", "intraday", "fugle-futopt-tickers.json"),
];
const STOCKS_SLIM_FILES = [
  path.join(RUNTIME_DIR, "data", "stocks-slim.json"),
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
const STREAMING_STALE_RECONNECT_MS = Math.max(60000, Number(process.env.FUGLE_FUTOPT_STREAMING_STALE_RECONNECT_MS || 120000));
const STREAMING_SUBSCRIBE_PACE_MS = Math.max(50, Number(process.env.FUGLE_FUTOPT_STREAMING_SUBSCRIBE_PACE_MS || 200));
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
const FORMAL_LIVE_MIRROR_BATCH_SIZE = Math.max(10, Math.min(100, Number(process.env.FUGLE_FUTOPT_FORMAL_LIVE_MIRROR_BATCH_SIZE || 50)));
const CACHE_TTL_MS = Math.max(30000, Number(process.env.FUGLE_FUTOPT_WS_CACHE_TTL_MS || 5 * 60 * 1000));
const STREAMING_AFTER_HOURS_RAW = String(process.env.FUGLE_FUTOPT_STREAMING_AFTER_HOURS || "").trim().toLowerCase();
const STREAMING_AFTER_HOURS = /^(1|true|yes|on)$/.test(STREAMING_AFTER_HOURS_RAW)
  ? true
  : /^(0|false|no|off)$/.test(STREAMING_AFTER_HOURS_RAW)
    ? false
    : null;

const FORMAL_LIVE_MIRROR_RECEIPT_FILE = path.join(path.dirname(FUGLE_FUTOPT_WS_STATUS_FILE), "fugle-daytrade-futopt-live-mirror.json");
const COLLECTOR_RELEASE = "futopt-daytrade-candles-v8";

let lastMessageAt = "";
let formalCatalogue = null;
let catalogueWait = null;
const catalogueDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
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
  return require('../lib/futopt-collector-catalogue').build(formalCatalogue,catalogueDate(),nowIso());
}
function futureEndTime(row) {
  const parsed = Date.parse(row.end_date || "");
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function selectStreamingTickers() {
  const rows = buildTickerRows();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const standardSelection = require('../lib/stock-future-standard-runtime.cjs').resolve(formalCatalogue,catalogueDate(),nowIso());
  const selectedStandard = new Set(standardSelection.resolutions.filter(r=>r.status==='UNIQUE').map(r=>r.selected));
  const byUnderlying = new Map(rows.filter(r=>selectedStandard.has(r.future_symbol)).map(r=>[r.underlying_symbol,r]));
  const txf = rows
    .filter((row) => row.product === "TXF" && /^TXF/i.test(row.future_symbol) && !/-[FS]$/i.test(row.future_symbol) && futureEndTime(row) >= today.getTime())
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
  saveCache(FUGLE_FUTOPT_WS_QUOTES_FILE, {
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
  saveCache(FUGLE_FUTOPT_WS_CANDLES_FILE, {
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
  const nowMs = Date.now();
  const freshnessCutoff = nowMs - 180000;
  return rows
    .map(quote => ({ ...quote, native_event_at: nativeEventAt(quote, nowMs) }))
    .filter((quote) => {
      const seen = Date.parse(quote.native_event_at || "");
      return normalizeFutureSymbol(quote.future_symbol) && Number.isFinite(seen) && seen >= freshnessCutoff && nativePrice(quote.payload) !== null && nativePrice(quote.payload) === quote.last_price;
    })
    .map((quote) => {
      const futureSymbol = normalizeFutureSymbol(quote.future_symbol);
      const product = quote.product || (futureSymbol.startsWith("TXF") ? "TXF" : "STOCK_FUTURE");
      return {
        future_symbol: futureSymbol,
        underlying_symbol: quote.underlying_symbol || (futureSymbol.startsWith("TXF") ? "TXF" : null),
        underlying_name: quote.underlying_name || null,
        updated_at: quote.native_event_at,
        last_price: finiteNumber(quote.last_price ?? quote.price),
        ...nativeQuoteFields(quote.payload),
        product,
        session: quote.session || "",
        source: "fugle_futopt_websocket_collector:formal_live_mirror",
        payload: {
          ...(quote.payload || {}),
          source: "fugle_futopt_websocket_collector:formal_live_mirror",
          quote_seen_at: quote.quoteSeenAt || "",
          collector_checked_at: checkedAt,
          native_event_at: quote.native_event_at,
          ...readTxfReference(quote.native_event_at, nowMs),
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
      receipt.written_rows = 0;
      const batches = chunkArray(rows, FORMAL_LIVE_MIRROR_BATCH_SIZE);
      receipt.batch_count = batches.length;
      for (const batch of batches) {
        const response = await fetchWithTimeout(`${baseUrl}/rest/v1/fugle_daytrade_futopt_quotes_live?on_conflict=future_symbol`, {
          method: "POST",
          headers: {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(batch),
        });
        if (!response.ok) throw Object.assign(new Error(`futopt_formal_live_mirror_http_${response.status}`), { status: response.status });
        receipt.written_rows += batch.length;
        await delay(100);
      }
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
  if(shutdown?.quiescing)return;
  if (formalLiveMirrorInFlight || Date.now() - lastFormalLiveMirrorAt < FORMAL_LIVE_MIRROR_MS) return;
  lastFormalLiveMirrorAt = Date.now();
  formalLiveMirrorInFlight = true;
  track(mirrorFormalFutoptLive()
    .catch((error) => writeJson(FORMAL_LIVE_MIRROR_RECEIPT_FILE, {
      contract: "fugle_daytrade_futopt_formal_live_mirror_v1",
      checked_at: nowIso(),
      status: "retry_exhausted",
      first_blocker: "futopt_formal_live_mirror_exception",
      error: error?.message || String(error),
    }))
    .finally(() => { formalLiveMirrorInFlight = false; }));
}
async function run() {
  const apiKey = readSecret(API_KEY_FILES);
  if (!apiKey) {
    writeStatus({ ok: false, formalReady: false, formalReadyReason: "api_key_missing", error: "fugle api key missing" });
    return;
  }

  let txfConnectionCount = 0;
  const archiveTimer = setInterval(() => {
    if(shutdown.quiescing){clearInterval(archiveTimer);return;}
    try { txfCandlePipeline.flush(); } catch { console.error('TXF_ARCHIVE_STATUS_WRITE_FAILED'); }
  }, 30000);
  archiveTimer.unref();
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
    void shutdown.request({...shutdown.identity,request_id:require('node:crypto').randomUUID(),requested_at:nowIso(),signal}).catch(e=>console.error('STOP_REQUEST_REJECTED:'+e.message));
  });

  const runOnce = () => new Promise((resolve) => {
    lastMessageAt = '';
    const reference = readTxfReference(nowIso()).txf_reference;
    txfCandlePipeline.configure(reference ? {symbol:reference.future_symbol,tradeDate:reference.trade_date,session:STREAMING_AFTER_HOURS === true ? 'AFTERHOURS' : 'REGULAR'} : null);
    let selection = formalCatalogue ? selectStreamingTickers() : {selectedSymbols:[],selectedRows:[],allRows:[],requestedSymbols:0,tickerCacheFile:null,stockLookupCount:0};
    let chunks = chunkArray(selection.selectedSymbols, STREAMING_SUBSCRIBE_CHUNK_SIZE);
    const tickerBySymbol = new Map(selection.selectedRows.map((row) => [row.future_symbol, row]));
    const streamHealth = require('../lib/futopt-stream-health.cjs').createHealth({symbols:selection.selectedSymbols,channels:STREAMING_CHANNELS});
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
    let catalogueRefreshInFlight = false;
    let candleRecoveryStarted = false;

    const writeStreamingStatus = (extra = {}) => {
      const messageAgeSeconds = lastMessageAt ? Math.max(0, Math.round((Date.now() - Date.parse(lastMessageAt)) / 1000)) : null;
      const requiredChannelsReady = ["trades", "aggregates", "candles"].every((channel) => STREAMING_CHANNELS.includes(channel));
      const formalReady = extra.ok !== false
        && Boolean(ws && ws.readyState === WebSocket.OPEN)
        && authenticated
        && formalCatalogue?.trade_date === catalogueDate()
        && requiredChannelsReady
        && streamHealth.snapshot().subscriptions_ready
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
              : !formalCatalogue
                ? 'catalogue_waiting_verified_trade_date'
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
        transportHealth: streamHealth.snapshot(),
        catalogueRetry: catalogueWait,
        formalReady,
        formalReadyReason,
        streamingOpenedAt: openedAt,
        streamingMessages: messages,
        streamingQuotes: quoteMessages,
        streamingCandles: candleMessages,
        txfCandleArchive: txfCandlePipeline.status(),
        selectedSymbols: selection.selectedSymbols.length,
        requestedSymbols: selection.requestedSymbols,
        tickerRows: selection.allRows.length,
        catalogueTradeDate: formalCatalogue?.trade_date,
        catalogueRunId: formalCatalogue?.run_id,
        catalogueSourceHash: formalCatalogue?.source_hash,
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
        staleReconnectMs: STREAMING_STALE_RECONNECT_MS,
        subscribeForbiddenChunks: forbiddenChunks,
        subscribeForbiddenLastAt: lastForbiddenAt,
        subscribeForbiddenLastMessage: lastForbiddenMessage,
        lastMessageAt,
        ...extra,
      });
      if (formalReady) scheduleFormalFutoptLiveMirror(statusSnapshot);
    };

    const refreshPendingCatalogue = async () => {
      if (shutdown.quiescing || formalCatalogue || catalogueRefreshInFlight || closed) return;
      catalogueRefreshInFlight = true;
      try {
        const result = await track(refreshCatalogue({runtime:RUNTIME_DIR,tradeDate:catalogueDate(),asOf:nowIso(),key:apiKey}));
        if (closed || shutdown.quiescing) return;
        if (result.status === 'ready') {
          formalCatalogue = result.catalogue;
          catalogueWait = null;
          await subscribe();
        } else catalogueWait = result.receipt;
      } catch { catalogueWait = {error:'FUTURES_CATALOGUE_REFRESH_FAILED'}; }
      finally { catalogueRefreshInFlight = false; }
    };

    const subscribe = async () => {
      if (shutdown.quiescing || !ws || ws.readyState !== WebSocket.OPEN || !authenticated) return;
      if (!formalCatalogue) { void refreshPendingCatalogue(); return; }
      if(formalCatalogue?.trade_date!==catalogueDate()){ws.close(1000,'catalogue day changed');return;}
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
      streamHealth.setExpected(selection.selectedSymbols, STREAMING_CHANNELS);
      const reference = readTxfReference(nowIso()).txf_reference;
      txfCandlePipeline.configure(reference ? {symbol:reference.future_symbol,tradeDate:reference.trade_date,session:STREAMING_AFTER_HOURS === true ? 'AFTERHOURS' : 'REGULAR'} : null);
      if (!candleRecoveryStarted) {
        candleRecoveryStarted = true;
        void track(txfCandlePipeline.recoverOnConnection(apiKey, txfConnectionCount++ === 0 ? 'STARTUP' : 'RECONNECT'));
      }
      tickerBySymbol.clear();
      selection.selectedRows.forEach((row) => tickerBySymbol.set(row.future_symbol, row));
      cycles += 1;
      for (const channel of STREAMING_CHANNELS) {
        for (const symbols of chunks) {
          if(shutdown.quiescing)return;
          ws.send(JSON.stringify(buildSubscribeMessage(channel, symbols)));
          chunksSent += 1;
          await delay(STREAMING_SUBSCRIBE_PACE_MS);
        }
      }
      writeStreamingStatus();
    };

    try {
      ws = new WebSocket(STREAMING_URL);
      activeSocket=ws;
      ws.addEventListener("open", () => {
        if(shutdown.quiescing){ws.close();return;}
        openedAt = nowIso();
        ws.send(JSON.stringify({ event: "auth", data: { apikey: apiKey } }));
        // Subscription begins only after the explicit authenticated event.
        writeStreamingStatus();
      });
      ws.addEventListener("message", (event) => {
        if(shutdown.quiescing)return;
        messages += 1;
        let payload = null;
        try { payload = JSON.parse(String(event.data || "")); } catch {}
        const text = String(event.data || "");
        streamHealth.observe(payload);
        if (payload?.event === 'authenticated' && !authenticated) {
          authenticated = true;
          void subscribe().catch(() => ws.close(4000, 'subscription setup failed'));
        }
        const notice = getNotice(payload, text);
        if (/forbidden|rate.?limit|subscribe.?limit|exceed/i.test(notice.noticeText)) {
          forbiddenChunks += 1;
          lastForbiddenAt = nowIso();
          lastForbiddenMessage = notice.noticeText.slice(0, 600);
        }
        // Control acknowledgements contain a symbol/channel but no market event.
        if (!authenticated || !['data', 'snapshot'].includes(payload?.event)) return;
        const data = payload?.data || payload || {};
        const payloadChannel = String(data.channel || payload?.channel || "").toLowerCase();
        const inferredChannel = payloadChannel
          || (Object.prototype.hasOwnProperty.call(data, "serial") || Object.prototype.hasOwnProperty.call(data, "size") ? "trades" : "")
          || (Object.prototype.hasOwnProperty.call(data, "open") && Object.prototype.hasOwnProperty.call(data, "close") && data.date ? "candles" : "")
          || (data.total || data.bids || data.asks || Object.prototype.hasOwnProperty.call(data, "openPrice") ? "aggregates" : "")
          || STREAMING_CHANNELS[0];
        const futureSymbol = normalizeFutureSymbol(data.symbol || data.future_symbol);
        const ticker = tickerBySymbol.get(futureSymbol) || null;
        if (!formalCatalogue || !ticker) return;
        acceptedBoundary.events++;
        acceptedBoundary.last_event={symbol:futureSymbol,channel:inferredChannel,time:data.date||data.time||data.lastUpdated||null,serial:data.serial??null};
        try {
        if (inferredChannel === "candles") {
          txfCandlePipeline.receive(payload);
          const candle = normalizeFutoptCandle(payload, ticker);
          if (candle) {
            candleMessages += 1;
            lastMessageAt = nowIso();
            mergeCandles([candle]);
            acceptedBoundary.candles++;
          }
          return;
        }
        const quote = normalizeFutoptQuote(payload, ticker);
        if (quote) {
          quoteMessages += 1;
          lastMessageAt = nowIso();
          mergeQuotes([quote]);
          acceptedBoundary.quotes++;
        }
        }catch(e){acceptedWriteError=acceptedWriteError||e.message;console.error('FUTOPT_ACCEPTED_CACHE_SAVE_FAILED');}
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
        if (closed || shutdown.quiescing) {
          clearInterval(statusTimer);
          return;
        }
        writeStreamingStatus();
        if (!formalCatalogue) void refreshPendingCatalogue();
        const lastMessageMs = Date.parse(streamHealth.snapshot().last_transport_at || openedAt || "");
        if (Number.isFinite(lastMessageMs)
          && Date.now() - lastMessageMs > STREAMING_STALE_RECONNECT_MS
          && ws.readyState === WebSocket.OPEN) {
          ws.close(4000, "websocket transport heartbeat timeout");
        }
      }, STREAMING_STATUS_MS);
      const subscribeTimer = setInterval(() => {
        if (closed || shutdown.quiescing) clearInterval(subscribeTimer);
        else subscribe();
      }, STREAMING_RESUBSCRIBE_MS);
    } catch (error) {
      writeStreamingStatus({ ok: false, websocketError: error?.message || String(error) });
      resolve();
    }
  });

  // eslint-disable-next-line no-constant-condition
  const catalogueRetryFile = path.join(RUNTIME_DIR, 'status', 'futopt-catalogue-retry.json');
  const refreshCatalogue = require('../lib/futopt-catalogue-retry.cjs').createCatalogueRetry({
    refresh: require('../lib/stock-future-standard-runtime.cjs').refresh,
    readState: () => readJson(catalogueRetryFile, null),
    writeState: value => writeJson(catalogueRetryFile, value),
  });
  let reconnectDelayMs = STREAMING_RECONNECT_INITIAL_MS;
  while (!shutdown.quiescing) {
    const runStartedAt = Date.now();
    try {
      const catalogueResult = await track(refreshCatalogue({runtime:RUNTIME_DIR,tradeDate:catalogueDate(),asOf:nowIso(),key:apiKey}));
      if(shutdown.quiescing)return;
      if (catalogueResult.status !== 'ready') {
        formalCatalogue = null;
        catalogueWait = catalogueResult.receipt;
      } else { formalCatalogue = catalogueResult.catalogue; catalogueWait = null; }
      await runOnce();
    } catch(error) {
      writeStatus({ok:false,formalReady:false,formalReadyReason:'futures_catalogue_or_stream_blocked',error:error.message});
    }
    const delayMs = reconnectDelayMs;
    const connectedLongEnough = Date.now() - runStartedAt >= STREAMING_RECONNECT_MAX_MS;
    reconnectDelayMs = connectedLongEnough
      ? STREAMING_RECONNECT_INITIAL_MS
      : Math.min(STREAMING_RECONNECT_MAX_MS, reconnectDelayMs * 2);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

shutdown=createControl({runtime:RUNTIME_DIR,entry:__filename,
  pending:()=>txfCandlePipeline.pendingState(),
  quiesce:()=>{txfCandlePipeline.quiesce();if(activeSocket){try{activeSocket.close(1000,'controlled shutdown');}catch{}}},
  boundary:()=>({...acceptedBoundary}),
  save:async()=>{
    while(backgroundWork.size)await Promise.allSettled([...backgroundWork]);
    const archive=await txfCandlePipeline.stopAndVerify();
    if(acceptedWriteError)throw Error('ACCEPTED_CACHE_WRITE_FAILED:'+acceptedWriteError);
    const caches=[];
    for(const [file,expected] of savedCaches){
      const fd=fs.openSync(file,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      const bytes=fs.readFileSync(file),actual=JSON.parse(bytes);
      if(stopHash(JSON.stringify(actual))!==stopHash(JSON.stringify(expected)))throw Error('FUTOPT_STOP_CACHE_READBACK_MISMATCH');
      caches.push({file,bytes:bytes.length,sha256:stopHash(bytes),payload_sha256:stopHash(JSON.stringify(expected)),count:expected.count,updatedAt:expected.updatedAt});
    }
    return {...archive,caches,preservation_scope:'accepted local cache and TXF archive; not DB mirror acceptance'};
  }
});
shutdown.start();
writeStatus({ starting: true });
run().catch((error) => {
  writeStatus({ ok: false, error: error?.message || String(error) });
  process.exit(1);
});
