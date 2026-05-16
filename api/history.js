const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

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
        "Referer": "https://www.twse.com.tw/",
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
  return Number(String(value).replace(/[,+%]/g, "").replace(/^X/i, "").trim()) || 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function rocToIso(value) {
  const parts = String(value || "").split("/");
  if (parts.length !== 3) return "";
  const year = Number(parts[0]) + 1911;
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function monthStarts(count = 8) {
  const dates = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    dates.push({
      twse: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}01`,
      tpex: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/01`,
    });
  }
  return dates;
}

function normalizeTwseRows(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data.map((row) => ({
    date: rocToIso(row[0]),
    volume: cleanNumber(row[1]),
    value: cleanNumber(row[2]),
    open: cleanNumber(row[3]),
    high: cleanNumber(row[4]),
    low: cleanNumber(row[5]),
    close: cleanNumber(row[6]),
    change: cleanNumber(row[7]),
  })).filter((row) => row.date && row.close);
}

function normalizeTpexRows(payload) {
  const table = Array.isArray(payload?.tables) ? payload.tables[0] : null;
  if (!Array.isArray(table?.data)) return [];
  return table.data.map((row) => ({
    date: rocToIso(row[0]),
    volume: cleanNumber(row[1]),
    value: cleanNumber(row[2]) * 1000,
    open: cleanNumber(row[3]),
    high: cleanNumber(row[4]),
    low: cleanNumber(row[5]),
    close: cleanNumber(row[6]),
    change: cleanNumber(row[7]),
  })).filter((row) => row.date && row.close);
}

async function fetchTwseMonth(code, date) {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?response=json&date=${date}&stockNo=${code}`;
  const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://www.twse.com.tw/" } }));
  if (payload?.stat && payload.stat !== "OK") return [];
  return normalizeTwseRows(payload);
}

async function fetchTpexMonth(code, date) {
  const url = `https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${code}&date=${encodeURIComponent(date)}&id=&response=json`;
  const payload = JSON.parse(await fetchText(url, { headers: { Referer: "https://www.tpex.org.tw/" } }));
  return normalizeTpexRows(payload);
}

async function fetchHistory(code) {
  const cached = cache.get(code);
  if (cached && Date.now() - cached.ts < CACHE_MS) return cached.value;

  const months = monthStarts(8);
  let market = "TWSE";
  let rows = [];
  const twseResults = await Promise.allSettled(months.map((item) => fetchTwseMonth(code, item.twse)));
  rows = twseResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);

  if (rows.length < 25) {
    market = "TPEX";
    const tpexResults = await Promise.allSettled(months.map((item) => fetchTpexMonth(code, item.tpex)));
    rows = tpexResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  }

  const byDate = new Map();
  rows.forEach((row) => byDate.set(row.date, row));
  const value = {
    code,
    market,
    count: byDate.size,
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-180),
  };
  cache.set(code, { ts: Date.now(), value });
  return value;
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed", histories: [] });
    return;
  }

  const codes = String(request.query?.codes || "")
    .split(",")
    .map(normalizeCode)
    .filter((code) => /^\d{4}$/.test(code))
    .slice(0, 12);

  if (!codes.length) {
    response.status(400).json({ ok: false, error: "Missing codes", histories: [] });
    return;
  }

  const results = await Promise.allSettled(codes.map(fetchHistory));
  const histories = results
    .filter((result) => result.status === "fulfilled" && result.value?.rows?.length)
    .map((result) => result.value);

  response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
  response.status(histories.length ? 200 : 502).json({
    ok: histories.length > 0,
    updatedAt: new Date().toISOString(),
    count: histories.length,
    histories,
    errors: results
      .map((result, index) => result.status === "rejected" ? `${codes[index]}: ${result.reason.message}` : null)
      .filter(Boolean),
  });
};
