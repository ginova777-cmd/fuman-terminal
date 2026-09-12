"use strict";
const { readTechnicalSources, timeframeEvidence } = require('./institution-technical-selection');
const { CONTRACT: INDICATOR_CONTRACT } = require('./technical-indicators');
const CONTRACT = 'strategy5-candidate90-daily-up-hourly60-bonus-v1';
function evaluate(candidates, sources, tradeDate) {
  const selected = [], missing = [], rejected = [];
  for (const row of candidates) {
    const source = sources[row.code] || {};
    const daily = timeframeEvidence(source.daily, tradeDate);
    const hourly60 = timeframeEvidence(source.hourly60, tradeDate, true);
    const reasons = [];
    if (!daily.available) reasons.push('daily_' + daily.reason);
    if ((source.errors || []).some(e => String(e).startsWith('daily_fetch:'))) reasons.push('daily_fetch_incomplete');
    for (const key of ['code', 'name', 'market']) if (!row[key]) reasons.push('missing_' + key);
    if (!(Number(row.close) > 0) || !Array.isArray(row.matches) || !row.matches.length) reasons.push('base_candidate_invalid');
    if (reasons.length) { missing.push({ code: row.code, reasons }); continue; }
    if (!daily.trendUp) { rejected.push(row.code); continue; }
    selected.push({ ...row, technicalTrend: { contract: CONTRACT, indicatorContract: INDICATOR_CONTRACT, daily, hourly60, hourly60Bonus: Boolean(hourly60.available && hourly60.trendUp), pass: true } });
  }
  const dataReadyCount = candidates.length - missing.length;
  const dataCoverage = candidates.length ? dataReadyCount / candidates.length : 1;
  return { selected, selectionCoverage: { contract: CONTRACT, indicatorContract: INDICATOR_CONTRACT, minCoverage: .9, candidateCount: candidates.length, dataReadyCount, dataMissingCount: missing.length, dataCoverage, resultCount: selected.length, technicalRejectedCount: rejected.length, candidateSymbols: candidates.map(r => r.code), incompleteSymbols: missing, notBullishSymbols: rejected, ok: dataCoverage >= .9 } };
}
async function readSources(candidates, tradeDate) {
  return readTechnicalSources(candidates, tradeDate, { optionalHourly: true });
}
module.exports = { CONTRACT, evaluate, readSources };
