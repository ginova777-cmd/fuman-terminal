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

const UPSTREAM_CODE_CHUNK_SIZE = Math.max(1, Number(process.env.REALTIME_UPSTREAM_CODE_CHUNK_SIZE || 8));
const UPSTREAM_TIMEOUT_MS = Math.max(2000, Number(process.env.REALTIME_UPSTREAM_TIMEOUT_MS || 6500));

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
  const close = firstPositive(item.z, item.pz, item.o, item.h, item.l, item.y);
  const prevClose = cleanNumber(item.y);
  if (!close || !prevClose) return null;
  const closeSource = priceLevels(item.z)[0]
    ? "z"
    : priceLevels(item.pz)[0]
      ? "pz"
      : cleanNumber(item.o)
        ? "open"
        : cleanNumber(item.h)
          ? "high"
          : cleanNumber(item.l)
            ? "low"
            : "prevClose";
  const change = close - prevClose;
  return {
    code,
    name: item.n || code,
    close,
    closeSource,
    change,
    percent: prevClose ? (change / prevClose) * 100 : 0,
    open: cleanNumber(item.o),
    high: firstPositive(item.h, item.z, item.pz, item.o, item.y),
    low: firstPositive(item.l, item.z, item.pz, item.o, item.y),
    prevClose,
    limitUp: cleanNumber(item.u),
    limitDown: cleanNumber(item.w),
    tradeVolume: firstPositive(item.v, item.tv),
    market: item.ex || "",
    time: item.t || "",
  };
}

function addQuote(byCode, item) {
  const quote = parseQuote(item);
  if (!quote) return;
  const previous = byCode.get(quote.code);
  if (!previous || quote.close || quote.tradeVolume) byCode.set(quote.code, quote);
}

async function fetchCodeChunk(codes) {
  const channels = codes.flatMap((code) => [`tse_${code}.tw`, `otc_${code}.tw`]);
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels.join("|"))}&json=1&delay=0`;
  return await fetchWithTimeout(url, {}, UPSTREAM_TIMEOUT_MS);
}

async function fetchQuotes(codes) {
  const byCode = new Map();
  const errors = [];
  for (let index = 0; index < codes.length; index += UPSTREAM_CODE_CHUNK_SIZE) {
    const chunk = codes.slice(index, index + UPSTREAM_CODE_CHUNK_SIZE);
    const label = `${chunk[0]}-${chunk.at(-1)}`;
    try {
      const data = await fetchCodeChunk(chunk);
      for (const item of data?.msgArray || []) addQuote(byCode, item);
      continue;
    } catch (error) {
      errors.push({ range: label, size: chunk.length, error: error.message });
    }
    for (const code of chunk) {
      try {
        const data = await fetchCodeChunk([code]);
        for (const item of data?.msgArray || []) addQuote(byCode, item);
      } catch (error) {
        errors.push({ code, size: 1, error: error.message });
      }
    }
  }
  return { byCode, errors };
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

  try {
    const { byCode, errors } = await fetchQuotes(codes);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      partial: errors.length > 0,
      updatedAt: new Date().toISOString(),
      requested: codes.length,
      count: byCode.size,
      quotes: [...byCode.values()],
      errors: errors.slice(0, 20),
    });
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, quotes: [] });
  }
};
