"use strict";
const { readTechnicalSources, timeframeEvidence } = require('./institution-technical-selection');
const { CONTRACT: INDICATOR_CONTRACT } = require('./technical-indicators');
const ranking = require('./strategy5-ranking-bonuses');
const DAILY_TABLE = process.env.STRATEGY4_DAILY_VIEW || 'stock_daily_volume';
const CONTRACT = 'strategy5-candidate90-daily-up-hourly60-bonus-v1';
function evaluate(candidates, sources, tradeDate) {
  const selected = [], missing = [], rejected = [];
  for (const row of candidates) {
    const source = sources[row.code] || {};
    const rawDaily = source.daily || [];
    const placeholders = rawDaily.filter(bar => {
      const day = new Date(String(bar.date).slice(0,10)+'T00:00:00Z').getUTCDay();
      return (day===0 || day===6) && ['open','high','low','close'].every(key=>bar[key]===null || bar[key]===undefined || bar[key]==='');
    });
    const daily = {...timeframeEvidence(rawDaily.filter(bar=>!placeholders.includes(bar)), tradeDate), source:'supabase:'+DAILY_TABLE, excludedNonTradingPlaceholders:placeholders.map(bar=>bar.date)};
    const hourly60 = timeframeEvidence(source.hourly60, tradeDate, true);
    const reasons = [];
    if (!daily.available) reasons.push('daily_' + daily.reason);
    if ((source.errors || []).some(e => String(e).startsWith('daily_fetch:'))) reasons.push('daily_fetch_incomplete');
    for (const key of ['code', 'name', 'market']) if (!row[key]) reasons.push('missing_' + key);
    if (!(Number(row.close) > 0) || !Array.isArray(row.matches) || !row.matches.length) reasons.push('base_candidate_invalid');
    if (reasons.length) { missing.push({ code: row.code, reasons }); continue; }
    if (!daily.trendUp) { rejected.push(row.code); continue; }
    const rankingBonus = source.rankingBonus ? ranking.calculate(source.rankingBonus, tradeDate) : null;
    const baseScore = Number(row.rankingBonus?.contract === ranking.CONTRACT ? row.baseScore : row.score) || 0;
    const bonusLabels = rankingBonus ? [rankingBonus.recentVolume.points ? '近期10日放量 +5' : '', rankingBonus.daytrade.points ? '官方當沖率≥50% +5' : ''].filter(Boolean) : [];
    selected.push({ ...row, ...(rankingBonus ? {baseScore, rankingBonus, score:baseScore+rankingBonus.totalPoints, reason:[row.reason||row.activeMatch?.reason||'',...bonusLabels].filter(Boolean).join('；')} : {}), technicalTrend: { contract: CONTRACT, indicatorContract: INDICATOR_CONTRACT, daily, hourly60, hourly60Bonus: Boolean(hourly60.available && hourly60.trendUp), pass: true } });
  }
  const hasRankingBonuses = candidates.some(row => sources[row.code]?.rankingBonus);
  if (hasRankingBonuses) selected.sort((a,b)=>b.score-a.score || Number(b.percent||0)-Number(a.percent||0) || Number(b.value||0)-Number(a.value||0) || String(a.code).localeCompare(String(b.code)));
  const bonusSummary = hasRankingBonuses ? {rankingBonusContract:ranking.CONTRACT,rankingBonusRole:'bonus_only',recentVolumeUnavailableCount:selected.filter(r=>r.rankingBonus?.recentVolume.status==='unavailable').length,daytradeUnavailableCount:selected.filter(r=>r.rankingBonus?.daytrade.status==='unavailable').length,recentVolumeAwardedCount:selected.filter(r=>r.rankingBonus?.recentVolume.points===5).length,daytradeAwardedCount:selected.filter(r=>r.rankingBonus?.daytrade.points===5).length} : {};
  const dataReadyCount = candidates.length - missing.length;
  const dataCoverage = candidates.length ? dataReadyCount / candidates.length : 1;
  return { selected, selectionCoverage: { ...bonusSummary, contract: CONTRACT, indicatorContract: INDICATOR_CONTRACT, minCoverage: .9, candidateCount: candidates.length, dataReadyCount, dataMissingCount: missing.length, dataCoverage, resultCount: selected.length, technicalRejectedCount: rejected.length, candidateSymbols: candidates.map(r => r.code), incompleteSymbols: missing, notBullishSymbols: rejected, ok: dataCoverage >= .9 } };
}
async function readSources(candidates, tradeDate) {
  const sources = await readTechnicalSources(candidates, tradeDate, { optionalHourly: true, dailyTable: DAILY_TABLE });
  const bonuses = await ranking.read(candidates, tradeDate);
  for (const row of candidates) sources[row.code].rankingBonus = bonuses[row.code];
  return sources;
}
module.exports = { CONTRACT, DAILY_TABLE, evaluate, readSources };
