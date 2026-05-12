// api/market.js — TWSE（加權）+ MIS即時（櫃買）
// 台指期改由前端直接抓 mis.taifex.com.tw

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function calcChange(current, prev) {
  if (!prev || !current) return { diff: "0", pct: "0", sign: "+" };
  const diff = (current - prev).toFixed(0);
  const pct  = ((current - prev) / prev * 100).toFixed(2);
  return {
    diff: Math.abs(diff).toString(),
    pct:  Math.abs(pct).toString(),
    sign: parseFloat(diff) >= 0 ? "+" : "-",
  };
}

async function fetchIndexes() {
  const results = [];

  // 加權指數 — TWSE OpenAPI
  try {
    const raw = await fetchWithTimeout("https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX");
    const item = raw.find(r => r["指數"] === "發行量加權股價指數");
    if (item) {
      results.push({
        指數: "發行量加權股價指數",
        收盤指數: item["收盤指數"],
        漲跌: item["漲跌"],
        漲跌點數: item["漲跌點數"],
        漲跌百分比: item["漲跌百分比"],
        _source: "TWSE OpenAPI",
      });
    }
  } catch (e) {}

  // 櫃買指數 — MIS即時
  try {
    const data = await fetchWithTimeout(
      "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_o00.tw&json=1&delay=0",
      { headers: { "Referer": "https://mis.twse.com.tw/" } }
    );
    const item = data?.msgArray?.[0];
    if (item) {
      const current = parseFloat(item.z || item.y) || 0;
      const prev    = parseFloat(item.y) || 0;
      const { diff, pct, sign } = calcChange(current, prev);
      results.push({
        指數: "櫃買指數",
        收盤指數: (item.z || item.y || "--"),
        漲跌: sign,
        漲跌點數: diff,
        漲跌百分比: pct,
        _source: "MIS即時",
      });
    }
  } catch (e) {}

  return results;
}

function getMarketStatus() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day   = now.getDay();
  const total = now.getHours() * 60 + now.getMinutes();

  if (day === 6) return "closed";
  if (day === 0) return total >= 15 * 60 ? "night" : "closed";

  if (total >= 8 * 60 + 45 && total <= 13 * 60 + 45) return "day";
  if (total >= 15 * 60 || total <= 5 * 60) return "night";

  return "closed";
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") { response.status(405).json({ error: "Method not allowed" }); return; }

  const marketStatus = getMarketStatus();
  const trading = marketStatus === "day";

  const indexes = await fetchIndexes();
  const ok = indexes.length > 0;

  response.setHeader(
    "Cache-Control",
    trading
      ? "s-maxage=30, stale-while-revalidate=60"
      : "s-maxage=60, stale-while-revalidate=120"
  );

  response.status(ok ? 200 : 502).json({
    ok,
    source: "TWSE + MIS",
    trading,
    marketStatus,
    updatedAt: new Date().toISOString(),
    indexes,
    stocks: [],
    futures:     null,
    futuresNear: null,
    futuresNext: null,
  });
};
