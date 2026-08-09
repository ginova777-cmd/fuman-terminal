const fs = require("fs");

const file = "C:\\fuman-terminal\\scripts\\run-daytrade-source-writer.js";
let source = fs.readFileSync(file, "utf8");

const start = source.indexOf("function mergeWebSocketQuoteCache(quoteMap) {");
const endMarker = "\n}\n\nfunction firstNumber";
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("mergeWebSocketQuoteCache block not found");

const replacement = `function mergeWebSocketQuoteCache(quoteMap) {
  const cache = readFugleWebSocketQuotes({ maxAgeMs: WINDOW_SECONDS * 1000 });
  const numeric = (value, fallback, positiveOnly = false) => {
    const parsed = numberValue(value, NaN);
    if (Number.isFinite(parsed) && (!positiveOnly || parsed > 0)) return parsed;
    const previous = numberValue(fallback, NaN);
    return Number.isFinite(previous) ? previous : 0;
  };
  const currentValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
  for (const [code, row] of cache.quotes.entries()) {
    const symbol = normalizeCode(code || row.code || row.symbol);
    if (!symbol) continue;
    if (isFinMindDiagnosticQuote(row)) continue;
    const previous = quoteMap.get(symbol) || {};
    const seenAt = row.quoteSeenAt || row.updatedAt || cache.payload?.updatedAt || previous.quote_seen_at || nowIso();
    const changePercentValue = currentValue(row.changePercent, row.change_percent, row.percent);
    const merged = {
      ...previous,
      symbol,
      market: row.market || previous.market || "",
      quote_seen_at: seenAt,
      updated_at: seenAt || previous.updated_at || "",
      last_trade_time: row.lastTradeTime || row.quoteTime || row.time || previous.last_trade_time || seenAt,
      price: numeric(row.close ?? row.price, previous.price, true),
      open_price: numeric(row.open ?? row.openPrice, previous.open_price, true),
      high_price: numeric(row.high ?? row.highPrice, previous.high_price, true),
      low_price: numeric(row.low ?? row.lowPrice, previous.low_price, true),
      previous_close: numeric(row.previousClose ?? row.previous_close ?? row.referencePrice, previous.previous_close, true),
      change_percent: numeric(changePercentValue, previous.change_percent),
      total_volume: numeric(row.tradeVolume ?? row.total_volume, previous.total_volume, true),
      trade_value: numeric(row.tradeValue ?? row.trade_value, previous.trade_value, true),
      bid_price: numeric(row.bidPrice ?? row.bid_price, previous.bid_price, true),
      ask_price: numeric(row.askPrice ?? row.ask_price, previous.ask_price, true),
      bid_volume: numeric(row.bidVolume ?? row.bid_volume, previous.bid_volume),
      ask_volume: numeric(row.askVolume ?? row.ask_volume, previous.ask_volume),
      cumulative_bid_volume: numeric(row.cumulativeBidVolume ?? row.cumulative_bid_volume, previous.cumulative_bid_volume),
      cumulative_ask_volume: numeric(row.cumulativeAskVolume ?? row.cumulative_ask_volume, previous.cumulative_ask_volume),
      cumulative_bid_ask_volume: numeric(row.cumulativeBidAskVolume ?? row.cumulative_bid_ask_volume, previous.cumulative_bid_ask_volume),
      limit_up_price: numeric(row.limitUpPrice ?? row.limit_up_price, previous.limit_up_price, true),
      limit_down_price: numeric(row.limitDownPrice ?? row.limit_down_price, previous.limit_down_price, true),
      payload: {
        ...(previous.payload || {}),
        ...(row.payload || {}),
        source: "fugle-websocket-cache",
        quoteSource: row.quoteSource || row.closeSource || "fugle-ws",
        cacheUpdatedAt: cache.payload?.updatedAt || "",
      },
    };
    quoteMap.set(symbol, merged);
  }
}`;

source = source.slice(0, start) + replacement + source.slice(end + 2);
fs.writeFileSync(file, source);
console.log(JSON.stringify({ ok: true, file, change: "websocket_merge_preserve_existing_quote_fields" }));
