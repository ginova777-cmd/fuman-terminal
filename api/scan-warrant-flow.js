const CACHE_MS = 10 * 60 * 1000;
let cache = null;

const ISSUERS = [
  "中國信託", "中信", "凱基", "元大", "元富", "統一", "群益", "富邦", "國泰", "永豐",
  "台新", "兆豐", "華南", "第一", "玉山", "新光", "康和", "元證", "聯邦", "上海",
  "合庫", "日盛", "大展", "宏遠", "福邦", "致和", "台中銀", "土銀", "臺銀", "台銀"
].sort((a, b) => b.length - a.length);

const ETF_UNDERLYING_PATTERNS = [
  /ETF/i, /ETN/i, /指數/, /期貨/, /期元大/, /期街口/,
  /^元大台灣50$/, /^元大高股息$/, /^元大電子$/, /^元大金融$/,
  /^富邦台50$/, /^富邦科技$/, /^國泰永續高股息$/, /^群益台灣精選高息$/,
  /台灣50/, /臺灣50/, /高股息/, /高息/, /公司治理/, /正2/, /反1/,
  /臺股指/, /台股指/, /道瓊/, /標普/, /NASDAQ/i, /那斯達克/, /費城半導體/,
  /日經/, /恒生/, /滬深/, /上証/, /上證/, /深証/, /深證/, /印度/, /越南/,
  /美債/, /公債/, /投資級債/, /非投等債/, /債\d*/, /原油/, /黃金/,
];

async function fetchText(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        Accept: "text/csv,text/plain,*/*",
        Referer: "https://data.gov.tw/",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeout = 20000) {
  const text = await fetchText(url, timeout);
  return JSON.parse(text);
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

  const headerIndex = rows.findIndex((items) => items.some((item) => item.includes("權證代號")));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((item) => item.replace(/\s/g, ""));
  return rows.slice(headerIndex + 1).map((items) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = items[index] || "";
    });
    return record;
  });
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+]/g, "").trim()) || 0;
}

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/g, "").trim();
}

function getValue(row, keys) {
  for (const key of keys) {
    const found = Object.keys(row).find((item) => item === key || item.includes(key));
    if (found && row[found] !== undefined && row[found] !== "") return row[found];
  }
  return "";
}

function inferType(name) {
  if (/[售熊]/.test(name)) return "put";
  if (/[購牛]/.test(name)) return "call";
  return "unknown";
}

function inferUnderlyingName(name) {
  const text = String(name || "").replace(/\s/g, "");
  for (const issuer of ISSUERS) {
    const index = text.indexOf(issuer);
    if (index > 0) return text.slice(0, index);
  }
  const match = text.match(/^(.+?)(?:[0-9A-Z]{1,2}[0-9A-Z]?購|[0-9A-Z]{1,2}[0-9A-Z]?售|購|售|牛|熊)/);
  return match?.[1] || "";
}

function isEtfUnderlying(name, warrantName = "") {
  const target = String(name || "").replace(/\s/g, "");
  const warrant = String(warrantName || "").replace(/\s/g, "");
  if (!target) return false;
  if (ETF_UNDERLYING_PATTERNS.some((pattern) => pattern.test(target))) return true;
  return ETF_UNDERLYING_PATTERNS.some((pattern) => pattern.test(warrant));
}

function normalizeWarrant(row, market) {
  const code = String(getValue(row, ["權證代號", "Warrantcode", "WarrantCode"])).trim();
  const name = String(getValue(row, ["權證名稱", "WarrantName", "Warrantname"])).trim();
  const value = cleanNumber(getValue(row, ["成交金額", "Transactionamount", "TransactionAmount"]));
  const volume = cleanNumber(getValue(row, ["成交數量", "成交張數", "Transactionvolume", "TransactionVolume"]));
  const tradeDate = String(getValue(row, ["交易日期", "Transactiondate", "TransactionDate"])).trim();
  if (!code || !name || !value) return null;
  const type = inferType(name);
  const underlyingName = inferUnderlyingName(name);
  if (!underlyingName || type === "unknown") return null;
  if (isEtfUnderlying(underlyingName, name)) return null;
  return { code, name, market, type, value, volume, tradeDate, underlyingName };
}

function formatTwseDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatTpexDate(date) {
  const year = String(date.getFullYear() - 1911).padStart(3, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function recentTradingDates(limit = 10) {
  const dates = [];
  const date = new Date();
  for (let i = 0; dates.length < limit && i < 18; i++) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(date));
    date.setDate(date.getDate() - 1);
  }
  return dates;
}

function tableRecords(table) {
  const fields = table?.fields || [];
  const data = table?.data || table?.aaData || [];
  return data.map((items) => {
    const row = {};
    fields.forEach((field, index) => { row[String(field).replace(/\s/g, "")] = items[index] || ""; });
    return row;
  });
}

async function fetchTwseWarrants() {
  const rows = [];
  const errors = [];
  const types = [
    { type: "0999", warrantType: "call" },
    { type: "0999P", warrantType: "put" },
  ];
  for (const date of recentTradingDates()) {
    const tradeDate = formatTwseDate(date);
    const before = rows.length;
    for (const item of types) {
      const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${tradeDate}&type=${item.type}&response=json`;
      try {
        const payload = await fetchJson(url, 25000);
        const table = (payload.tables || []).find((entry) => String(entry.title || "").includes("收盤行情"));
        for (const record of tableRecords(table)) {
          const code = String(getValue(record, ["證券代號"])).trim();
          const name = String(getValue(record, ["證券名稱"])).trim();
          const value = cleanNumber(getValue(record, ["成交金額"]));
          const volume = cleanNumber(getValue(record, ["成交股數"]));
          const underlyingName = String(getValue(record, ["標的名稱"])).trim() || inferUnderlyingName(name);
          if (!code || !name || !value || !underlyingName) continue;
          if (isEtfUnderlying(underlyingName, name)) continue;
          rows.push({ code, name, market: "上市", type: item.warrantType, value, volume, tradeDate, underlyingName });
        }
      } catch (error) {
        errors.push(`上市備援 ${tradeDate}/${item.type}: ${error.message}`);
      }
    }
    if (rows.length > before) return { rows, errors };
  }
  return { rows, errors };
}

async function fetchTpexWarrants() {
  const rows = [];
  const errors = [];
  for (const date of recentTradingDates()) {
    const tradeDate = formatTpexDate(date);
    const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(tradeDate)}&s=0,asc,0`;
    try {
      const payload = await fetchJson(url, 25000);
      const table = (payload.tables || [payload]).find((entry) => (entry.data || entry.aaData || []).length);
      const fields = table?.fields || [];
      const records = tableRecords(table);
      for (const record of records) {
        const code = String(getValue(record, ["代號", "證券代號"])).trim();
        const name = String(getValue(record, ["名稱", "證券名稱"])).trim();
        const value = cleanNumber(getValue(record, ["成交金額(元)", "成交金額"]));
        const volume = cleanNumber(getValue(record, ["成交股數", "成交數量", "成交張數"]));
        const type = inferType(name);
        const underlyingName = inferUnderlyingName(name);
        if (!/^[0-9A-Z]{5,}$/.test(code) || !name || !value || type === "unknown" || !underlyingName) continue;
        if (isEtfUnderlying(underlyingName, name)) continue;
        rows.push({ code, name, market: "上櫃", type, value, volume, tradeDate: payload.date || tradeDate, underlyingName });
      }
      if (rows.length) return { rows, errors };
      if (!fields.length) errors.push(`上櫃備援 ${tradeDate}: no table fields`);
    } catch (error) {
      errors.push(`上櫃備援 ${tradeDate}: ${error.message}`);
    }
  }
  return { rows, errors };
}

async function fetchWarrants() {
  const sources = [
    { market: "上市", urls: ["https://mopsfin.twse.com.tw/opendata/t187ap42_L.csv"] },
    {
      market: "上櫃",
      urls: [
        "https://mopsfin.twse.com.tw/opendata/t187ap42_O.csv",
        "https://dts.twse.com.tw/opendata/t187ap42_O.csv",
      ],
    },
  ];
  const rows = [];
  const errors = [];
  for (const source of sources) {
    let loaded = false;
    const sourceErrors = [];
    for (const url of source.urls) {
      try {
        const text = await fetchText(url);
        const parsed = parseCsv(text).map((row) => normalizeWarrant(row, source.market)).filter(Boolean);
        if (parsed.length) {
          rows.push(...parsed);
          loaded = true;
          break;
        }
      } catch (error) {
        sourceErrors.push(`${source.market}: ${error.message}`);
      }
    }
    if (!loaded) errors.push(...sourceErrors, `${source.market}: no warrant rows`);
  }
  if (!rows.length) {
    const [twse, tpex] = await Promise.all([fetchTwseWarrants(), fetchTpexWarrants()]);
    rows.push(...twse.rows, ...tpex.rows);
    errors.push(...twse.errors, ...tpex.errors);
    if (rows.length) errors.push("MOPS 權證成交檔為空，已改用 TWSE/TPEX 收盤行情備援。");
  }
  return { rows, errors };
}

function aggregate(rows) {
  const byName = new Map();
  for (const row of rows) {
    if (isEtfUnderlying(row.underlyingName, row.name)) continue;
    const key = row.underlyingName;
    const item = byName.get(key) || {
      underlyingName: key,
      callValue: 0,
      putValue: 0,
      callVolume: 0,
      putVolume: 0,
      callCount: 0,
      putCount: 0,
      marketSet: new Set(),
      tradeDate: row.tradeDate,
      topWarrants: [],
    };
    item.marketSet.add(row.market);
    item.tradeDate = row.tradeDate || item.tradeDate;
    if (row.type === "call") {
      item.callValue += row.value;
      item.callVolume += row.volume;
      item.callCount += 1;
    } else if (row.type === "put") {
      item.putValue += row.value;
      item.putVolume += row.volume;
      item.putCount += 1;
    }
    item.topWarrants.push(row);
    byName.set(key, item);
  }

  return [...byName.values()].map((item) => {
    item.topWarrants = item.topWarrants
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((warrant) => ({
        code: warrant.code,
        name: warrant.name,
        type: warrant.type,
        value: warrant.value,
        volume: warrant.volume,
      }));
    const totalValue = item.callValue + item.putValue;
    const ratio = item.putValue ? item.callValue / item.putValue : item.callValue ? 99 : 0;
    const breadth = item.callCount + item.putCount;
    const callBias = totalValue ? item.callValue / totalValue : 0;
    const score = Math.min(100, Math.round(
      30 +
      Math.min(item.callValue / 10000000, 28) +
      Math.min(item.callCount * 3.2, 22) +
      Math.min(ratio * 4, 14) +
      (callBias >= 0.78 ? 8 : callBias >= 0.65 ? 4 : 0)
    ));
    return {
      underlyingName: item.underlyingName,
      market: [...item.marketSet].join("/"),
      tradeDate: item.tradeDate,
      callValue: item.callValue,
      putValue: item.putValue,
      totalValue,
      callVolume: item.callVolume,
      putVolume: item.putVolume,
      callCount: item.callCount,
      putCount: item.putCount,
      breadth,
      callPutRatio: Number(ratio.toFixed(2)),
      score,
      topWarrants: item.topWarrants,
      reason: `認購 ${item.callCount} 檔、認購金額 ${(item.callValue / 100000000).toFixed(2)} 億，認購/認售比 ${ratio >= 99 ? "99+" : ratio.toFixed(2)}。`,
    };
  }).filter((item) => (
    item.callValue >= 8000000 &&
    item.callCount >= 2 &&
    item.callValue > item.putValue &&
    item.callPutRatio >= 1.5
  )).sort((a, b) => b.score - a.score || b.callValue - a.callValue);
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed", matches: [] });
    return;
  }

  if (cache && Date.now() - cache.ts < CACHE_MS) {
    response.status(200).json(cache.payload);
    return;
  }

  try {
    const { rows, errors } = await fetchWarrants();
    const matches = aggregate(rows).slice(0, 120);
    const payload = {
      ok: true,
      updatedAt: new Date().toISOString(),
      scanned: rows.length,
      count: matches.length,
      matches,
      errors,
      sources: [
        "mopsfin.twse.com.tw/opendata/t187ap42_L.csv",
        "dts.twse.com.tw/opendata/t187ap42_O.csv",
      ],
    };
    cache = { ts: Date.now(), payload };
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, matches: [] });
  }
};
