'use strict';
// Ranking only. Indicator direction must come from an independently verified
// daily-indicator adapter; this module does not invent periods or qualification.
const KEYS = ['daily_kd_down','daily_kd_bearish','daily_kd_death_cross','daily_rsi_down','daily_rsi_bearish','daily_rsi_death_cross','daily_macd_down','daily_macd_bearish','daily_macd_death_cross','foreign_sell','trust_sell','dealer_self_sell'];
const finite = x => typeof x === 'number' && Number.isFinite(x);
// Pure adapter for completed daily indicators. Source/calendar verification is
// still the producer's responsibility; never substitute intraday indicator data.
function buildBEvidence({current, previous, institutions, baseDate, previousDate} = {}) {
  const evidence = Object.fromEntries(KEYS.map(key => [key, null]));
  const validDay = (day,date) => day?.date === date && day?.completed === true && day?.timeframe === '1d';
  const datesValid = /^\d{4}-\d{2}-\d{2}$/.test(baseDate || '') && /^\d{4}-\d{2}-\d{2}$/.test(previousDate || '') && previousDate < baseDate;
  const parameters = {kd:[5,3,3],rsi:[5,15],macd:[5,9,20]};
  if (datesValid && validDay(current,baseDate) && validDay(previous,previousDate)) {
    for (const [name,params] of Object.entries(parameters)) {
      const c=current[name], p=previous[name];
      if (JSON.stringify(c?.params)!==JSON.stringify(params) || JSON.stringify(p?.params)!==JSON.stringify(params)) continue;
      const fields = name==='kd' ? ['k','d'] : name==='rsi' ? ['short','long'] : ['dif','signal'];
      const [a,b]=fields;
      if (finite(c[a]) && finite(c[b])) evidence[`daily_${name}_bearish`]=c[a]<c[b];
      if ([c[a],c[b],p[a],p[b]].every(finite)) {
        evidence[`daily_${name}_death_cross`]=p[a]>=p[b] && c[a]<c[b];
        if (name!=='macd') evidence[`daily_${name}_down`]=c[a]<p[a] && c[b]<p[b];
      }
      if (name==='macd' && finite(c.histogram) && finite(p.histogram)) evidence.daily_macd_down=c.histogram<p.histogram;
    }
  }
  if (datesValid && institutions?.date===baseDate) {
    for (const name of ['foreign','trust','dealer_self']) {
      const net=institutions[`${name}_net`];
      if (finite(net)) evidence[`${name}_sell`]=net<0;
    }
  }
  return evidence;
}
function scoreB(evidence = {}) {
  const items = KEYS.map(key => ({key, matched: typeof evidence?.[key] === 'boolean' ? evidence[key] : null}));
  const missing = items.filter(x => x.matched === null).map(x => x.key);
  const matched = items.filter(x => x.matched === true).map(x => x.key);
  return {contract:'longyue_b_ranking_v2', status:missing.length ? 'incomplete' : 'complete', score:missing.length ? null : matched.length, max_score:12, matched, missing, items};
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
  const scored = rows.map(row => ({...row, short_ranking:scoreB(row.short_rank_input ? buildBEvidence(row.short_rank_input) : row.short_rank_evidence)}));
  scored.sort((a,b) => (b.short_ranking.score ?? -1) - (a.short_ranking.score ?? -1) || a.stock_id.localeCompare(b.stock_id));
  let lastScore, rank;
  return scored.map((row,index) => {
    const score = row.short_ranking.score;
    if (score !== lastScore) {rank = index + 1; lastScore = score;}
    return {...row, short_ranking:{...row.short_ranking, rank:score === null ? null : rank}};
  });
}
module.exports = {KEYS, buildBEvidence, scoreB, rankBRows};
