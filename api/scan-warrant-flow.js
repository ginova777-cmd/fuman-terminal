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

function parseTwDate(value) {
  const text = String(value ?? "").trim();
  const roc = text.match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  if (roc) return new Date(Number(roc[1]) + 1911, Number(roc[2]) - 1, Number(roc[3]));
  const ymd = text.replace(/\D/g, "");
  if (ymd.length === 8) return new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
  return null;
}

function daysBetween(date, now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.ceil((end - start) / 86400000);
}

function formatIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function normalizeBasicInfo(row) {
  const code = String(getValue(row, ["權證代號", "代號"])).trim();
  const name = String(getValue(row, ["權證簡稱", "名稱"])).trim();
  const typeText = String(getValue(row, ["權證類型", "種類"])).trim();
  const underlyingCode = String(getValue(row, ["標的代號"])).trim();
  const underlyingName = String(getValue(row, ["標的名稱"])).trim();
  const expiry = parseTwDate(getValue(row, ["履約截止日", "到期日"]));
  const lastTrade = parseTwDate(getValue(row, ["最後交易日"]));
  const strike = cleanNumber(getValue(row, ["履約價格(元)/點數", "最新履約價"]));
  const exerciseRatio = cleanNumber(getValue(row, ["行使比例", "最新行使比例"]));
  if (!code || !underlyingCode || !underlyingName || !strike) return null;
  return {
    code,
    name,
    type: /認售/.test(typeText) ? "put" : /認購/.test(typeText) ? "call" : inferType(name),
    underlyingCode,
    underlyingName,
    expiryDate: formatIsoDate(expiry),
    lastTradeDate: formatIsoDate(lastTrade),
    daysToExpiry: daysBetween(expiry),
    strike,
    exerciseRatio,
  };
}

async function fetchTwseWarrantBasics() {
  const errors = [];
  for (const date of recentTradingDates(5)) {
    const tradeDate = formatTwseDate(date);
    const url = `https://www.twse.com.tw/rwd/zh/stock/warrantStock?date=${tradeDate}&response=json`;
    try {
      const payload = await fetchJson(url, 25000);
      if (payload?.stat !== "OK" || !Array.isArray(payload.data)) continue;
      const rows = payload.data.map((items) => {
        const row = {};
        (payload.fields || []).forEach((field, index) => { row[String(field).replace(/\s/g, "")] = items[index] || ""; });
        return normalizeBasicInfo(row);
      }).filter(Boolean);
      if (rows.length) return { rows, errors };
    } catch (error) {
      errors.push(`上市權證基本資料 ${tradeDate}: ${error.message}`);
    }
  }
  return { rows: [], errors };
}

async function fetchTpexWarrantBasics() {
  const errors = [];
  const url = "https://www.tpex.org.tw/www/zh-tw/warrant/wntmand?response=json";
  try {
    const payload = await fetchJson(url, 25000);
    const table = (payload.tables || [])[0];
    const rows = (table?.data || []).map((items) => {
      const row = {};
      (table.fields || []).forEach((field, index) => { row[String(field).replace(/\s/g, "")] = items[index] || ""; });
      return normalizeBasicInfo(row);
    }).filter(Boolean);
    return { rows, errors };
  } catch (error) {
    errors.push(`上櫃權證基本資料: ${error.message}`);
    return { rows: [], errors };
  }
}

async function fetchWarrantBasics() {
  const [twse, tpex] = await Promise.all([fetchTwseWarrantBasics(), fetchTpexWarrantBasics()]);
  const byCode = new Map();
  [...twse.rows, ...tpex.rows].forEach((item) => byCode.set(item.code, item));
  return { byCode, errors: [...twse.errors, ...tpex.errors] };
}

function quoteLevels(value) {
  return String(value ?? "").split("_").map(cleanNumber).filter((number) => number > 0);
}

function firstPositive(...values) {
  for (const value of values) {
    const number = quoteLevels(value)[0] || cleanNumber(value);
    if (number > 0) return number;
  }
  return 0;
}

async function fetchUnderlyingQuotes(codes) {
  const uniqueCodes = [...new Set(codes)].filter((code) => /^\d{4}$/.test(code));
  const byCode = new Map();
  for (let index = 0; index < uniqueCodes.length; index += 40) {
    const chunk = uniqueCodes.slice(index, index + 40);
    const channels = chunk.flatMap((code) => [`tse_${code}.tw`, `otc_${code}.tw`]);
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels.join("|"))}&json=1&delay=0&_=${Date.now()}`;
    try {
      const payload = await fetchJson(url, 20000);
      for (const item of payload?.msgArray || []) {
        const code = String(item?.c || "").trim();
        const close = firstPositive(item.z, item.pz, item.b, item.a, item.h, item.l, item.o, item.y);
        const prevClose = cleanNumber(item.y);
        if (!/^\d{4}$/.test(code) || !close || !prevClose) continue;
        byCode.set(code, {
          code,
          close,
          percent: ((close - prevClose) / prevClose) * 100,
          tradeVolume: firstPositive(item.v, item.tv),
        });
      }
    } catch {}
  }
  return byCode;
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
  const basics = await fetchWarrantBasics();
  const enriched = rows.map((row) => {
    const basic = basics.byCode.get(row.code) || {};
    return {
      ...row,
      ...basic,
      type: basic.type || row.type,
      underlyingName: basic.underlyingName || row.underlyingName,
      underlyingCode: basic.underlyingCode || row.underlyingCode || "",
    };
  });
  const quotes = await fetchUnderlyingQuotes(enriched.map((row) => row.underlyingCode).filter(Boolean));
  enriched.forEach((row) => {
    const quote = quotes.get(row.underlyingCode);
    if (!quote) return;
    row.underlyingClose = quote.close;
    row.underlyingPercent = quote.percent;
    row.underlyingVolume = quote.tradeVolume;
    if (row.strike) {
      row.moneynessPct = row.type === "put"
        ? ((row.strike - quote.close) / row.strike) * 100
        : ((quote.close - row.strike) / row.strike) * 100;
      row.isAtMoney = row.moneynessPct >= -5 && row.moneynessPct <= 20;
    }
  });
  return { rows: enriched, errors: [...errors, ...basics.errors] };
}

function normalizeSearchKeyword(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesUnderlyingKeyword(item, keyword) {
  if (!keyword) return true;
  const code = String(item.underlyingCode || "").toLowerCase();
  const name = String(item.underlyingName || "").toLowerCase();
  return code.includes(keyword) || name.includes(keyword);
}

function aggregate(rows, keyword = "") {
  const byName = new Map();
  for (const row of rows) {
    if (isEtfUnderlying(row.underlyingName, row.name)) continue;
    const days = Number(row.daysToExpiry);
    if (!Number.isFinite(days) || days < 10) continue;
    const key = row.underlyingName;
    const item = byName.get(key) || {
      underlyingName: key,
      underlyingCode: row.underlyingCode || "",
      underlyingClose: row.underlyingClose || 0,
      underlyingPercent: Number.isFinite(Number(row.underlyingPercent)) ? Number(row.underlyingPercent) : null,
      callValue: 0,
      putValue: 0,
      callVolume: 0,
      putVolume: 0,
      callCount: 0,
      putCount: 0,
      atMoneyCallCount: 0,
      minDaysToExpiry: days,
      marketSet: new Set(),
      tradeDate: row.tradeDate,
      topWarrants: [],
    };
    item.marketSet.add(row.market);
    item.tradeDate = row.tradeDate || item.tradeDate;
    item.underlyingCode = item.underlyingCode || row.underlyingCode || "";
    item.underlyingClose = item.underlyingClose || row.underlyingClose || 0;
    item.underlyingPercent = item.underlyingPercent ?? row.underlyingPercent ?? null;
    item.minDaysToExpiry = Math.min(item.minDaysToExpiry, days);
    if (row.type === "call") {
      item.callValue += row.value;
      item.callVolume += row.volume;
      item.callCount += 1;
      if (row.isAtMoney) item.atMoneyCallCount += 1;
    } else if (row.type === "put") {
      item.putValue += row.value;
      item.putVolume += row.volume;
      item.putCount += 1;
    }
    item.topWarrants.push(row);
    byName.set(key, item);
  }

  const scoredItems = [...byName.values()].map((item) => {
    item.topWarrants = item.topWarrants
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((warrant) => ({
        code: warrant.code,
        name: warrant.name,
        type: warrant.type,
        value: warrant.value,
        volume: warrant.volume,
        strike: warrant.strike || 0,
        daysToExpiry: warrant.daysToExpiry ?? null,
        moneynessPct: Number.isFinite(Number(warrant.moneynessPct)) ? Number(Number(warrant.moneynessPct).toFixed(2)) : null,
      }));
    const totalValue = item.callValue + item.putValue;
    const ratio = item.putValue ? item.callValue / item.putValue : item.callValue ? 99 : 0;
    const breadth = item.callCount + item.putCount;
    const callBias = totalValue ? item.callValue / totalValue : 0;
    const conditionScore =
      Math.min(item.callValue / 10000000, 24) +
      Math.min(item.callCount * 3.2, 20) +
      Math.min(item.atMoneyCallCount * 5, 20) +
      Math.min(ratio * 4, 16) +
      (item.minDaysToExpiry >= 10 ? 10 : -30) +
      (callBias >= 0.78 ? 10 : callBias >= 0.65 ? 5 : 0);
    const score = Math.min(100, Math.max(0, Math.round(20 + conditionScore)));
    const level = (
      item.callValue >= 20000000 &&
      item.callCount >= 5 &&
      item.atMoneyCallCount >= 2 &&
      item.minDaysToExpiry >= 10 &&
      ratio >= 2.5
    ) ? "A" : (
      item.callValue >= 8000000 &&
      item.callCount >= 3 &&
      item.minDaysToExpiry >= 10 &&
      ratio >= 1.8
    ) ? "B" : "C";
    return {
      underlyingName: item.underlyingName,
      underlyingCode: item.underlyingCode,
      market: [...item.marketSet].join("/"),
      tradeDate: item.tradeDate,
      underlyingClose: item.underlyingClose,
      underlyingPercent: item.underlyingPercent,
      callValue: item.callValue,
      putValue: item.putValue,
      totalValue,
      callVolume: item.callVolume,
      putVolume: item.putVolume,
      callCount: item.callCount,
      putCount: item.putCount,
      atMoneyCallCount: item.atMoneyCallCount,
      minDaysToExpiry: item.minDaysToExpiry,
      breadth,
      callPutRatio: Number(ratio.toFixed(2)),
      score,
      level,
      topWarrants: item.topWarrants,
      reason: `${level}級：認購 ${item.callCount} 檔、價平/價內 ${item.atMoneyCallCount} 檔、認購金額 ${(item.callValue / 100000000).toFixed(2)} 億，認購/認售比 ${ratio >= 99 ? "99+" : ratio.toFixed(2)}，最近到期 ${item.minDaysToExpiry} 天。`,
    };
  });

  const baseFilter = keyword
    ? (item) => matchesUnderlyingKeyword(item, keyword)
    : (item) => (
    item.callValue >= 3000000 &&
    item.callCount >= 2 &&
    item.minDaysToExpiry >= 10 &&
    item.callValue > item.putValue &&
    item.callPutRatio >= 1.2
  );

  return scoredItems
    .filter(baseFilter)
    .sort((a, b) => b.score - a.score || b.atMoneyCallCount - a.atMoneyCallCount || b.callValue - a.callValue);
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

  const keyword = normalizeSearchKeyword(request.query?.q || request.query?.code || "");

  if (!keyword && cache && Date.now() - cache.ts < CACHE_MS) {
    response.status(200).json(cache.payload);
    return;
  }

  try {
    const { rows, errors } = await fetchWarrants();
    const matches = aggregate(rows, keyword).slice(0, keyword ? 30 : 120);
    const payload = {
      ok: true,
      updatedAt: new Date().toISOString(),
      query: keyword,
      scanned: rows.length,
      count: matches.length,
      matches,
      errors,
      sources: [
        "mopsfin.twse.com.tw/opendata/t187ap42_L.csv",
        "dts.twse.com.tw/opendata/t187ap42_O.csv",
      ],
    };
    if (!keyword) cache = { ts: Date.now(), payload };
    response.setHeader("Cache-Control", keyword ? "s-maxage=60, stale-while-revalidate=120" : "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, matches: [] });
  }
};
