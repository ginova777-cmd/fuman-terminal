"use strict";
const c = require('../data/contracts/strategy3_technical_trend_v2.json');
const finite = value => typeof value === 'number' && Number.isFinite(value);
function rsiPass(v) {
  return v?.ok === true && ['current_rsi3','previous_rsi3','current_rsi6','previous_rsi6'].every(k=>finite(v[k]))
    && v.current_rsi3 > v.current_rsi6 && v.current_rsi3 > v.previous_rsi3 && v.current_rsi6 > v.previous_rsi6;
}
function scoreBonuses(row) {
  const d=row.technical_trend_confirmation?.daily,h=row.technical_trend_confirmation?.hourly60,a=row.atr_rvol_confirmation;
  const entryReady=[row.close_price,row.entry_price,row.total_1m_volume].every(finite) && row.close_price>0 && row.entry_price>0;
  const dailyReady=d?.ok===true && ['current_k','previous_k','current_d','previous_d','current_rsi3','previous_rsi3','current_rsi6','previous_rsi6'].every(k=>finite(d[k]));
  const hourlyReady=h?.ok===true && ['current_rsi3','previous_rsi3','current_rsi6','previous_rsi6'].every(k=>finite(h[k]));
  const atrReady=a?.source_ready===true && ['atr14','tr_atr_ratio','close_location','session_rvol_5d','tail_rvol_5d'].every(k=>finite(a[k])) && a.atr14>0 && (a.comparable_history_dates||[]).length>=2;
  const group=(available,pass,points)=>({available,passed:available&&pass,status:!available?'unavailable':pass?'awarded':'not_awarded',points:available&&pass?points:0});
  return {
    entryContinuation:group(entryReady,row.close_price>=row.entry_price&&row.total_1m_volume>0,c.entryContinuationBonusPoints),
    daily:group(dailyReady,rsiPass(d)&&d.current_k>d.current_d&&d.current_k>d.previous_k&&d.current_d>d.previous_d,c.dailyBonusPoints),
    atrRvol:group(atrReady,atrReady&&a.close_location>=.75&&a.session_rvol_5d>=1.5&&a.tail_rvol_5d>=1.5&&a.tr_atr_ratio>=.8&&a.tr_atr_ratio<=2.2,c.atrRvolBonusPoints),
    hourly60:group(hourlyReady,rsiPass(h),c.hourly60BonusPoints),
  };
}
function verifyBonusRow(row) {
  const errors=[],expected=scoreBonuses(row);
  if(row.score_contract!==c.contract) errors.push('score_contract_mismatch');
  for(const [key,field]of Object.entries({entryContinuation:'entry_continuation_bonus_points',daily:'daily_bonus_points',atrRvol:'atr_rvol_bonus_points',hourly60:'hourly60_bonus_points'})) {
    if(row[field]!==expected[key].points) errors.push(field+'_mismatch');
    for(const k of ['available','passed','status','points'])if(row.bonus_evidence?.[key]?.[k]!==expected[key][k]) errors.push(key+'_'+k+'_mismatch');
  }
  if(!finite(row.base_score)||row.base_score<0||row.base_score>c.scoreCap||row.score!==Math.min(c.scoreCap,row.base_score+Object.values(expected).reduce((s,v)=>s+v.points,0))) errors.push('score_total_mismatch');
  return errors;
}
module.exports={scoreBonuses,verifyBonusRow};
