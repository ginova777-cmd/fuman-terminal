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

const EXCLUDED_SINGLE_SIGNAL_UNDERLYINGS = new Set([
  "2330",
]);

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
  const slash = text.match(/^(\d{2,4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (slash) {
    const year = Number(slash[1]);
    return new Date(year < 1911 ? year + 1911 : year, Number(slash[2]) - 1, Number(slash[3]));
  }
  const ymd = text.replace(/\D/g, "");
  if (ymd.length === 7) return new Date(Number(ymd.slice(0, 3)) + 1911, Number(ymd.slice(3, 5)) - 1, Number(ymd.slice(5, 7)));
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
          source: `MIS ${item.ex || ""}`.trim(),
        });
      }
    } catch {}
  }
  return byCode;
}

function normalizeTwseStockQuote(row) {
  const code = String(row.Code || row.StockNo || row["證券代號"] || "").trim();
  const name = String(row.Name || row.StockName || row["證券名稱"] || "").trim();
  const close = cleanNumber(row.ClosingPrice || row.Close || row["收盤價"] || row["收盤"]);
  const change = cleanNumber(row.Change || row["漲跌價差"] || row["漲跌"]);
  const volume = cleanNumber(row.TradeVolume || row["成交股數"] || row["成交股數(股)"]);
  if (!/^\d{4}$/.test(code) || !close) return null;
  const prevClose = close - change;
  return { code, name, close, percent: prevClose > 0 ? (change / prevClose) * 100 : 0, tradeVolume: volume, source: "TWSE STOCK_DAY_ALL" };
}

function normalizeTpexStockQuote(row) {
  const code = String(getValue(row, ["代號", "證券代號", "SecuritiesCompanyCode", "Code"])).trim();
  const name = String(getValue(row, ["名稱", "證券名稱", "CompanyName", "Name"])).trim();
  const close = cleanNumber(getValue(row, ["收盤", "收盤價", "Close", "ClosingPrice"]));
  const change = cleanNumber(getValue(row, ["漲跌", "漲跌價差", "Change"]));
  const volume = cleanNumber(getValue(row, ["成交股數", "成交數量", "成交張數", "TradingShares", "Volume"]));
  if (!/^\d{4}$/.test(code) || !close) return null;
  const prevClose = close - change;
  return { code, name, close, percent: prevClose > 0 ? (change / prevClose) * 100 : 0, tradeVolume: volume, source: "TPEX daily_close_quotes" };
}

async function fetchOfficialUnderlyingQuotes(codes) {
  const wanted = new Set([...new Set(codes)].filter((code) => /^\d{4}$/.test(code)));
  const byCode = new Map();
  const errors = [];
  try {
    const twseRows = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", 25000);
    for (const quote of (Array.isArray(twseRows) ? twseRows : []).map(normalizeTwseStockQuote).filter(Boolean)) {
      if (!wanted.size || wanted.has(quote.code)) byCode.set(quote.code, quote);
    }
  } catch (error) {
    errors.push(`TWSE 官方日收盤: ${error.message}`);
  }
  for (const date of recentTradingDates(5)) {
    const tradeDate = formatTpexDate(date);
    const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&o=json&d=${encodeURIComponent(tradeDate)}&s=0,asc,0`;
    try {
      const payload = await fetchJson(url, 25000);
      const table = (payload.tables || [payload]).find((entry) => (entry.data || entry.aaData || []).length);
      const quotes = tableRecords(table).map(normalizeTpexStockQuote).filter(Boolean);
      if (quotes.length) {
        for (const quote of quotes) if (!wanted.size || wanted.has(quote.code)) byCode.set(quote.code, quote);
        break;
      }
    } catch (error) {
      errors.push(`TPEX 官方日收盤 ${tradeDate}: ${error.message}`);
    }
  }
  return { byCode, errors };
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
  let missingBasics = 0;
  const enriched = rows.map((row) => {
    const basic = basics.byCode.get(row.code);
    if (!basic?.underlyingCode || !basic?.underlyingName) {
      missingBasics += 1;
      return null;
    }
    return {
      ...row,
      ...basic,
      type: basic.type || row.type,
      underlyingName: basic.underlyingName,
      underlyingCode: basic.underlyingCode,
      basicVerified: true,
      basicSource: "TWSE/TPEX warrant basics",
    };
  }).filter(Boolean);

  const officialQuotes = await fetchOfficialUnderlyingQuotes(enriched.map((row) => row.underlyingCode));
  const misQuotes = await fetchUnderlyingQuotes(enriched.map((row) => row.underlyingCode));
  let missingQuotes = 0;
  const verifiedRows = enriched.map((row) => {
    const quote = officialQuotes.byCode.get(row.underlyingCode) || misQuotes.get(row.underlyingCode);
    if (!quote) {
      missingQuotes += 1;
      return null;
    }
    row.underlyingClose = quote.close;
    row.underlyingPercent = quote.percent;
    row.underlyingVolume = quote.tradeVolume;
    row.priceVerified = true;
    row.quoteSource = quote.source || "official/MIS quote";
    if (row.strike) {
      row.moneynessPct = row.type === "put"
        ? ((row.strike - quote.close) / row.strike) * 100
        : ((quote.close - row.strike) / row.strike) * 100;
      row.isAtMoney = row.moneynessPct >= -5 && row.moneynessPct <= 20;
    }
    return row;
  }).filter(Boolean);

  const verificationErrors = [];
  if (missingBasics) verificationErrors.push(`已剔除 ${missingBasics} 筆無權證基本資料對照的權證。`);
  if (missingQuotes) verificationErrors.push(`已剔除 ${missingQuotes} 筆找不到官方標的收盤價的權證。`);
  return { rows: verifiedRows, errors: [...errors, ...basics.errors, ...officialQuotes.errors, ...verificationErrors] };}

function normalizeSearchKeyword(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesUnderlyingKeyword(item, keyword) {
  if (!keyword) return true;
  const code = String(item.underlyingCode || "").toLowerCase();
  const name = String(item.underlyingName || "").toLowerCase();
  return code.includes(keyword) || name.includes(keyword);
}

function clampScore(value) {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

function scoreUnderlyingMove(percent) {
  if (!Number.isFinite(Number(percent))) return 10;
  const pct = Number(percent);
  if (pct >= 0 && pct <= 2.5) return 18;
  if (pct > 2.5 && pct <= 4) return 12;
  if (pct > 4 && pct <= 6) return 6;
  if (pct > 6) return -14;
  if (pct >= -2) return 8;
  return -10;
}

function scoreStockSetup(percent) {
  if (!Number.isFinite(Number(percent))) {
    return { score: 48, label: "股價待確認", risk: "unknown" };
  }
  const pct = Number(percent);
  if (pct >= 0 && pct <= 1.5) return { score: 88, label: "股票未噴，權證先熱", risk: "good" };
  if (pct > 1.5 && pct <= 3) return { score: 76, label: "漲幅可控", risk: "good" };
  if (pct > 3 && pct <= 4.5) return { score: 58, label: "短線偏熱", risk: "watch" };
  if (pct > 4.5 && pct <= 6) return { score: 36, label: "追價風險高", risk: "hot" };
  if (pct > 6) return { score: 18, label: "已明顯過熱", risk: "hot" };
  if (pct >= -1.5) return { score: 62, label: "回檔觀察", risk: "watch" };
  return { score: 28, label: "股價偏弱", risk: "weak" };
}

function normalizeBranchSupport(branchFlow) {
  if (!branchFlow || typeof branchFlow !== "object") {
    return {
      available: false,
      score: 0,
      status: "待接分點",
      label: "分點主力待確認",
      topBuyer: "",
      topSeller: "",
      concentration: 0,
      streakDays: 0,
      source: "",
    };
  }
  const concentration = cleanNumber(branchFlow.concentration);
  const streakDays = cleanNumber(branchFlow.streakDays);
  const netBuy = cleanNumber(branchFlow.netBuy);
  const topBuyer = String(branchFlow.topBuyer || "").trim();
  const topSeller = String(branchFlow.topSeller || "").trim();
  const score = clampScore(
    cleanNumber(branchFlow.score) ||
    Math.min(concentration * 1.6, 34) +
    Math.min(streakDays * 9, 30) +
    (netBuy > 0 ? 18 : netBuy < 0 ? -18 : 0) +
    (topBuyer ? 10 : 0)
  );
  const status = score >= 78 ? "主力集中" : score >= 56 ? "分點偏多" : score >= 35 ? "分點觀察" : "分點偏弱";
  return {
    available: true,
    score,
    status,
    label: branchFlow.label || status,
    topBuyer,
    topSeller,
    concentration,
    streakDays,
    source: branchFlow.source || "",
  };
}

function classifyWarrantSignal({ warrantHeatScore, stockSetupScore, branchSupport, finalScore }) {
  if (branchSupport.available && branchSupport.score >= 70 && warrantHeatScore >= 75 && stockSetupScore >= 65) {
    return { grade: "A+", action: "權證熱 + 分點確認" };
  }
  if (warrantHeatScore >= 76 && stockSetupScore >= 62 && finalScore >= 72) {
    return { grade: "A", action: branchSupport.available ? "高機率觀察" : "權證強，待分點確認" };
  }
  if (warrantHeatScore >= 62 && stockSetupScore >= 45) {
    return { grade: "B", action: "候選觀察" };
  }
  return { grade: "C", action: "只列熱度，不追價" };
}

function buildSingleWarrantBursts(rows) {
  const byCode = new Map();
  for (const row of rows) {
    if (!row || row.type !== "call") continue;
    const code = String(row.code || "");
    if (!code) continue;
    const value = cleanNumber(row.value);
    const days = cleanNumber(row.daysToExpiry);
    const pct = Number(row.underlyingPercent);
    if (!value || !Number.isFinite(days) || days < 10) continue;
    if (Number.isFinite(pct) && (pct <= -3 || pct > 6)) continue;
    const item = byCode.get(code) || {
      signalCount: 0,
      largeSignalCount: 0,
      maxSignalValue: 0,
      totalSignalValue: 0,
    };
    item.signalCount += 1;
    item.largeSignalCount += value >= 4000000 ? 1 : 0;
    item.maxSignalValue = Math.max(item.maxSignalValue, value);
    item.totalSignalValue += value;
    byCode.set(code, item);
  }
  for (const item of byCode.values()) {
    item.estimatedLargeSignalCount = Math.max(
      item.largeSignalCount,
      item.totalSignalValue >= 6000000 ? 2 : item.totalSignalValue >= 4000000 ? 1 : 0
    );
  }
  return byCode;
}

function scoreSingleWarrantSignal(row, aggregateItem, burstItem) {
  if (!row || row.type !== "call") return null;
  const underlyingCode = String(row.underlyingCode || "");
  if (EXCLUDED_SINGLE_SIGNAL_UNDERLYINGS.has(underlyingCode)) return null;
  if (/^00/.test(underlyingCode) || isEtfUnderlying(row.underlyingName, row.name)) return null;
  const value = cleanNumber(row.value);
  const days = cleanNumber(row.daysToExpiry);
  const pct = Number(row.underlyingPercent);
  if (!value || !Number.isFinite(days) || days < 10) return null;
  if (Number.isFinite(pct) && (pct <= -3 || pct > 6)) return null;

  const moneynessPct = Number(row.moneynessPct);
  const isNearMoney = Number.isFinite(moneynessPct) && moneynessPct >= -8 && moneynessPct <= 25;
  const stockSetup = scoreStockSetup(row.underlyingPercent);
  const groupCallValue = cleanNumber(aggregateItem?.callValue);
  const groupCallCount = cleanNumber(aggregateItem?.callCount);
  const groupPutValue = cleanNumber(aggregateItem?.putValue);
  const signalCount = cleanNumber(burstItem?.signalCount) || 1;
  const largeSignalCount = cleanNumber(burstItem?.largeSignalCount) || (value >= 4000000 ? 1 : 0);
  const estimatedLargeSignalCount = cleanNumber(burstItem?.estimatedLargeSignalCount) || largeSignalCount;
  const maxSignalValue = Math.max(cleanNumber(burstItem?.maxSignalValue), value);
  const totalSignalValue = Math.max(cleanNumber(burstItem?.totalSignalValue), value);
  const hasRepeatLargeSignal = estimatedLargeSignalCount >= 2;
  const singleValueScore = Math.min(value / 1000000 * 4.5, 32);
  const moneynessScore = isNearMoney ? 20 : Number.isFinite(moneynessPct) && moneynessPct > 40 ? 0 : 8;
  const repeatScore = hasRepeatLargeSignal ? 18 : largeSignalCount >= 1 ? 6 : 0;
  const groupScore = aggregateItem
    ? Math.min(groupCallValue / 8000000 * 6, 14) + Math.min(groupCallCount * 1.2, 8)
    : 0;
  const stockMoveBonus = Number.isFinite(pct)
    ? pct >= 0 && pct <= 2.8 ? 16 : pct > 2.8 && pct <= 4.5 ? 8 : pct >= -1.5 ? 7 : 2
    : 6;
  const setupScore = Math.min(stockSetup.score * 0.22, 18);
  const expiryScore = days >= 45 ? 6 : days >= 20 ? 3 : 0;
  const putDrag = groupPutValue > groupCallValue * 0.35 ? -8 : 0;
  const score = clampScore(10 + singleValueScore + moneynessScore + repeatScore + groupScore + stockMoveBonus + setupScore + expiryScore + putDrag);
  const isBurst = value >= 4000000 && score >= 68;
  const isRepeatBurst = hasRepeatLargeSignal && score >= 72 && stockSetup.score >= 45;
  const isEarly = value >= 3000000 && score >= 76 && stockSetup.score >= 58 && isNearMoney;
  if (!isBurst && !isEarly && !isRepeatBurst) return null;

  const grade = hasRepeatLargeSignal || score >= 82 ? "A" : score >= 70 ? "B" : "C";
  return {
    warrantCode: row.code,
    warrantName: row.name,
    code: row.underlyingCode || "",
    name: row.underlyingName || "",
    underlyingCode: row.underlyingCode || "",
    underlyingName: row.underlyingName || "",
    underlyingClose: row.underlyingClose || 0,
    underlyingPercent: Number.isFinite(Number(row.underlyingPercent)) ? Number(row.underlyingPercent) : null,
    value,
    volume: cleanNumber(row.volume),
    strike: cleanNumber(row.strike),
    daysToExpiry: days,
    moneynessPct: Number.isFinite(moneynessPct) ? Number(moneynessPct.toFixed(2)) : null,
    isNearMoney,
    stockSetupScore: stockSetup.score,
    stockSetupLabel: stockSetup.label,
    groupCallValue,
    groupCallCount,
    groupPutValue,
    signalCount,
    largeSignalCount,
    estimatedLargeSignalCount,
    maxSignalValue,
    totalSignalValue,
    hasRepeatLargeSignal,
    score,
    signalGrade: grade,
    actionLabel: hasRepeatLargeSignal ? "單券連續大額" : grade === "A" ? "單券強訊號" : "單券異動觀察",
    tradeDate: row.tradeDate || "",
    quoteSource: row.quoteSource || "",
    reason: `${grade}：${hasRepeatLargeSignal ? "單券連續大額" : grade === "A" ? "單券強訊號" : "單券異動觀察"}。${row.code} ${row.name} 單券成交 ${(value / 10000).toFixed(0)} 萬，${hasRepeatLargeSignal ? `同券大額訊號 ${estimatedLargeSignalCount} 筆、合計 ${(totalSignalValue / 10000).toFixed(0)} 萬，` : ""}標的 ${row.underlyingName} ${Number.isFinite(pct) ? pct.toFixed(2) : "--"}%，${isNearMoney ? "接近價平" : "價外/價內待確認"}，最近到期 ${days} 天。`,
  };
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
        underlyingCode: warrant.underlyingCode,
        underlyingName: warrant.underlyingName,
        basicVerified: Boolean(warrant.basicVerified),
        priceVerified: Boolean(warrant.priceVerified),
        quoteSource: warrant.quoteSource || "",
      }));
    const totalValue = item.callValue + item.putValue;
    const ratio = item.putValue ? item.callValue / item.putValue : item.callValue ? 99 : 0;
    const breadth = item.callCount + item.putCount;
    const callBias = totalValue ? item.callValue / totalValue : 0;
    const callValueScore = Math.min(item.callValue / 5000000, 24);
    const breadthScore = Math.min(item.callCount * 2.4, 18);
    const ratioScore = Math.min(ratio * 3.2, 16);
    const moneynessScore = Math.min(item.atMoneyCallCount * 4, 16);
    const underlyingMoveScore = scoreUnderlyingMove(item.underlyingPercent);
    const expiryScore = item.minDaysToExpiry >= 10 ? 8 : -30;
    const biasScore = callBias >= 0.78 ? 8 : callBias >= 0.65 ? 4 : 0;
    const warrantHeatScore = clampScore(
      10 +
      callValueScore +
      breadthScore +
      ratioScore +
      moneynessScore +
      expiryScore +
      biasScore
    );
    const stockSetup = scoreStockSetup(item.underlyingPercent);
    const branchSupport = normalizeBranchSupport(item.branchFlow);
    const finalScore = clampScore(
      (warrantHeatScore * 0.58) +
      (stockSetup.score * 0.28) +
      (branchSupport.score * 0.14) +
      (branchSupport.available ? 0 : -4)
    );
    const signal = classifyWarrantSignal({
      warrantHeatScore,
      stockSetupScore: stockSetup.score,
      branchSupport,
      finalScore,
    });
    const score = clampScore(finalScore + Math.max(-8, Math.min(8, underlyingMoveScore / 2)));
    const level = (
      item.callValue >= 20000000 &&
      item.callCount >= 5 &&
      item.atMoneyCallCount >= 2 &&
      item.minDaysToExpiry >= 10 &&
      ratio >= 2.5 &&
      stockSetup.score >= 45
    ) ? "A" : (
      item.callValue >= 8000000 &&
      item.callCount >= 3 &&
      item.minDaysToExpiry >= 10 &&
      ratio >= 1.8 &&
      stockSetup.score >= 35
    ) ? "B" : "C";
    return {
      underlyingName: item.underlyingName,
      underlyingCode: item.underlyingCode,
      market: [...item.marketSet].join("/"),
      tradeDate: item.tradeDate,
      underlyingClose: item.underlyingClose,
      underlyingPercent: item.underlyingPercent,
      priceVerified: true,
      basicVerified: true,
      quoteSource: item.topWarrants[0]?.quoteSource || "",
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
      finalScore,
      warrantHeatScore,
      stockSetupScore: stockSetup.score,
      stockSetupLabel: stockSetup.label,
      stockRisk: stockSetup.risk,
      branchPowerScore: branchSupport.score,
      branchStatus: branchSupport.status,
      branchLabel: branchSupport.label,
      branchAvailable: branchSupport.available,
      branchTopBuyer: branchSupport.topBuyer,
      branchTopSeller: branchSupport.topSeller,
      branchConcentration: branchSupport.concentration,
      branchStreakDays: branchSupport.streakDays,
      signalGrade: signal.grade,
      actionLabel: signal.action,
      level,
      topWarrants: item.topWarrants,
      reason: `${signal.grade}：${signal.action}。權證熱度 ${warrantHeatScore}、股票型態 ${stockSetup.score}（${stockSetup.label}）、分點 ${branchSupport.status}；認購 ${item.callCount} 檔、價平/價內 ${item.atMoneyCallCount} 檔、認購金額 ${(item.callValue / 100000000).toFixed(2)} 億，認購/認售比 ${ratio >= 99 ? "99+" : ratio.toFixed(2)}，最近到期 ${item.minDaysToExpiry} 天。`,
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
    .sort((a, b) =>
      b.finalScore - a.finalScore ||
      b.score - a.score ||
      b.callValue - a.callValue ||
      b.callCount - a.callCount ||
      b.callPutRatio - a.callPutRatio ||
      b.atMoneyCallCount - a.atMoneyCallCount ||
      Math.abs(cleanNumber(a.underlyingPercent) - 1.2) - Math.abs(cleanNumber(b.underlyingPercent) - 1.2)
    );
}

function detectSingleWarrantSignals(rows, aggregateItems = [], keyword = "") {
  const aggregateByCode = new Map();
  for (const item of aggregateItems) {
    const code = String(item.underlyingCode || item.code || "");
    if (code) aggregateByCode.set(code, item);
  }
  const burstsByWarrant = buildSingleWarrantBursts(rows);
  const signals = rows
    .map((row) => scoreSingleWarrantSignal(
      row,
      aggregateByCode.get(String(row.underlyingCode || "")),
      burstsByWarrant.get(String(row.code || ""))
    ))
    .filter(Boolean)
    .filter((item) => !keyword || matchesUnderlyingKeyword(item, keyword) || String(item.warrantCode || "").toLowerCase().includes(keyword))
    .sort((a, b) =>
      Number(b.hasRepeatLargeSignal) - Number(a.hasRepeatLargeSignal) ||
      cleanNumber(b.estimatedLargeSignalCount) - cleanNumber(a.estimatedLargeSignalCount) ||
      cleanNumber(b.score) - cleanNumber(a.score) ||
      Number(b.isNearMoney) - Number(a.isNearMoney) ||
      cleanNumber(b.value) - cleanNumber(a.value) ||
      Math.abs(cleanNumber(a.underlyingPercent) - 1.2) - Math.abs(cleanNumber(b.underlyingPercent) - 1.2)
    );
  if (keyword) return signals;
  const byUnderlying = new Map();
  for (const signal of signals) {
    const code = String(signal.underlyingCode || signal.code || "");
    if (code && !byUnderlying.has(code)) byUnderlying.set(code, signal);
  }
  return [...byUnderlying.values()].slice(0, 20);
}

function buildVolumeMatches(items, keyword = "") {
  return items
    .filter((item) => keyword ? matchesUnderlyingKeyword(item, keyword) : true)
    .filter((item) =>
      cleanNumber(item.callVolume) >= 500000 ||
      cleanNumber(item.callValue) >= 3000000 ||
      cleanNumber(item.callCount) >= 10
    )
    .map((item) => {
      const thirtyMinuteVolume = Math.round(cleanNumber(item.callVolume) / 1000);
      const floatingUnits = Math.max(1, Math.round(cleanNumber(item.callCount) || cleanNumber(item.callValue) / 100000));
      const volumeMultiple = thirtyMinuteVolume / Math.max(1, floatingUnits * 5);
      return {
        ...item,
        thirtyMinuteVolume,
        floatingUnits,
        volumeMultiple: Number(volumeMultiple.toFixed(2)),
      };
    })
    .sort((a, b) =>
      cleanNumber(b.volumeMultiple) - cleanNumber(a.volumeMultiple) ||
      cleanNumber(b.thirtyMinuteVolume) - cleanNumber(a.thirtyMinuteVolume) ||
      cleanNumber(b.callValue) - cleanNumber(a.callValue) ||
      cleanNumber(b.warrantHeatScore) - cleanNumber(a.warrantHeatScore)
    )
    .slice(0, keyword ? 30 : 320);
}

function buildScannerPayloadFromRows(rows, { keyword = "", updatedAt = new Date().toISOString() } = {}) {
  const aggregated = aggregate(rows, keyword);
  const matches = aggregated.slice(0, keyword ? 30 : 120);
  const volumeMatches = buildVolumeMatches(aggregated, keyword);
  const singleSignals = detectSingleWarrantSignals(rows, aggregated, keyword).slice(0, keyword ? 20 : 20);
  return {
    ok: true,
    updatedAt,
    query: keyword,
    scanned: rows.length,
    count: matches.length,
    matches,
    volumeCount: volumeMatches.length,
    volumeMatches,
    singleSignalCount: singleSignals.length,
    singleSignals,
    errors: [],
    sources: [
      "mopsfin.twse.com.tw/opendata/t187ap42_L.csv",
      "dts.twse.com.tw/opendata/t187ap42_O.csv",
    ],
  };
}

async function handler(request, response) {
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
    const payload = { ...buildScannerPayloadFromRows(rows, { keyword }), errors };
    if (!keyword) cache = { ts: Date.now(), payload };
    response.setHeader("Cache-Control", keyword ? "s-maxage=60, stale-while-revalidate=120" : "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, matches: [] });
  }
}

module.exports = handler;
module.exports._prewater = {
  aggregate,
  buildScannerPayloadFromRows,
  buildVolumeMatches,
  detectSingleWarrantSignals,
};

