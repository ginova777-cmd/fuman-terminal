// api/market.js — 即時加權指數 + 櫃買指數
async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json, text/plain, */*",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "text/html, text/plain, */*",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
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

  // 加權指數（即時）
  try {
    const data = await fetchWithTimeout(
      "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_t00.tw&json=1&delay=0",
      { headers: { "Referer": "https://mis.twse.com.tw/" } }
    );
    const item = data?.msgArray?.[0];
    if (item) {
      const current = parseFloat(item.z !== "-" ? item.z : item.y) || 0;
      const prev    = parseFloat(item.y) || 0;
      const { diff, pct, sign } = calcChange(current, prev);
      results.push({
        指數: "發行量加權股價指數",
        收盤指數: current > 0 ? current.toFixed(2) : prev.toFixed(2),
        漲跌: sign,
        漲跌點數: diff,
        漲跌百分比: pct,
        _source: "MIS即時",
      });
    }
  } catch (e) {
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
    } catch (e2) {}
  }

  // 櫃買指數（即時）
  try {
    const data = await fetchWithTimeout(
      "https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=otc_o00.tw&json=1&delay=0",
      { headers: { "Referer": "https://mis.twse.com.tw/" } }
    );
    const item = data?.msgArray?.[0];
    if (item) {
      const current = parseFloat(item.z !== "-" ? item.z : item.y) || 0;
      const prev    = parseFloat(item.y) || 0;
      const { diff, pct, sign } = calcChange(current, prev);
      results.push({
        指數: "櫃買指數",
        收盤指數: current > 0 ? current.toFixed(2) : prev.toFixed(2),
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
    const data = await fetchWithTimeout("https://mis.taifex.com.tw/futures/api/getQuoteList", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Referer": "https://mis.taifex.com.tw/",
        "Origin": "https://mis.taifex.com.tw",
      },
      body: JSON.stringify({
        MarketType: "0",
        SymbolType: "F",
        KindID: "1",
        CID: "TXF",
        ExpireMonth: "",
        RowSize: "5",
        PageNo: "1",
        Language: "zh-tw",
      }),
    }, 8000);
    const list = (data?.RtData?.QuoteList || data?.RtnData?.QuoteList || [])
      .filter((item) => String(item.SymbolID || "").includes("-F"));
    const toItem = (item) => {
      if (!item) return null;
      const price = parseFloat(String(item.CLastPrice || "").replace(/,/g, "")) || 0;
      const prev = parseFloat(String(item.CRefPrice || "").replace(/,/g, "")) || 0;
      if (!price || !prev) return null;
      const diff = price - prev;
      const pct = prev ? (diff / prev) * 100 : 0;
      const sign = diff >= 0 ? "+" : "-";
      const basisLabel = price > prev ? "多方勢（高於結算）" : price < prev ? "空方勢（低於結算）" : "平盤整理";
      return {
        name: item.DispCName || item.CName || "台指期",
        month: item.SymbolID || item.CID || "",
        price: price.toFixed(0),
        change: `${sign}${Math.abs(diff).toFixed(0)}`,
        pct: `${sign}${Math.abs(pct).toFixed(2)}%`,
        volume: item.CTotalVolume || "--",
        basisLabel,
        basisSide: price > prev ? "long" : price < prev ? "short" : "flat",
      };
    };

    return { near: toItem(list[0]), next: toItem(list[1] || null) };
  } catch (error) {
    return { near: null, next: null };
  }
}

async function fetchOtcYahooSignal() {
  try {
    const html = await fetchTextWithTimeout("https://tw.stock.yahoo.com/quote/006201.TW", {}, 8000);
    const start = html.indexOf("漲→跌");
    if (start < 0) return null;
    const area = html.slice(start, start + 600);
    const percentMatch = area.match(/(\d+(?:\.\d+)?)%/);
    if (!percentMatch) return null;
    const isDown = area.includes("border-color:#00ab5e") || area.includes("▼");
    return {
      label: `漲→跌(${isDown ? "▼" : "▲"} ${percentMatch[1]}%)`,
      side: isDown ? "down" : "up",
      source: "Yahoo 006201.TW",
    };
  } catch (error) {
    return null;
  }
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
  const [indexes, futures, otcSignal] = await Promise.all([fetchIndexes(), fetchFutures(), fetchOtcYahooSignal()]);
  const ok = indexes.length > 0;

  response.setHeader(
    "Cache-Control",
    trading
      ? "s-maxage=15, stale-while-revalidate=30"
      : "s-maxage=30, stale-while-revalidate=60"
  );

  response.status(ok ? 200 : 502).json({
    ok,
    source: "MIS即時",
    trading,
    marketStatus,
    updatedAt: new Date().toISOString(),
    indexes,
    stocks: [],
    futures: futures.near,
    futuresNear: futures.near,
    futuresNext: futures.next,
    otcSignal,
  });
};
