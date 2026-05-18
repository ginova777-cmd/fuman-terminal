const CACHE_MS = 5 * 60 * 1000;
let cache = null;

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        Accept: "application/json,text/plain,*/*",
        Referer: "https://www.twse.com.tw/",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } finally {
    clearTimeout(timer);
  }
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
  const foreign = cleanNumber(getValue(record, ["外資及陸資淨買股數", "外資及陸資買賣超股數", "外陸資買賣超"]) || row?.[4]);
  const trust = cleanNumber(getValue(record, ["投信淨買股數", "投信買賣超股數", "投信買賣超"]) || row?.[7]);
  const dealer = cleanNumber(getValue(record, ["自營商淨買股數", "自營商買賣超股數", "自營商買賣超"]) || row?.[8]);
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
    const [twse, tpex] = await Promise.all([
      latestRows(fetchTwseInstitution),
      latestRows(fetchTpexInstitution),
    ]);
    const data = mergeRows(twse, tpex);
    const dates = [twse.date, tpex.date].filter(Boolean).sort();
    const payload = {
      ok: true,
      usedDate: dates.at(-1) || "",
      sourceDates: { twse: twse.date, tpex: tpex.date },
      count: Object.keys(data).length,
      data,
      errors: [...(twse.errors || []), ...(tpex.errors || [])].slice(0, 8),
      sources: ["TWSE T86", "TPEx 3itrade_hedge_result"],
    };
    cache = { ts: Date.now(), payload };
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, data: {} });
  }
};
