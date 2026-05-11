// api/market.js — 改用 Yahoo Finance，避免 TWSE/TAIFEX 封鎖海外 IP

const YAHOO_SYMBOLS = {
  taiex:      "^TWII",    // 加權指數
  otc:        "^TWOII",   // 櫃買指數
  futures:    "TXF=F",    // 台指期近月
};

async function fetchYahoo(symbol, timeout = 8000) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new Error("No meta data");
    return meta;
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
    sign: diff >= 0 ? "+" : "-",
  };
}

async function fetchIndexes() {
  const results = [];

  // 加權指數
  try {
    const meta = await fetchYahoo(YAHOO_SYMBOLS.taiex);
    const current = meta.regularMarketPrice;
    const prev    = meta.chartPreviousClose || meta.previousClose;
    const { diff, pct, sign } = calcChange(current, prev);
    results.push({
      指數: "發行量加權股價指數",
      收盤指數: current?.toFixed(2) ?? "--",
      漲跌: sign,
      漲跌點數: diff,
      漲跌百分比: pct,
      _source: "Yahoo Finance",
    });
  } catch (e) {
    // 加權指數失敗，略過
  }

  // 櫃買指數
  try {
    const meta = await fetchYahoo(YAHOO_SYMBOLS.otc);
    const current = meta.regularMarketPrice;
    const prev    = meta.chartPreviousClose || meta.previousClose;
    const { diff, pct, sign } = calcChange(current, prev);
    results.push({
      指數: "櫃買指數",
      收盤指數: current?.toFixed(2) ?? "--",
      漲跌: sign,
      漲跌點數: diff,
      漲跌百分比: pct,
      _source: "Yahoo Finance",
    });
  } catch (e) {
    // 櫃買指數失敗，略過
  }

  return results;
}

async function fetchFutures() {
  try {
    const meta = await fetchYahoo(YAHOO_SYMBOLS.futures);
    const current = meta.regularMarketPrice;
    const prev    = meta.chartPreviousClose || meta.previousClose;
    const { diff, sign } = calcChange(current, prev);
    return {
      name:       "臺股期貨",
      month:      meta.contractSymbol || "近月",
      price:      current?.toFixed(0) ?? "--",
      change:     `${sign}${diff}`,
      volume:     meta.regularMarketVolume?.toString() ?? "--",
      _source:    "Yahoo Finance",
    };
  } catch (e) {
    return null;
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

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const trading = isTradingHours();

  const [indexes, futures] = await Promise.all([
    fetchIndexes(),
    fetchFutures(),
  ]);

  const ok = indexes.length > 0;

  response.setHeader(
    "Cache-Control",
    trading
      ? "s-maxage=30, stale-while-revalidate=60"
      : "s-maxage=120, stale-while-revalidate=300"
  );

  response.status(ok ? 200 : 502).json({
    ok,
    source: "Yahoo Finance",
    trading,
    updatedAt: new Date().toISOString(),
    indexes,
    stocks: [],   // Yahoo Finance 不提供個股清單，保留空陣列維持相容性
    futures,
  });
};
