const { readFugleWebSocketQuotes, writeFugleWebSocketSymbols } = require("./fugle-websocket-quotes");

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 4);
}

function mergeQuote(stock, quote) {
  if (!quote?.close) return stock;
  const close = cleanNumber(quote.close) || cleanNumber(stock.close);
  const volume = cleanNumber(quote.tradeVolume) || cleanNumber(stock.tradeVolume);
  return {
    ...stock,
    ...quote,
    code: normalizeCode(stock.code || quote.code),
    name: quote.name || stock.name,
    close,
    tradeVolume: volume,
    value: cleanNumber(quote.value || quote.tradeValue) || (close && volume ? close * volume * 1000 : cleanNumber(stock.value)),
    quoteSource: quote.quoteSource || quote.realtimeFallback || stock.quoteSource || "fugle-ws",
    isRealtime: true,
  };
}

function overlayFugleWebSocketQuotes(rows, options = {}) {
  const codeRows = (rows || [])
    .map((row) => ({ row, code: normalizeCode(row?.code) }))
    .filter((item) => /^\d{4}$/.test(item.code));
  const codes = [...new Set(codeRows.map((item) => item.code))];
  if (!codes.length) return { rows: rows || [], used: 0, available: 0 };

  writeFugleWebSocketSymbols(codes, {
    source: options.source || "fugle-overlay",
    scanTimestamp: options.scanTimestamp || "",
  });

  const maxAgeMs = Math.max(3000, Number(options.maxAgeMs || 150 * 1000));
  const { quotes } = readFugleWebSocketQuotes({ maxAgeMs });
  let used = 0;
  const patched = (rows || []).map((row) => {
    const quote = quotes.get(normalizeCode(row?.code));
    if (!quote?.close) return row;
    used += 1;
    return mergeQuote(row, quote);
  });
  return { rows: patched, used, available: quotes.size };
}

function overlayFugleWebSocketQuoteMap(codes, options = {}) {
  const normalized = [...new Set((codes || []).map(normalizeCode).filter((code) => /^\d{4}$/.test(code)))];
  writeFugleWebSocketSymbols(normalized, {
    source: options.source || "fugle-quote-map",
    scanTimestamp: options.scanTimestamp || "",
  });
  const maxAgeMs = Math.max(3000, Number(options.maxAgeMs || 150 * 1000));
  const { quotes } = readFugleWebSocketQuotes({ maxAgeMs });
  const map = new Map();
  for (const code of normalized) {
    const quote = quotes.get(code);
    if (quote?.close) map.set(code, quote);
  }
  return { map, available: quotes.size, used: map.size };
}

module.exports = {
  mergeQuote,
  overlayFugleWebSocketQuoteMap,
  overlayFugleWebSocketQuotes,
};
