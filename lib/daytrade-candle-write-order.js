'use strict';
// Input is already quality-validated. Reorder only: never drop seed/history rows.
function latestFirst(rows) {
  const latest = new Map();
  for (const row of rows) {
    const prior = latest.get(row.symbol);
    if (!prior || Date.parse(row.candle_time) > Date.parse(prior.candle_time)) latest.set(row.symbol, row);
  }
  return [...rows].sort((a, b) => {
    const priority = Number(latest.get(b.symbol) === b) - Number(latest.get(a.symbol) === a);
    return priority || Date.parse(b.candle_time) - Date.parse(a.candle_time) || a.symbol.localeCompare(b.symbol);
  });
}
module.exports = { latestFirst };
