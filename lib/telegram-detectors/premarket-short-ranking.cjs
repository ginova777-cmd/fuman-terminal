'use strict';
// Ranking only. Indicator direction must come from an independently verified
// daily-indicator adapter; this module does not invent periods or qualification.
const KEYS = ['daily_kd_down','daily_rsi_down','daily_macd_down','foreign_sell','trust_sell','dealer_self_sell'];
function scoreB(evidence = {}) {
  const items = KEYS.map(key => ({key, matched: typeof evidence[key] === 'boolean' ? evidence[key] : null}));
  const missing = items.filter(x => x.matched === null).map(x => x.key);
  const matched = items.filter(x => x.matched === true).map(x => x.key);
  return {contract:'longyue_b_ranking_v1', status:missing.length ? 'incomplete' : 'complete', score:missing.length ? null : matched.length, max_score:6, matched, missing, items};
}
function rankBRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError('B rows must be an array');
  const ids = new Set();
  for (const row of rows) {
    if (!/^\d{4}$/.test(row.stock_id) || ids.has(row.stock_id)) throw new Error('INVALID_OR_DUPLICATE_SYMBOL');
    ids.add(row.stock_id);
  }
  // Caller supplies B candidates. A has separate, as-yet unconfirmed criteria.
  // Never set direction_qualified, preopen_action, or data_complete from score.
  const scored = rows.map(row => ({...row, short_ranking:scoreB(row.short_rank_evidence)}));
  scored.sort((a,b) => (b.short_ranking.score ?? -1) - (a.short_ranking.score ?? -1) || a.stock_id.localeCompare(b.stock_id));
  let lastScore, rank;
  return scored.map((row,index) => {
    const score = row.short_ranking.score;
    if (score !== lastScore) {rank = index + 1; lastScore = score;}
    return {...row, short_ranking:{...row.short_ranking, rank:score === null ? null : rank}};
  });
}
module.exports = {KEYS, scoreB, rankBRows};
