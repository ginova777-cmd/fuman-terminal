const crypto = require("crypto");

async function fetchText(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json, text/plain, */*",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "" || value === "--") return 0;
  return Number(String(value).replace(/[,+%]/g, "").replace(/^X/i, "")) || 0;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function normalizeCode(value) {
  return String(value || "").trim();
}

function isCommonStockCode(code) {
  return /^\d{4}$/.test(code);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function stockChange(close, change) {
  const previous = close - change;
  const percent = previous ? (change / previous) * 100 : 0;
  return percent;
}

function taipeiDate() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeTradeDate(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return digits;
  if (/^\d{7}$/.test(digits)) {
    const rocYear = Number(digits.slice(0, 3));
    if (rocYear > 0) return `${rocYear + 1911}${digits.slice(3)}`;
  }
  return "";
}

function recentDateKeys(days = 10) {
  const base = taipeiDate();
  const dates = [];
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(base);
    date.setDate(base.getDate() - offset);
    dates.push(formatDateKey(date));
  }
  return dates;
}

function taipeiParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function isTaipeiMarketSession() {
  const parts = taipeiParts();
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= 9 * 60 && minute <= 13 * 60 + 30;
}

async function fetchMisBatch(stocks) {
  const query = stocks.map((stock) => {
    const market = String(stock.Market || "").toUpperCase() === "TPEX" ? "otc" : "tse";
    return `${market}_${stock.Code}.tw`;
  }).join("|");
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(query)}&json=1&delay=0`;
  try {
    const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://mis.twse.com.tw/" } }, 2500));
    return normalizeArray(payload.msgArray);
  } catch {
    return [];
  }
}

async function fetchMisQuotes(stocks) {
  const quoteMap = new Map();
  const results = await Promise.allSettled(chunkArray(stocks, 120).map(fetchMisBatch));
  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    result.value.forEach((item) => {
      const code = String(item.c || "").trim();
      const close = cleanNumber(item.z) || cleanNumber(item.y);
      const prev = cleanNumber(item.y) || close;
      if (!code || !close || !prev) return;
      const volumeLots = cleanNumber(item.v);
      const change = close - prev;
      quoteMap.set(code, {
        close,
        change,
        value: volumeLots ? volumeLots * 1000 * close : 0,
        volume: volumeLots ? volumeLots * 1000 : 0,
        percent: prev ? (change / prev) * 100 : 0,
        quoteTime: String(item.t || "").trim(),
      });
    });
  });
  return quoteMap;
}

async function mergeRealtimeQuotes(stocks, todayKey) {
  if (!isTaipeiMarketSession() || !stocks.length) return { stocks, realtimeCount: 0 };
  const quoteMap = await fetchMisQuotes(stocks);
  if (quoteMap.size < Math.min(500, Math.floor(stocks.length * 0.25))) return { stocks, realtimeCount: quoteMap.size };
  const merged = stocks.map((stock) => {
    const quote = quoteMap.get(stock.Code);
    if (!quote) return stock;
    return {
      ...stock,
      Date: todayKey,
      TradeDate: todayKey,
      quoteDate: todayKey,
      tradeDate: todayKey,
      ClosingPrice: String(quote.close),
      Change: String(quote.change),
      TradeValue: String(quote.value || cleanNumber(stock.TradeValue)),
      TradeVolume: String(quote.volume || cleanNumber(stock.TradeVolume)),
      Percent: quote.percent.toFixed(2),
      quoteTime: quote.quoteTime,
      quoteUpdatedAt: Date.now(),
      isRealtime: true,
    };
  });
  return { stocks: merged, realtimeCount: quoteMap.size };
}

function mostCommonDate(stocks) {
  const counts = new Map();
  normalizeArray(stocks).forEach((stock) => {
    const key = normalizeTradeDate(stock.tradeDate || stock.quoteDate || stock.TradeDate || stock.Date);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] || "";
}

function signedChange(sign, value) {
  const amount = cleanNumber(value);
  const text = String(sign || "");
  if (text.includes("-") || text.includes("color:green")) return -Math.abs(amount);
  if (text.includes("+") || text.includes("color:red")) return Math.abs(amount);
  return amount;
}

function normalizeTwseRow(row) {
  const code = normalizeCode(row["證券代號"] || row.Code);
  if (!isCommonStockCode(code)) return null;
  const name = String(row["證券名稱"] || row.Name || "").trim();
  const close = cleanNumber(row["收盤價"] || row.ClosingPrice);
  const change = signedChange(row["漲跌(+/-)"] || row.Sign, row["漲跌價差"] || row.Change);
  const value = cleanNumber(row["成交金額"] || row.TradeValue);
  const volume = cleanNumber(row["成交股數"] || row.TradeVolume);
  const tradeDate = normalizeTradeDate(row.Date || row["日期"] || row["資料日期"]);
  if (!name || !close) return null;
  return {
    Code: code,
    Name: name,
    Date: tradeDate,
    TradeDate: tradeDate,
    quoteDate: tradeDate,
    tradeDate,
    ClosingPrice: String(close),
    Change: String(change),
    TradeValue: String(value),
    TradeVolume: String(volume),
    Market: "TWSE",
    Percent: stockChange(close, change).toFixed(2),
  };
}

function normalizeTpexRow(row) {
  const code = normalizeCode(row["代號"] || row.SecuritiesCompanyCode || row.Code);
  if (!isCommonStockCode(code)) return null;
  const name = String(row["名稱"] || row.CompanyName || row.Name || "").trim();
  const close = cleanNumber(row["收盤"] || row.Close || row.ClosingPrice);
  const change = cleanNumber(row["漲跌"] || row.Change);
  const value = cleanNumber(row["成交金額(元)"] || row["成交金額"] || row.TradeValue);
  const volume = cleanNumber(row["成交股數"] || row.TradeVolume);
  const tradeDate = normalizeTradeDate(row.Date || row["日期"] || row["資料日期"]);
  if (!name || !close) return null;
  return {
    Code: code,
    Name: name,
    Date: tradeDate,
    TradeDate: tradeDate,
    quoteDate: tradeDate,
    tradeDate,
    ClosingPrice: String(close),
    Change: String(change),
    TradeValue: String(value),
    TradeVolume: String(volume),
    Market: "TPEX",
    Percent: stockChange(close, change).toFixed(2),
  };
}

function recordsFromFields(fields, rows) {
  return rows.map((row) => {
    if (!Array.isArray(row)) return row;
    const record = {};
    fields.forEach((field, index) => {
      record[field] = row[index];
    });
    return record;
  });
}

function parseTpexPayload(payload) {
  const table = Array.isArray(payload.tables)
    ? payload.tables.find((item) => Array.isArray(item.data) && item.data.length) || payload.tables[0]
    : null;
  const fields = table?.fields || payload.fields || payload.iTotalRecords?.fields || [];
  const rows = table?.data || payload.aaData || payload.data || [];
  if (!Array.isArray(rows) || !rows.length) return [];
  const payloadDate = payload.date || table?.date || "";
  return recordsFromFields(fields, rows)
    .map((row) => ({ ...row, Date: row.Date || payloadDate }))
    .map(normalizeTpexRow)
    .filter(Boolean);
}

function formatRocDate(date) {
  const year = date.getFullYear() - 1911;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function recentRocDates(days = 10) {
  const base = taipeiDate();
  const dates = [];
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(base);
    date.setDate(base.getDate() - offset);
    dates.push(formatRocDate(date));
  }
  return dates;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headerIndex = rows.findIndex((items) => items.includes("代號") && items.includes("名稱"));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((item) => item.trim());
  return rows.slice(headerIndex + 1).map((items) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = String(items[index] || "").trim();
    });
    return record;
  });
}

async function fetchTwseStocks() {
  for (const date of recentDateKeys()) {
    try {
      const text = await fetchText(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date}&type=ALL&response=json`, {}, 30000);
      const payload = JSON.parse(text);
      const table = normalizeArray(payload.tables).find((item) =>
        normalizeArray(item.fields).includes("證券代號") &&
        normalizeArray(item.fields).includes("收盤價") &&
        Array.isArray(item.data) &&
        item.data.length
      );
      if (!table) continue;
      const parsed = recordsFromFields(table.fields, table.data)
        .map((row) => ({ ...row, Date: date }))
        .map(normalizeTwseRow)
        .filter(Boolean);
      if (parsed.length) return { stocks: parsed, tradeDate: date, source: "TWSE MI_INDEX" };
    } catch (error) {}
  }

  const text = await fetchText("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
  const rows = JSON.parse(text);
  const parsed = rows.map(normalizeTwseRow).filter(Boolean);
  return { stocks: parsed, tradeDate: mostCommonDate(parsed), source: "TWSE STOCK_DAY_ALL fallback" };
}

async function fetchTpexStocks() {
  const resultBase = "https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&s=0,asc,0";
  const dataUrl = "https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=data";
  const downloadUrl = "https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_download.php?l=zh-tw";
  const closeUrl = "https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&sect=EW";

  for (const date of recentRocDates()) {
    try {
      const payload = JSON.parse(await fetchText(`${resultBase}&d=${encodeURIComponent(date)}`, { headers: { Referer: "https://www.tpex.org.tw/" } }));
      const parsed = parseTpexPayload(payload);
      if (parsed.length) return { stocks: parsed, tradeDate: mostCommonDate(parsed), source: "TPEx daily_close_quotes" };
    } catch (error) {}
  }

  try {
    const payload = JSON.parse(await fetchText(dataUrl, { headers: { Referer: "https://www.tpex.org.tw/" } }));
    const parsed = parseTpexPayload(payload);
    if (parsed.length) return { stocks: parsed, tradeDate: mostCommonDate(parsed), source: "TPEx daily_close_quotes fallback" };
  } catch (error) {}

  for (const url of [downloadUrl, closeUrl]) {
    try {
      const text = await fetchText(url, { headers: { Referer: "https://www.tpex.org.tw/" } });
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const payload = JSON.parse(trimmed);
        const parsed = parseTpexPayload(payload);
        if (parsed.length) return { stocks: parsed, tradeDate: mostCommonDate(parsed), source: "TPEx fallback" };
      }
      const parsed = parseCsv(text).map(normalizeTpexRow).filter(Boolean);
      if (parsed.length) return { stocks: parsed, tradeDate: mostCommonDate(parsed), source: "TPEx fallback" };
    } catch (error) {}
  }

  return { stocks: [], tradeDate: "", source: "TPEx unavailable" };
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const [twseResult, tpexResult] = await Promise.allSettled([
    fetchTwseStocks(),
    fetchTpexStocks(),
  ]);

  const twsePayload = twseResult.status === "fulfilled" ? twseResult.value : { stocks: [], tradeDate: "", source: "TWSE failed" };
  const tpexPayload = tpexResult.status === "fulfilled" ? tpexResult.value : { stocks: [], tradeDate: "", source: "TPEx failed" };
  const twse = normalizeArray(twsePayload.stocks);
  const tpex = normalizeArray(tpexPayload.stocks);
  const todayKey = formatDateKey(taipeiDate());
  const resolvedTradeDate = [twsePayload.tradeDate, tpexPayload.tradeDate].filter(Boolean).sort().pop() || "";
  const isFallbackDate = Boolean(resolvedTradeDate && resolvedTradeDate !== todayKey);
  const byCode = new Map();
  [...twse, ...tpex]
    .filter((stock) => normalizeTradeDate(stock.tradeDate || stock.quoteDate || stock.TradeDate || stock.Date) === resolvedTradeDate)
    .forEach((stock) => byCode.set(stock.Code, stock));
  let stocks = [...byCode.values()].sort((a, b) => a.Code.localeCompare(b.Code));
  const realtime = await mergeRealtimeQuotes(stocks, todayKey);
  stocks = realtime.stocks;
  const effectiveTradeDate = realtime.realtimeCount >= Math.min(500, Math.floor(stocks.length * 0.25))
    ? todayKey
    : resolvedTradeDate;

  const payload = {
    ok: stocks.length > 0,
    source: `${twsePayload.source} + ${tpexPayload.source}`,
    updatedAt: new Date().toISOString(),
    today: todayKey,
    resolvedTradeDate: effectiveTradeDate,
    sourceTradeDate: resolvedTradeDate,
    isFallbackDate: Boolean(effectiveTradeDate && effectiveTradeDate !== todayKey),
    realtimeCount: realtime.realtimeCount,
    marketDates: {
      twse: twsePayload.tradeDate || "",
      tpex: tpexPayload.tradeDate || "",
    },
    count: stocks.length,
    twseCount: twse.filter((stock) => normalizeTradeDate(stock.tradeDate || stock.quoteDate || stock.TradeDate || stock.Date) === resolvedTradeDate).length,
    tpexCount: tpex.filter((stock) => normalizeTradeDate(stock.tradeDate || stock.quoteDate || stock.TradeDate || stock.Date) === resolvedTradeDate).length,
    errors: {
      twse: twseResult.status === "rejected" ? twseResult.reason.message : null,
      tpex: tpexResult.status === "rejected" ? tpexResult.reason.message : null,
    },
    stocks,
  };
  const etag = `"${crypto.createHash("sha1").update(JSON.stringify({
    date: payload.resolvedTradeDate,
    count: payload.count,
    realtimeCount: payload.realtimeCount,
    stocks: payload.stocks,
  })).digest("hex").slice(0, 16)}"`;
  response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  response.setHeader("ETag", etag);
  response.setHeader("Last-Modified", new Date(payload.updatedAt).toUTCString());
  if (request.headers?.["if-none-match"] === etag) {
    response.status(304).end();
    return;
  }
  response.status(stocks.length ? 200 : 502).json(payload);
};
