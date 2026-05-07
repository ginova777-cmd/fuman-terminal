const ENDPOINTS = {
  indexes: "https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX",
  stocks:  "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  mis_taiex: "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0",
  mis_otc:   "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_o00.tw&json=1&delay=0",
  futures: "https://openapi.taifex.com.tw/v1/DailyFuturesAndOptions",
};

const FETCH_HEADERS = {
  accept: "application/json",
  "user-agent": "FumanTerminal/1.0",
  "cache-control": "no-cache",
};

async function fetchJson(url, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function isTradingHours() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const totalMinutes = hour * 60 + minute;
  if (day === 0 || day === 6) return false;
  return totalMinutes >= 9 * 60 && totalMinutes <= 13 * 60 + 35;
}

async function fetchMisIndexes() {
  try {
    const [taiex, otc] = await Promise.all([
      fetchJson(ENDPOINTS.mis_taiex, 6000),
      fetchJson(ENDPOINTS.mis_otc, 6000),
    ]);
    const results = [];
    const taiexItem = taiex?.msgArray?.[0];
    if (taiexItem) {
      const close = taiexItem.z || taiexItem.y || "--";
      const prev  = parseFloat(taiexItem.y) || 0;
      const curr  = parseFloat(close) || 0;
      const diff  = prev ? (curr - prev).toFixed(2) : "0";
      const pct   = prev ? ((curr - prev) / prev * 100).toFixed(2) : "0";
      results.push({
        指數: "發行量加權股價指數",
        收盤指數: close,
        漲跌: diff >= 0 ? "+" : "-",
        漲跌點數: Math.abs(diff).toString(),
        漲跌百分比: Math.abs(pct).toString(),
        _source: "MIS即時",
      });
    }
    const otcItem = otc?.msgArray?.[0];
    if (otcItem) {
      const close = otcItem.z || otcItem.y || "--";
      const prev  = parseFloat(otcItem.y) || 0;
      const curr  = parseFloat(close) || 0;
      const diff  = prev ? (curr - prev).toFixed(2) : "0";
      const pct   = prev ? ((curr - prev) / prev * 100).toFixed(2) : "0";
      results.push({
        指數: "櫃買指數",
        收盤指數: close,
        漲跌: diff >= 0 ? "+" : "-",
        漲跌點數: Math.abs(diff).toString(),
        漲跌百分比: Math.abs(pct).toString(),
        _source: "MIS即時",
      });
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function fetchFutures() {
  try {
    const data = await fetchJson(ENDPOINTS.futures, 6000);
    if (!Array.isArray(data)) return null;
    const tx = data.find(item =>
      (item["商品代號"] || item["ProductCode"] || "").startsWith("TX")
    );
    if (!tx) return null;
    return {
      name:   tx["商品名稱"] || tx["ProductName"] || "台指期",
      month:  tx["到期月份(週別)"] || tx["ContractMonth"] || "--",
      price:  tx["成交價格"] || tx["SettlementPrice"] || "--",
      change: tx["漲跌價格"] || "--",
      volume: tx["成交量"] || "--",
    };
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  const trading = isTradingHours();
  let indexes = [];
  let stocks  = [];
  let futures = null;
  let source  = "";
  let errors  = [];
  if (trading) {
    indexes = await fetchMisIndexes();
    if (indexes.length > 0) source = "MIS即時盤中資料";
  }
  if (!indexes.length) {
    try {
      const raw = await fetchJson(ENDPOINTS.indexes, 10000);
      indexes = Array.isArray(raw) ? raw : [];
      source = "TWSE OpenAPI 盤後資料";
    } catch (e) {
      errors.push(`indexes: ${e.message}`);
    }
  }
  try {
    const raw = await fetchJson(ENDPOINTS.stocks, 12000);
    stocks = Array.isArray(raw) ? raw : [];
  } catch (e) {
    errors.push(`stocks: ${e.message}`);
  }
  futures = await fetchFutures();
  const ok = indexes.length > 0 || stocks.length > 0;
  response.setHeader(
    "Cache-Control",
    trading ? "s-maxage=30, stale-while-revalidate=60" : "s-maxage=120, stale-while-revalidate=300"
  );
  response.status(ok ? 200 : 502).json({
    ok,
    source: source || "TWSE OpenAPI",
    trading,
    updatedAt: new Date().toISOString(),
    indexes,
    stocks,
    futures,
    ...(errors.length ? { errors } : {}),
  });
};
