const CACHE_MS = 5 * 60 * 1000;
let cache = null;

const SLOW_SCAN = ["1", "true", "yes"].includes(String(process.env.INSTITUTION_SLOW_SCAN || "").toLowerCase());
const REQUEST_DELAY_MS = Number(process.env.INSTITUTION_REQUEST_DELAY_MS || (SLOW_SCAN ? 15000 : 1200));
const FETCH_RETRIES = Number(process.env.INSTITUTION_FETCH_RETRIES || (SLOW_SCAN ? 4 : 1));
const FINMIND_TOKEN = process.env.FINMIND_TOKEN || process.env.FINMIND_API_TOKEN || "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableFetchError(error) {
  const message = String(error?.message || "");
  return /HTTP (403|429|500|502|503|504)|aborted|fetch failed/i.test(message);
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+]/g, "").trim()) || 0;
}

function taipeiToday() {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function recentTradingDates(limit = 8) {
  const dates = [];
  const date = taipeiToday();
  for (let i = 0; dates.length < limit && i < 18; i++) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(new Date(date));
    date.setDate(date.getDate() - 1);
  }
  return dates;
}

function formatYmd(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatTpexDate(date) {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

async function fetchJson(url, timeout = 20000) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
          Referer: "https://www.twse.com.tw/",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_RETRIES || !isRetriableFetchError(error)) break;
      const backoffMs = REQUEST_DELAY_MS + attempt * (SLOW_SCAN ? 30000 : 3000);
      await sleep(backoffMs);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function rowRecord(fields, row) {
  if (!Array.isArray(fields) || !Array.isArray(row)) return {};
  const record = {};
  fields.forEach((field, index) => {
    record[String(field || "").replace(/\s/g, "")] = row[index];
  });
  return record;
}

function getValue(record, patterns) {
  const keys = Object.keys(record || {});
  for (const pattern of patterns) {
    const key = keys.find((item) => item.includes(pattern));
    if (key && record[key] !== undefined && record[key] !== "") return record[key];
  }
  return "";
}

function parseTwseRow(fields, row) {
  const record = rowRecord(fields, row);
  const code = String(getValue(record, ["證券代號"]) || row?.[0] || "").trim();
  const name = String(getValue(record, ["證券名稱"]) || row?.[1] || "").trim();
  if (!/^\d{4}$/.test(code)) return null;
  const foreignCore = cleanNumber(getValue(record, ["外陸資買賣超股數(不含外資自營商)", "外資及陸資買賣超股數(不含外資自營商)"]) || row?.[4]);
  const foreignDealer = cleanNumber(getValue(record, ["外資自營商買賣超股數"]) || row?.[7]);
  const trust = cleanNumber(getValue(record, ["投信買賣超股數"]) || row?.[10]);
  const dealer = cleanNumber(getValue(record, ["自營商買賣超股數"]) || row?.[13]);
  const total = cleanNumber(getValue(record, ["三大法人買賣超股數"]) || row?.[row.length - 1]) || foreignCore + foreignDealer + trust + dealer;
  return { code, name, foreign: foreignCore + foreignDealer, trust, dealer, total, market: "上市" };
}

function parseTpexRow(row, fields = []) {
  const record = Array.isArray(row) ? rowRecord(fields, row) : row;
  const code = String(getValue(record, ["代號", "證券代號"]) || row?.[0] || "").trim();
  const name = String(getValue(record, ["名稱", "證券名稱"]) || row?.[1] || "").trim();
  if (!/^\d{4}$/.test(code)) return null;
  const isTpexTable = Array.isArray(row) && row.length >= 24 && fields.filter((field) => String(field).includes("買賣超股數")).length >= 6;
  const foreign = isTpexTable
    ? cleanNumber(row[4])
    : cleanNumber(getValue(record, ["外資及陸資淨買股數", "外資及陸資買賣超股數", "外陸資買賣超"]) || row?.[4]);
  const trust = isTpexTable
    ? cleanNumber(row[13])
    : cleanNumber(getValue(record, ["投信淨買股數", "投信買賣超股數", "投信買賣超"]) || row?.[7]);
  const dealer = isTpexTable
    ? cleanNumber(row[22])
    : cleanNumber(getValue(record, ["自營商淨買股數", "自營商買賣超股數", "自營商買賣超"]) || row?.[8]);
  const total = cleanNumber(getValue(record, ["三大法人買賣超股數", "三大法人買賣超股數合計"]) || row?.[row.length - 1]) || foreign + trust + dealer;
  return { code, name, foreign, trust, dealer, total, market: "上櫃" };
}

async function fetchTwseInstitution(date) {
  const ymd = formatYmd(date);
  const urls = [
    `https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd}&selectType=ALLBUT0999&response=json`,
    `https://www.twse.com.tw/fund/T86?response=json&date=${ymd}&selectType=ALLBUT0999`,
  ];
  for (const url of urls) {
    const payload = await fetchJson(url);
    const rows = (payload.data || [])
      .map((row) => parseTwseRow(payload.fields || [], row))
      .filter(Boolean);
    if (rows.length) return { date: ymd, rows };
  }
  return { date: ymd, rows: [] };
}

async function fetchTpexInstitution(date) {
  const ymd = formatYmd(date);
  const tpexDate = formatTpexDate(date);
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=AL&t=D&d=${encodeURIComponent(tpexDate)}`;
  const payload = await fetchJson(url);
  const table = (payload.tables || [payload]).find((item) => Array.isArray(item?.data) || Array.isArray(item?.aaData)) || payload;
  const fields = table.fields || payload.fields || [];
  const rawRows = table.data || table.aaData || payload.data || payload.aaData || [];
  const rows = rawRows.map((row) => parseTpexRow(row, fields)).filter(Boolean);
  return { date: ymd, rows };
}

async function latestRows(fetcher) {
  const errors = [];
  for (const date of recentTradingDates()) {
    try {
      const result = await fetcher(date);
      if (result.rows.length) return { ...result, errors };
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { date: "", rows: [], errors };
}

async function recentRows(fetcher, limit = 8) {
  const errors = [];
  const groups = [];
  for (const date of recentTradingDates(limit)) {
    try {
      const result = await fetcher(date);
      if (result.rows.length) groups.push(result);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { groups, errors };
}

function formatIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getRecordValue(record, names) {
  const entries = Object.entries(record || {});
  for (const name of names) {
    const direct = record?.[name];
    if (direct !== undefined && direct !== "") return direct;
    const found = entries.find(([key]) => String(key).toLowerCase().replace(/[^a-z0-9]/g, "").includes(String(name).toLowerCase().replace(/[^a-z0-9]/g, "")));
    if (found && found[1] !== undefined && found[1] !== "") return found[1];
  }
  return "";
}

async function fetchFinMindData(dataset, date) {
  const params = new URLSearchParams({
    dataset,
    start_date: formatIsoDate(date),
    end_date: formatIsoDate(date),
  });
  const headers = { Accept: "application/json" };
  if (FINMIND_TOKEN) headers.Authorization = `Bearer ${FINMIND_TOKEN}`;
  const response = await fetch(`https://api.finmindtrade.com/api/v4/data?${params}`, { headers });
  if (!response.ok) throw new Error(`FinMind ${dataset} HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload?.data || !Array.isArray(payload.data)) throw new Error(`FinMind ${dataset} returned no data`);
  return payload.data;
}

function parseFinMindWideRow(row) {
  const code = String(getRecordValue(row, ["stock_id", "stockid"]) || "").trim();
  if (!/^\d{4}$/.test(code)) return null;
  const name = String(getRecordValue(row, ["stock_name", "stockname", "name"]) || "").trim();
  const foreign = (
    cleanNumber(getRecordValue(row, ["Foreign_Investor_buy"])) -
    cleanNumber(getRecordValue(row, ["Foreign_Investor_sell"])) +
    cleanNumber(getRecordValue(row, ["Foreign_Dealer_Self_buy"])) -
    cleanNumber(getRecordValue(row, ["Foreign_Dealer_Self_sell"]))
  );
  const trust = cleanNumber(getRecordValue(row, ["Investment_Trust_buy"])) - cleanNumber(getRecordValue(row, ["Investment_Trust_sell"]));
  const dealer = (
    cleanNumber(getRecordValue(row, ["Dealer_buy"])) -
    cleanNumber(getRecordValue(row, ["Dealer_sell"])) +
    cleanNumber(getRecordValue(row, ["Dealer_self_buy"])) -
    cleanNumber(getRecordValue(row, ["Dealer_self_sell"])) +
    cleanNumber(getRecordValue(row, ["Dealer_Hedging_buy"])) -
    cleanNumber(getRecordValue(row, ["Dealer_Hedging_sell"]))
  );
  const total = foreign + trust + dealer;
  return { code, name, foreign, trust, dealer, total, market: "FinMind" };
}

function parseFinMindLongRows(rows) {
  const byCode = new Map();
  for (const row of rows) {
    const code = String(getRecordValue(row, ["stock_id", "stockid"]) || "").trim();
    if (!/^\d{4}$/.test(code)) continue;
    const stockName = String(getRecordValue(row, ["stock_name", "stockname"]) || "").trim();
    const investor = String(getRecordValue(row, ["name", "institutional_investors", "institutionalinvestors"]) || "").toLowerCase();
    const amount = cleanNumber(getRecordValue(row, ["buy"])) - cleanNumber(getRecordValue(row, ["sell"]));
    const item = byCode.get(code) || { code, name: stockName, foreign: 0, trust: 0, dealer: 0, total: 0, market: "FinMind" };
    if (stockName && !item.name) item.name = stockName;
    if (/foreign|外資|外陸/.test(investor)) item.foreign += amount;
    else if (/trust|投信/.test(investor)) item.trust += amount;
    else if (/dealer|自營/.test(investor)) item.dealer += amount;
    item.total = item.foreign + item.trust + item.dealer;
    byCode.set(code, item);
  }
  return Array.from(byCode.values());
}

async function fetchFinMindInstitution(date) {
  const ymd = formatYmd(date);
  const errors = [];
  try {
    const rows = (await fetchFinMindData("TaiwanStockInstitutionalInvestorsBuySellWide", date))
      .map(parseFinMindWideRow)
      .filter(Boolean);
    if (rows.length) return { date: ymd, rows, source: "FinMind Wide" };
  } catch (error) {
    errors.push(error.message);
  }
  try {
    const rows = parseFinMindLongRows(await fetchFinMindData("TaiwanStockInstitutionalInvestorsBuySell", date));
    if (rows.length) return { date: ymd, rows, source: "FinMind" };
  } catch (error) {
    errors.push(error.message);
  }
  return { date: ymd, rows: [], errors };
}

function buildMarketData(history) {
  const groups = history.groups || [];
  const latest = groups.find((group) => group.rows?.length);
  const data = {};
  if (!latest) return data;
  const rowsByDate = groups.map((group) => ({
    date: group.date,
    byCode: new Map((group.rows || []).map((row) => [row.code, row])),
  }));

  for (const row of latest.rows || []) {
    let foreignStreak = 0;
    let trustStreak = 0;
    let dealerStreak = 0;
    let jointStreak = 0;
    let foreignOpen = true;
    let trustOpen = true;
    let dealerOpen = true;
    let jointOpen = true;

    for (const day of rowsByDate) {
      const dayRow = day.byCode.get(row.code);
      if (!dayRow) break;
      if (foreignOpen && dayRow.foreign > 0) foreignStreak += 1; else foreignOpen = false;
      if (trustOpen && dayRow.trust > 0) trustStreak += 1; else trustOpen = false;
      if (dealerOpen && dayRow.dealer > 0) dealerStreak += 1; else dealerOpen = false;
      if (jointOpen && dayRow.foreign > 0 && dayRow.trust > 0) jointStreak += 1; else jointOpen = false;
      if (!foreignOpen && !trustOpen && !dealerOpen && !jointOpen) break;
    }

    data[row.code] = {
      ...row,
      foreignStreak,
      trustStreak,
      dealerStreak,
      jointStreak,
    };
  }
  return data;
}

function mergeRows(...groups) {
  const data = {};
  for (const group of groups) {
    for (const row of group.rows || []) {
      data[row.code] = {
        ...(data[row.code] || {}),
        ...row,
        foreignStreak: row.foreign > 0 ? 1 : 0,
        trustStreak: row.trust > 0 ? 1 : 0,
        dealerStreak: row.dealer > 0 ? 1 : 0,
        jointStreak: row.foreign > 0 && row.trust > 0 ? 1 : 0,
      };
    }
  }
  return data;
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=300");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed", data: {} });
    return;
  }
  if (cache && Date.now() - cache.ts < CACHE_MS) {
    response.status(200).json(cache.payload);
    return;
  }

  try {
    const [twseHistory, tpexHistory] = SLOW_SCAN
      ? [await recentRows(fetchTwseInstitution, 8), await recentRows(fetchTpexInstitution, 8)]
      : await Promise.all([
        recentRows(fetchTwseInstitution, 8),
        recentRows(fetchTpexInstitution, 8),
      ]);
    const twseData = buildMarketData(twseHistory);
    const tpexData = buildMarketData(tpexHistory);
    let data = { ...twseData, ...tpexData };
    let twseDate = twseHistory.groups?.[0]?.date || "";
    let tpexDate = tpexHistory.groups?.[0]?.date || "";
    const errors = [...(twseHistory.errors || []), ...(tpexHistory.errors || [])];
    const sources = ["TWSE T86", "TPEx 3itrade_hedge_result"];
    if (Object.keys(data).length < 1000) {
      const finMindHistory = await recentRows(fetchFinMindInstitution, 3);
      const finMindData = buildMarketData(finMindHistory);
      if (Object.keys(finMindData).length >= 1000) {
        data = finMindData;
        twseDate = finMindHistory.groups?.[0]?.date || twseDate;
        tpexDate = finMindHistory.groups?.[0]?.date || tpexDate;
        sources.push(finMindHistory.groups?.[0]?.source || "FinMind");
      }
      errors.push(...(finMindHistory.errors || []));
    }
    const dates = [twseDate, tpexDate].filter(Boolean).sort();
    const payload = {
      ok: true,
      usedDate: dates.at(-1) || "",
      sourceDates: { twse: twseDate, tpex: tpexDate },
      count: Object.keys(data).length,
      data,
      errors: errors.slice(0, 12),
      sources,
    };
    cache = { ts: Date.now(), payload };
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, data: {} });
  }
};
