'use strict';
// Rank raw references first. Validate only until the newest valid completed bar
// is found; an invalid newest bar must not hide an older valid bar.
function latestValidCandles(candles, { allowedSymbols, tradeDate, nowMs, mapNaturalCandle }) {
  const groups = new Map();
  for (const candle of candles) {
    const symbol = String(candle?.symbol || candle?.code || '');
    if (!allowedSymbols.has(symbol)) continue;
    const time = Date.parse(candle.candleTime || candle.date || '');
    if (!Number.isFinite(time)) continue;
    const group = groups.get(symbol) || [];
    group.push({ candle, time });
    groups.set(symbol, group);
  }
  const selected = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.time - a.time);
    for (const { candle } of group) {
      const row = mapNaturalCandle(candle, { tradeDate, nowMs, maxSeenAgeMs: Infinity });
      if (row) { selected.push(row); break; }
    }
  }
  return selected;
}
module.exports = { latestValidCandles };
