async function fetchText(url, options = {}, timeout = 15000) {
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

function withTimeout(promise, timeout, fallback) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "" || value === "-" || value === "--") return 0;
  return Number(String(value).replace(/[,+%]/g, "").replace(/^X/i, "")) || 0;
}

function isCommonStockCode(code) {
  return /^\d{4}$/.test(String(code || "").trim());
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const INDUSTRY_NAMES = {
  "01": "水泥工業",
  "02": "食品工業",
  "03": "塑膠工業",
  "04": "紡織纖維",
  "05": "電機機械",
  "06": "電器電纜",
  "08": "玻璃陶瓷",
  "09": "造紙工業",
  "10": "鋼鐵工業",
  "11": "橡膠工業",
  "12": "汽車工業",
  "14": "建材營造",
  "15": "航運業",
  "16": "觀光餐旅",
  "17": "金融保險",
  "18": "貿易百貨",
  "20": "其他",
  "21": "化學工業",
  "22": "生技醫療",
  "23": "油電燃氣",
  "24": "半導體",
  "25": "電腦及週邊",
  "26": "光電",
  "27": "通信網路",
  "28": "電子零組件",
  "29": "電子通路",
  "30": "資訊服務",
  "31": "其他電子",
  "32": "文化創意",
  "33": "農業科技",
  "34": "電子商務",
  "35": "綠能環保",
  "36": "數位雲端",
  "37": "運動休閒",
  "38": "居家生活",
};

function normalizeIndustry(value) {
  const raw = String(value || "").trim();
  return INDUSTRY_NAMES[raw] || raw || "未分類";
}

function getTaipeiRocDate() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const year = now.getFullYear() - 1911;
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
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

  if (!rows.length) return [];
  const headers = rows[0].map((item) => item.trim().replace(/^\uFEFF/, ""));
  return rows.slice(1).map((items) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = String(items[index] || "").trim();
    });
    return record;
  });
}

function normalizeTwseRow(row) {
  const code = String(row.Code || row["證券代號"] || "").trim();
  if (!isCommonStockCode(code)) return null;
  const name = String(row.Name || row["證券名稱"] || "").trim();
  const close = cleanNumber(row.ClosingPrice || row["收盤價"]);
  const change = cleanNumber(row.Change || row["漲跌價差"]);
  const value = cleanNumber(row.TradeValue || row["成交金額"]);
  const volume = cleanNumber(row.TradeVolume || row["成交股數"]);
  if (!name || !close) return null;
  return { code, name, close, change, value, volume, market: "tse" };
}

function normalizeTpexRow(row) {
  const code = String(row.Code || row.SecuritiesCompanyCode || row["代號"] || row["證券代號"] || "").trim();
  if (!isCommonStockCode(code)) return null;
  const name = String(row.Name || row.CompanyName || row["名稱"] || row["證券名稱"] || "").trim();
  const close = cleanNumber(row.ClosingPrice || row.Close || row["收盤"] || row["收盤價"]);
  const change = cleanNumber(row.Change || row["漲跌"] || row["漲跌價差"]);
  const value = cleanNumber(row.TradeValue || row["成交金額"]);
  const volume = cleanNumber(row.TradeVolume || row["成交股數"]);
  if (!name || !close) return null;
  return { code, name, close, change, value, volume, market: "otc" };
}

async function fetchTwseStocks() {
  const rows = JSON.parse(await fetchText("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"));
  return rows.map(normalizeTwseRow).filter(Boolean);
}

async function fetchTpexStocks() {
  const date = getTaipeiRocDate();
  const jsonUrl = `https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(date)}&s=0,asc,0`;
  const csvUrl = `https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=csv&d=${encodeURIComponent(date)}&s=0,asc,0`;

  try {
    const payload = JSON.parse(await fetchText(jsonUrl, { headers: { Referer: "https://www.tpex.org.tw/" } }));
    const table = payload.tables?.[0] || {};
    const fields = payload.fields || payload.iTotalRecords?.fields || table.fields || [];
    const rows = payload.aaData || payload.data || table.data || [];
    if (Array.isArray(rows) && rows.length) {
      return rows.map((row) => {
        if (!Array.isArray(row)) return normalizeTpexRow(row);
        const record = {};
        fields.forEach((field, index) => {
          record[field] = row[index];
        });
        return normalizeTpexRow(record);
      }).filter(Boolean);
    }
  } catch {}

  const csv = await fetchText(csvUrl, { headers: { Referer: "https://www.tpex.org.tw/" } });
  return parseCsv(csv).map(normalizeTpexRow).filter(Boolean);
}

async function fetchCompanyProfiles() {
  const sources = [
    "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv",
    "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv",
  ];
  const profileMap = {};

  await Promise.allSettled(sources.map(async (url) => {
    const rows = parseCsv(await fetchText(url));
    rows.forEach((row) => {
      const code = String(row["公司代號"] || "").trim();
      const industry = String(row["產業別"] || "").trim();
      if (isCommonStockCode(code) && industry) profileMap[code] = normalizeIndustry(industry);
    });
  }));

  return profileMap;
}

async function fetchBatchQuotes(stocks) {
  const query = stocks.map((stock) => `${stock.market}_${stock.code}.tw`).join("|");
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(query)}&json=1&delay=0`;
  try {
    const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://mis.twse.com.tw/" } }));
    return payload.msgArray || [];
  } catch {
    return [];
  }
}

async function fetchRealtimeQuotes(stocks) {
  const quoteMap = new Map();
  const chunks = chunkArray(stocks, 90);
  const quotePromise = Promise.all(chunks.map(fetchBatchQuotes));
  const results = await withTimeout(quotePromise, 6500, []);

  results.flat().forEach((item) => {
    const code = String(item.c || "").trim();
    if (!code) return;
    const close = cleanNumber(item.z) || cleanNumber(item.y);
    const prev = cleanNumber(item.y) || close;
    if (!close || !prev) return;
    const volumeLots = cleanNumber(item.v);
    const change = close - prev;
    quoteMap.set(code, {
      close,
      prev,
      change,
      pct: prev ? (change / prev) * 100 : 0,
      volume: volumeLots || 0,
      value: volumeLots ? volumeLots * 1000 * close : 0,
    });
  });

  return quoteMap;
}

function mergeQuote(stock, quote) {
  if (!quote) {
    const prev = stock.close - stock.change;
    return {
      ...stock,
      prev,
      pct: prev ? (stock.change / prev) * 100 : 0,
      amountYi: stock.value / 100000000,
    };
  }

  return {
    ...stock,
    close: quote.close,
    prev: quote.prev,
    change: quote.change,
    pct: quote.pct,
    volume: quote.volume || stock.volume,
    value: quote.value || stock.value,
    amountYi: (quote.value || stock.value) / 100000000,
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") { response.status(405).json({ ok: false, error: "Method not allowed" }); return; }

  try {
    const [twseResult, tpexResult, profileResult] = await Promise.allSettled([
      fetchTwseStocks(),
      fetchTpexStocks(),
      fetchCompanyProfiles(),
    ]);

    const stocks = [
      ...(twseResult.status === "fulfilled" ? twseResult.value : []),
      ...(tpexResult.status === "fulfilled" ? tpexResult.value : []),
    ];
    const profileMap = profileResult.status === "fulfilled" ? profileResult.value : {};
    const byCode = new Map();
    stocks.forEach((stock) => byCode.set(stock.code, stock));
    const uniqueStocks = [...byCode.values()];
    const quoteMap = await fetchRealtimeQuotes(uniqueStocks);
    const groups = {};

    uniqueStocks.forEach((baseStock) => {
      const sector = profileMap[baseStock.code] || (baseStock.market === "otc" ? "上櫃未分類" : "上市未分類");
      const stock = mergeQuote(baseStock, quoteMap.get(baseStock.code));
      if (!stock.close) return;

      if (!groups[sector]) {
        groups[sector] = { name: sector, stocks: [], totalValue: 0, up: 0, down: 0, flat: 0 };
      }

      groups[sector].stocks.push(stock);
      groups[sector].totalValue += stock.amountYi;
      if (stock.change > 0) groups[sector].up++;
      else if (stock.change < 0) groups[sector].down++;
      else groups[sector].flat++;
    });

    const sectors = Object.values(groups)
      .map((group) => {
        const avgPct = group.stocks.reduce((sum, stock) => sum + stock.pct, 0) / group.stocks.length;
        const sortedStocks = [...group.stocks].sort((a, b) => b.amountYi - a.amountYi);
        const leader = sortedStocks[0];
        const totalValue = Number(group.totalValue.toFixed(1));
        return {
          name: group.name,
          pct: Number(avgPct.toFixed(2)),
          totalValue,
          amountYi: totalValue,
          count: group.stocks.length,
          up: group.up,
          down: group.down,
          flat: group.flat,
          leader: leader ? `${leader.name} ${leader.pct >= 0 ? "+" : ""}${leader.pct.toFixed(2)}%` : "--",
          leaderCode: leader?.code || "",
          stocks: sortedStocks.map((stock) => ({
            code: stock.code,
            name: stock.name,
            close: stock.close,
            prev: stock.prev,
            change: Number(stock.change.toFixed(2)),
            pct: Number(stock.pct.toFixed(2)),
            amountYi: Number(stock.amountYi.toFixed(2)),
            value: stock.value,
            volume: stock.volume,
          })),
        };
      })
      .sort((a, b) => b.pct - a.pct);

    response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    response.status(200).json({
      ok: sectors.length > 0,
      source: "TWSE/TPEx full stock list + MOPS industry profiles + MIS quotes",
      updatedAt: new Date().toISOString(),
      stockCount: uniqueStocks.length,
      sectorCount: sectors.length,
      sectors,
      errors: {
        twse: twseResult.status === "rejected" ? twseResult.reason.message : null,
        tpex: tpexResult.status === "rejected" ? tpexResult.reason.message : null,
        profiles: profileResult.status === "rejected" ? profileResult.reason.message : null,
      },
    });
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message });
  }
};
