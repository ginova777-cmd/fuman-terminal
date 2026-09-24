'use strict';
// Reuse the same official daily-volume and day-trading reader as Strategy5.
const shared = require('./strategy5-ranking-bonuses');
const CONTRACT = 'institution-volume10d-prior5-2_5x-daytrade50-bonus-v1';
function calculate(input, tradeDate) {
  return {...shared.calculate(input, tradeDate), contract: CONTRACT};
}
function apply(row, input, tradeDate) {
  const rankingBonuses = calculate(input || {symbol: row.code}, tradeDate);
  return {...row, rankingBonuses, rankingBonusScore: rankingBonuses.totalPoints};
}
function compare(a, b) {
  return Number(b.rankingBonusScore || 0) - Number(a.rankingBonusScore || 0)
    || Math.abs(Number(b.total || 0)) - Math.abs(Number(a.total || 0))
    || String(a.code).localeCompare(String(b.code));
}
module.exports = {CONTRACT, calculate, apply, compare, read: shared.read};
