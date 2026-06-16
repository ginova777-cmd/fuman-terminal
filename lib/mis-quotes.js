function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function firstPositive(...values) {
  for (const value of values) {
    const number = cleanNumber(String(value ?? "").split("_")[0]);
    if (number > 0) return number;
  }
  return 0;
}

async function fetchJson(url, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminalBot/1.0)",
        Accept: "application/json,text/plain,*/*",
        Referer: "https://mis.twse.com.tw/",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseMisQuote(item) {
  const code = normalizeCode(item?.c);
  if (!/^\d{4}$/.test(code)) return null;
  const close = firstPositive(item.z, item.pz, item.b, item.a, item.h, item.l, item.o, item.y);
  const prevClose = cleanNumber(item.y);
  const volumeLots = firstPositive(item.v, item.tv);
  if (!close || !prevClose || !volumeLots) return null;
  const change = close - prevClose;
  const tradeVolume = volumeLots * 1000;
  return {
    code,
    name: item.n || code,
    close,
    change,
    percent: prevClose ? (change / prevClose) * 100 : 0,
    open: cleanNumber(item.o),
    high: firstPositive(item.h, item.z, item.pz),
    low: firstPositive(item.l, item.z, item.pz),
    prevClose,
    value: Math.round(close * tradeVolume),
    volume: volumeLots,
    tradeVolume,
    market: item.ex === "otc" ? "TPEX" : "TWSE",
    quoteDate: item.d || item["^"] || "",
    quoteTime: item.t || item.ot || "",
  };
}

async function fetchMisQuotes(codes, batchSize = 80) {
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code) && !/^00/.test(code)))];
  const quotes = new Map();
  for (let i = 0; i < normalized.length; i += batchSize) {
    const chunk = normalized.slice(i, i + batchSize);
    const channels = chunk.flatMap((code) => [`tse_${code}.tw`, `otc_${code}.tw`]);
    try {
      const payload = await fetchJson(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels.join("|"))}&json=1&delay=0&_=${Date.now()}`);
      (payload.msgArray || []).forEach((item) => {
        const quote = parseMisQuote(item);
        if (quote) quotes.set(quote.code, quote);
      });
    } catch {}
  }
  return quotes;
}

function mergeMisQuoteIntoHistory(history, quote) {
  if (!history || !quote?.close || !quote?.quoteDate) return history;
  const rows = Array.isArray(history.rows) ? history.rows : [];
  const date = `${quote.quoteDate.slice(0, 4)}-${quote.quoteDate.slice(4, 6)}-${quote.quoteDate.slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return history;
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const current = byDate.get(date) || {};
  byDate.set(date, {
    ...current,
    date,
    open: quote.open || current.open || quote.prevClose,
    high: Math.max(quote.high || 0, current.high || 0, quote.close),
    low: Math.min(...[quote.low, current.low, quote.close].filter((value) => value > 0)),
    close: quote.close,
    change: quote.change,
    volume: quote.volume,
    volumeUnit: "lots",
    value: quote.value,
  });
  return {
    ...history,
    market: quote.market || history.market,
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-180),
  };
}

module.exports = { fetchMisQuotes, mergeMisQuoteIntoHistory };

