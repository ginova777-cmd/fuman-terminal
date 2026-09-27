'use strict';
const {rankBRows}=require('./premarket-short-ranking.cjs');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
// Historical inputs must already be adjusted consistently and source-verified.
// A gap is the non-overlapping high/low interval; partial fills shrink it.
function historicalSupports({bars,baseDate,trialPrice}={}) {
 const fail=reason=>({complete:false,reason,levels:[],nearest:null,downside_space:null});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(baseDate||'')||!Array.isArray(bars)||bars.length<5||!finite(trialPrice)||trialPrice<=0)return fail('SUPPORT_INPUT_MISSING');
 const history=bars.filter(b=>typeof b?.date==='string'&&b.date<=baseDate);
 if(history.length<5||history.at(-1)?.date!==baseDate)return fail('SUPPORT_HISTORY_INCOMPLETE');
 for(let i=0;i<history.length;i++){
  const b=history[i];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||b.completed!==true||![b.high,b.low].every(finite)||b.low<=0||b.high<b.low||(i&&history[i-1].date>=b.date))return fail('SUPPORT_HISTORY_INVALID');
 }
 const levels=[];
 for(let i=2;i<history.length-2;i++){
  const b=history[i];
  if([i-2,i-1,i+1,i+2].every(j=>b.low<history[j].low)){
   // A subsequently broken low is no longer standing support.
   if(!history.slice(i+3).some(x=>x.low<b.low)&&b.low<trialPrice)levels.push({kind:'swing_low',price:b.low,origin_date:b.date,confirmed_date:history[i+2].date});
  }
 }
 for(let i=1;i<history.length;i++){
  const lower=history[i-1].high,upper=history[i].low;
  if(upper<=lower)continue;
  const remainingUpper=Math.min(upper,...history.slice(i+1).map(b=>b.low));
  if(remainingUpper>lower){
   // If the trial is inside the gap it is already touching a support zone.
   if(trialPrice>lower)levels.push({kind:'unfilled_up_gap',price:Math.min(trialPrice,remainingUpper),lower,upper:remainingUpper,origin_date:history[i].date,confirmed_date:history[i].date});
  }
 }
 levels.sort((a,b)=>b.price-a.price||a.origin_date.localeCompare(b.origin_date));
 const nearest=levels[0]||null;
 return {complete:!!nearest,reason:nearest?null:'NO_VERIFIED_SUPPORT_BELOW',levels,nearest,downside_space:nearest?(trialPrice-nearest.price)/trialPrice:null};
}
function evaluateShort(input={}) {
 const {trial,tradeDate,baseDate,previousLow,planCost,shortQualified,b1,otherVeto,dataComplete,historyVerified,bars}=input;
 const reasons=[];
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(baseDate||'')||baseDate>=tradeDate)reasons.push('DECISION_DATE_INVALID');
 const stamp=typeof trial?.timestamp==='string'?trial.timestamp:'';
 const ms=Date.parse(stamp),local=Number.isFinite(ms)?new Date(ms+28800000).toISOString():'';
 const trialValid=trial?.verified===true&&finite(trial.price)&&trial.price>0&&local.slice(0,10)===tradeDate&&local.slice(11,16)==='08:59';
 if(!trialValid)reasons.push('VALID_0859_TRIAL_REQUIRED');
 if(dataComplete!==true||historyVerified!==true)reasons.push('REQUIRED_DATA_UNVERIFIED');
 if(shortQualified!==true)reasons.push('SHORT_QUALIFICATION_UNCONFIRMED');
 if(typeof b1!=='boolean'||typeof otherVeto!=='boolean')reasons.push('VETO_RULES_UNCONFIRMED');
 if(otherVeto===true)reasons.push('OTHER_SHORT_VETO');
 if(!finite(previousLow)||previousLow<=0||!finite(planCost)||planCost<=0)reasons.push('PRICE_REFERENCE_MISSING');
 const support=historicalSupports({bars,baseDate,trialPrice:trialValid?trial.price:null});
 if(!support.complete)reasons.push(support.reason);
 else if(support.nearest.price>trial.price*0.98)reasons.push('DOWNSIDE_SPACE_BELOW_2_PERCENT');
 const exception=trialValid&&shortQualified===true&&finite(previousLow)&&previousLow>0&&finite(planCost)&&planCost>0&&trial.price<previousLow&&trial.price<=planCost*0.98;
 if(!exception)reasons.push('BREAK_LOW_COST_EXCEPTION_NOT_MET');
 return {contract:'longyue_break_low_short_v1',scope:'confirmed_break_low_scenario_only',preopen_action:reasons.length?'NO_TRADE':'LIMIT_DOWN_SHORT',intraday_direction:shortQualified===true?'short':'none',exception_met:exception,b1_restriction_lifted:b1===true&&exception,support,observation_target:trialValid?trial.price*0.98:null,observation_target_basis:'0859_trial_price',reasons,eligible:reasons.length===0};
}
function buildShortRows(rows){
 return rankBRows(rows).map(row=>{
  const decision=evaluateShort(row.short_decision_input);
  if(row.short_ranking.status!=='complete'){
   decision.reasons.push('SHORT_RANKING_INCOMPLETE');decision.eligible=false;decision.preopen_action='NO_TRADE';
  }
  return {...row,short_decision:decision,preopen_action:decision.preopen_action,intraday_direction:decision.intraday_direction};
 });
}
module.exports={historicalSupports,evaluateShort,buildShortRows};
