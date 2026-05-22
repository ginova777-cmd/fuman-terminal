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

function normalizeCode(value) {
  return String(value || "").trim();
}

function isCommonStockCode(code) {
  return /^\d{4}$/.test(code);
}

function stockChange(close, change) {
  const previous = close - change;
  const percent = previous ? (change / previous) * 100 : 0;
  return percent;
}

function normalizeTwseRow(row) {
  const code = normalizeCode(row["證券代號"] || row.Code);
  if (!isCommonStockCode(code)) return null;
  const name = String(row["證券名稱"] || row.Name || "").trim();
  const close = cleanNumber(row["收盤價"] || row.ClosingPrice);
  const change = cleanNumber(row["漲跌價差"] || row.Change);
  const value = cleanNumber(row["成交金額"] || row.TradeValue);
  const volume = cleanNumber(row["成交股數"] || row.TradeVolume);
  if (!name || !close) return null;
  return {
    Code: code,
    Name: name,
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
  if (!name || !close) return null;
  return {
    Code: code,
    Name: name,
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
  return recordsFromFields(fields, rows).map(normalizeTpexRow).filter(Boolean);
}

function formatRocDate(date) {
  const year = date.getFullYear() - 1911;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function recentRocDates(days = 10) {
  const base = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
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
  const text = await fetchText("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
  const rows = JSON.parse(text);
  return rows.map(normalizeTwseRow).filter(Boolean);
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
      if (parsed.length) return parsed;
    } catch (error) {}
  }

  try {
    const payload = JSON.parse(await fetchText(dataUrl, { headers: { Referer: "https://www.tpex.org.tw/" } }));
    const parsed = parseTpexPayload(payload);
    if (parsed.length) return parsed;
  } catch (error) {}

  for (const url of [downloadUrl, closeUrl]) {
    try {
      const text = await fetchText(url, { headers: { Referer: "https://www.tpex.org.tw/" } });
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        const payload = JSON.parse(trimmed);
        const parsed = parseTpexPayload(payload);
        if (parsed.length) return parsed;
      }
      const parsed = parseCsv(text).map(normalizeTpexRow).filter(Boolean);
      if (parsed.length) return parsed;
    } catch (error) {}
  }

  return [];
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

  const twse = twseResult.status === "fulfilled" ? twseResult.value : [];
  const tpex = tpexResult.status === "fulfilled" ? tpexResult.value : [];
  const byCode = new Map();
  [...twse, ...tpex].forEach((stock) => byCode.set(stock.Code, stock));
  const stocks = [...byCode.values()].sort((a, b) => a.Code.localeCompare(b.Code));

  response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  response.status(stocks.length ? 200 : 502).json({
    ok: stocks.length > 0,
    source: "TWSE STOCK_DAY_ALL + TPEx daily_close_quotes",
    updatedAt: new Date().toISOString(),
    count: stocks.length,
    twseCount: twse.length,
    tpexCount: tpex.length,
    errors: {
      twse: twseResult.status === "rejected" ? twseResult.reason.message : null,
      tpex: tpexResult.status === "rejected" ? tpexResult.reason.message : null,
    },
    stocks,
  });
};
