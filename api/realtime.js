async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://mis.twse.com.tw/",
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function priceLevels(value) {
  return String(value ?? "")
    .split("_")
    .map(cleanNumber)
    .filter((number) => number > 0);
}

function firstPositive(...values) {
  for (const value of values) {
    const number = priceLevels(value)[0] || cleanNumber(value);
    if (number > 0) return number;
  }
  return 0;
}

function parseQuote(item) {
  const code = String(item?.c || "").trim();
  if (!/^\d{4}$/.test(code)) return null;
  const close = firstPositive(item.z, item.pz, item.b, item.a, item.h, item.l, item.o, item.y);
  const prevClose = cleanNumber(item.y);
  if (!close || !prevClose) return null;
  const change = close - prevClose;
  return {
    code,
    name: item.n || code,
    close,
    change,
    percent: prevClose ? (change / prevClose) * 100 : 0,
    open: cleanNumber(item.o),
    high: cleanNumber(item.h),
    low: cleanNumber(item.l),
    prevClose,
    limitUp: cleanNumber(item.u),
    limitDown: cleanNumber(item.w),
    tradeVolume: firstPositive(item.v, item.tv),
    market: item.ex || "",
    time: item.t || "",
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const codes = String(request.query?.codes || "")
    .split(",")
    .map((code) => code.replace(/\D/g, "").slice(0, 4))
    .filter((code) => /^\d{4}$/.test(code))
    .slice(0, 100);

  if (!codes.length) {
    response.status(400).json({ ok: false, error: "Missing codes", quotes: [] });
    return;
  }

  const channels = codes.flatMap((code) => [`tse_${code}.tw`, `otc_${code}.tw`]);
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels.join("|"))}&json=1&delay=0`;

  try {
    const data = await fetchWithTimeout(url);
    const byCode = new Map();
    for (const item of data?.msgArray || []) {
      const quote = parseQuote(item);
      if (!quote) continue;
      const previous = byCode.get(quote.code);
      if (!previous || quote.close || quote.tradeVolume) byCode.set(quote.code, quote);
    }
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      updatedAt: new Date().toISOString(),
      count: byCode.size,
      quotes: [...byCode.values()],
    });
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, quotes: [] });
  }
};
