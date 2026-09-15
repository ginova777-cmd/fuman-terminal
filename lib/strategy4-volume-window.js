"use strict";
const CONTRACT = "strategy4-volume-five-trading-dates-v1";
function evaluateVolumeWindow(rows, dates) {
  if (!Array.isArray(dates) || dates.length !== 5 || new Set(dates).size !== 5) throw new Error("invalid_volume_trading_dates");
  const evidence = [], issues = [];
  for (const date of dates) {
    const matches = (rows || []).filter(r => String(r.trade_date || r.date).slice(0,10) === date);
    if (matches.length !== 1) { issues.push(`${matches.length ? "duplicate" : "missing"}_date:${date}`); continue; }
    const r = matches[0];
    const numeric = v => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
    const shares = r.volume_shares, rawLots = r.volume_lots;
    const lots = numeric(rawLots) ? Number(rawLots) : numeric(shares) ? Number(shares)/1000 : null;
    if (lots === null || (numeric(shares) && Math.abs(Number(shares)-lots*1000)>1)) { issues.push(`invalid_volume:${date}`); continue; }
    evidence.push({date,volume_lots:lots,volume_shares:numeric(shares)?Number(shares):lots*1000});
  }
  return {ok:issues.length===0,avgVolume5:issues.length?null:Number((evidence.reduce((s,r)=>s+r.volume_lots,0)/5).toFixed(2)),rows:evidence,issues};
}
async function recentTradingDates(targetDate, stateDir) {
  const {isTwseTradingDay}=require("../scripts/twse-trading-day");
  const dates=[];
  for(let offset=0;offset<45 && dates.length<5;offset++){
    const time=new Date(targetDate+"T12:00:00+08:00");time.setUTCDate(time.getUTCDate()-offset);
    const result=await isTwseTradingDay(time,{stateDir});
    if(result.error || result.reason==="weekday_fallback")throw new Error("volume_calendar_unverified");
    if(result.isTradingDay)dates.unshift(result.date);
  }
  if(dates.length!==5 || dates.at(-1)!==targetDate)throw new Error("volume_target_not_trading_date");
  return dates;
}
function verifyVolumeEvidence(filter, targetDate) {
  const issues=[];
  if(filter?.contract!==CONTRACT || filter?.expectedDates?.at(-1)!==targetDate)return ["strategy4_volume_window_contract_missing_or_stale"];
  const evaluations=filter.evaluations||[], seen=new Set();
  const excluded=new Map((filter.filtered||[]).map(r=>[r.code,r]));
  const missing=new Set((filter.missing||[]).map(r=>r.code));
  for(const e of evaluations){
    if(seen.has(e.code))issues.push("duplicate_volume_symbol:"+e.code);seen.add(e.code);
    const calc=evaluateVolumeWindow(e.rows,filter.expectedDates);
    if(calc.ok!==e.ok || calc.avgVolume5!==e.avgVolume5)issues.push("invalid_volume_evidence:"+e.code);
    if(!calc.ok){if(!missing.has(e.code)||excluded.has(e.code))issues.push("volume_gap_misclassified:"+e.code);}
    else if(missing.has(e.code)||excluded.has(e.code)!==(calc.avgVolume5<filter.minAvgVolume5)|| (excluded.has(e.code)&&excluded.get(e.code).avgVolume5!==calc.avgVolume5))issues.push("volume_filter_mismatch:"+e.code);
  }
  if([...excluded.keys(),...missing].some(c=>!seen.has(c)))issues.push("volume_partition_evidence_missing");
  if(evaluations.length!==filter.expectedTotal)issues.push("volume_universe_evidence_incomplete");
  return issues;
}
module.exports={CONTRACT,evaluateVolumeWindow,recentTradingDates,verifyVolumeEvidence};
