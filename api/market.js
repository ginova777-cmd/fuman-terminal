// api/market.js — TWSE（加權）+ MIS即時（櫃買）+ 期交所MIS（台指期）

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
  const diff = (current - prev).toFixed(2);
  const pct  = ((current - prev) / prev * 100).toFixed(2);
  return {
    diff: Math.abs(diff).toString(),
    pct:  Math.abs(pct).toString(),
    sign: parseFloat(diff) >= 0 ? "+" : "-",
  };
}

async function fetchIndexes() {
  const results = [];

  // 加權指數 — TWSE OpenAPI（穩定）
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

async function fetchFutures() {
  try {
    const data = await fetchWithTimeout(
      "https://mis.taifex.com.tw/futures/api/getQuoteList?SymbolType=F&MarketType=0&commodity_id=TX",
      { headers: { "Referer": "https://mis.taifex.com.tw/" } }
    );
    const list = data?.RtData?.QuoteList;
    if (!Array.isArray(list) || list.length === 0) return { near: null, next: null };

    const toFutures = (item) => {
      if (!item) return null;
      const price = parseFloat(item.CLastPrice) || 0;
      const prev  = parseFloat(item.CRefPrice)  || 0;
      const { diff, sign } = calcChange(price, prev);
      return {
        name:    item.DispCName  || "台指期",
        month:   item.CSymbol    || "--",
        price:   item.CLastPrice || "--",
        change:  `${sign}${diff}`,
        volume:  item.CTotalVolume || "--",
        _source: "期交所MIS",
      };
    };

    return {
      near: toFutures(list[0]),
      next: toFutures(list[1] || null),
    };
  } catch (e) {
    return { near: null, next: null };
  }
}

function isTradingHours() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = now.getDay();
  const totalMinutes = now.getHours() * 60 + now.getMinutes();
  if (day === 0 || day === 6) return false;
  return totalMinutes >= 9 * 60 && totalMinutes <= 13 * 60 + 35;
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") { response.status(405).json({ error: "Method not allowed" }); return; }

  const trading = isTradingHours();

  const [indexes, futuresResult] = await Promise.all([
    fetchIndexes(),
    fetchFutures(),
  ]);

  const ok = indexes.length > 0;

  response.setHeader(
    "Cache-Control",
    trading ? "s-maxage=30, stale-while-revalidate=60" : "s-maxage=120, stale-while-revalidate=300"
  );

  response.status(ok ? 200 : 502).json({
    ok,
    source: "TWSE + MIS + 期交所",
    trading,
    updatedAt: new Date().toISOString(),
    indexes,
    stocks: [],
    futures:     futuresResult.near,
    futuresNear: futuresResult.near,
    futuresNext: futuresResult.next,
  });
};
