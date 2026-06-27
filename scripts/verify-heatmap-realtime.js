const handler = require("../api/heatmap.js");
const fs = require("fs");

function callHeatmap() {
  return new Promise((resolve, reject) => {
    const request = { method: "GET", query: { limit: "999", stocks: "999", source: "release-guard" } };
    const response = {
      code: 0,
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(payload) { resolve({ code: this.code, payload }); },
      end() { resolve({ code: this.code, payload: null }); },
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function fetchLiveHeatmap() {
  const url = `https://fuman-terminal.vercel.app/api/heatmap?limit=999&stocks=999&source=release-guard-live&t=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  return { code: response.status, payload: await response.json(), live: true };
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace(/\D/g, "");
}

function readFinMindToken() {
  const tokenFromEnv = process.env.FINMIND_API_TOKEN || process.env.FINMIND_TOKEN;
  if (tokenFromEnv) return String(tokenFromEnv).trim();
  const secretPath = "C:/fuman-runtime/secrets/finmind-api-token.txt";
  try {
    if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, "utf8").trim();
  } catch {
    return "";
  }
  return "";
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      "User-Agent": "fuman-terminal-heatmap-release-guard",
      Accept: "application/json, text/plain, */*",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchFinMindQuote(code, today) {
  const token = readFinMindToken();
  if (!token) return null;
  const params = new URLSearchParams({ data_id: code, token });
  try {
    const snapshot = await fetchJson(`https://api.finmindtrade.com/api/v4/taiwan_stock_tick_snapshot?${params}`, {
      headers: { Referer: "https://finmindtrade.com/" },
    });
    const item = Array.isArray(snapshot?.data) ? snapshot.data[0] : null;
    const close = toNumber(item?.close || item?.last_price || item?.lastPrice || item?.price);
    if (close > 0) return { source: "finmind", close };
  } catch {
    // FinMind tick snapshot can reject single-code requests; fall back to the daily dataset.
  }

  const start = new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10);
  const priceParams = new URLSearchParams({
    dataset: "TaiwanStockPrice",
    data_id: code,
    start_date: start,
    token,
  });
  const daily = await fetchJson(`https://api.finmindtrade.com/api/v4/data?${priceParams}`, {
    headers: { Referer: "https://finmindtrade.com/" },
  });
  const rows = Array.isArray(daily?.data) ? daily.data : [];
  const latest = rows
    .filter((row) => toNumber(row?.close) > 0)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .at(-1);
  const dailyClose = toNumber(latest?.close);
  return dailyClose > 0 ? { source: "finmind-daily", close: dailyClose } : null;
}

async function fetchYahooQuote(code) {
  const symbols = [`${code}.TW`, `${code}.TWO`];
  for (const symbol of symbols) {
    try {
      const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`);
      const result = data?.chart?.result?.[0];
      const meta = result?.meta || {};
      const quote = result?.indicators?.quote?.[0] || {};
      const closes = Array.isArray(quote.close) ? quote.close.filter((value) => Number(value) > 0) : [];
      const close = toNumber(closes[closes.length - 1] || meta.regularMarketPrice || meta.previousClose);
      if (close > 0) return { source: "yahoo", close, symbol };
    } catch {
      // Try OTC suffix next.
    }
  }
  return null;
}

async function fetchReferenceQuote(code, today) {
  try {
    const finmind = await fetchFinMindQuote(code, today);
    if (finmind?.close > 0) return finmind;
  } catch (error) {
    console.warn(`[heatmap-realtime] FinMind cross-check skipped for ${code}: ${error.message}`);
  }
  try {
    const yahoo = await fetchYahooQuote(code);
    if (yahoo?.close > 0) return yahoo;
  } catch (error) {
    console.warn(`[heatmap-realtime] Yahoo cross-check skipped for ${code}: ${error.message}`);
  }
  return null;
}

function fail(message, detail) {
  console.error(`[heatmap-realtime] failed: ${message}`);
  if (detail) console.error(JSON.stringify(detail, null, 2));
  process.exit(1);
}

(async () => {
  const startedAt = Date.now();
  let { code, payload, live = false } = await callHeatmap();
  if (code !== 200 || !payload?.ok) {
    const errors = payload?.errors || {};
    const fetchFailed = Object.values(errors).some((message) => String(message || "").includes("fetch failed"));
    if (fetchFailed) ({ code, payload, live } = await fetchLiveHeatmap());
  }
  if (code !== 200 || !payload?.ok) fail("API did not return a healthy payload", { code, ok: payload?.ok, health: payload?.health, errors: payload?.errors });

  const sectors = Array.isArray(payload.sectors) ? payload.sectors : [];
  const rows = sectors.flatMap((sector) => (Array.isArray(sector.stocks) ? sector.stocks : [])
    .map((stock) => ({ ...stock, sector: sector.name })));
  const today = payload.health?.today || taipeiToday();
  const badDate = rows.filter((stock) => String(stock.quoteDate || "") !== today);
  const notRealtime = rows.filter((stock) => stock.isRealtime !== true);
  const noPrice = rows.filter((stock) => !Number(stock.close));
  const requiredCodes = ["3037", "2492", "2327", "2059"];
  const required = Object.fromEntries(requiredCodes.map((target) => [target, rows.find((stock) => String(stock.code) === target) || null]));
  const missingRequired = Object.entries(required).filter(([, stock]) => !stock || stock.isRealtime !== true || !Number(stock.close));

  if (rows.length < 500 || badDate.length || notRealtime.length || noPrice.length || missingRequired.length) {
    fail("heatmap contains stale or invalid quotes", {
      today,
      rows: rows.length,
      badDate: badDate.length,
      notRealtime: notRealtime.length,
      noPrice: noPrice.length,
      missingRequired: missingRequired.map(([target]) => target),
      samples: {
        badDate: badDate.slice(0, 5).map(({ code, name, close, pct, quoteDate, sector }) => ({ code, name, close, pct, quoteDate, sector })),
        notRealtime: notRealtime.slice(0, 5).map(({ code, name, close, pct, quoteDate, sector }) => ({ code, name, close, pct, quoteDate, sector })),
        noPrice: noPrice.slice(0, 5).map(({ code, name, close, pct, quoteDate, sector }) => ({ code, name, close, pct, quoteDate, sector })),
      },
    });
  }

  const crossChecks = [];
  const mismatches = [];
  for (const code of requiredCodes) {
    const stock = required[code];
    const reference = await fetchReferenceQuote(code, today);
    if (!reference) {
      crossChecks.push({ code, source: "none", close: stock.close, reference: null, skipped: true });
      continue;
    }
    const delta = Math.abs(toNumber(stock.close) - toNumber(reference.close));
    const result = { code, source: reference.source, close: stock.close, reference: reference.close, delta };
    crossChecks.push(result);
    if (delta > 0.11) mismatches.push(result);
  }

  if (mismatches.length) {
    fail("heatmap prices disagree with FinMind/Yahoo reference quotes", {
      today,
      mismatches,
      crossChecks,
    });
  }

  const checked = crossChecks.filter((item) => !item.skipped).length;
  const skipped = crossChecks.length - checked;
  console.log(`[heatmap-realtime] ok source=${live ? "live" : "local"} stocks=${rows.length} realtime=${payload.realtimeStockCount} quoteTime=${payload.health?.quoteTime || ""} crossCheck=${checked} skipped=${skipped} ms=${Date.now() - startedAt}`);
})();
