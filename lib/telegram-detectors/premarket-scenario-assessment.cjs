'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x),positive=x=>finite(x)&&x>0;
const condition=(id,value)=>({id,value:typeof value==='boolean'?value:null});
function assessment(id,checks,pending=[]){return {id,status:checks.some(c=>c.value===false)?'not_matched':checks.some(c=>c.value===null)?'insufficient_data':'matched',checks,unresolved_rules:pending,formal_eligible:false};}
function assess({previous={},trial={},cost,ranking,rankInput,foreignHistory=[],reportedForeignDays,source,dailyTrend={},comparison}){
 const o=trial.price,costReady=positive(cost),p=previous;
 const numeric=(values,fn)=>values.every(finite)?fn():null;
 const current=rankInput?.current,prior=rankInput?.previous;
 const trend=(name,up)=>{
  if(current&&prior){const c=current[name],p=prior[name];if(name==='kd')return numeric([c?.k,c?.d,p?.k,p?.d],()=>up?c.k>p.k&&c.d>p.d:c.k<p.k&&c.d<p.d);if(name==='rsi')return numeric([c?.short,c?.long,p?.short,p?.long],()=>up?c.short>p.short&&c.long>p.long:c.short<p.short&&c.long<p.long);return numeric([c?.histogram,p?.histogram],()=>up?c.histogram>p.histogram:c.histogram<p.histogram);}
  return ['up','down'].includes(dailyTrend[name])?dailyTrend[name]===(up?'up':'down'):null;
 };
 const last=foreignHistory.slice(-4),four=last.length===4&&last.every((r,i)=>finite(r.net)&&(!i||r.date>last[i-1].date))?last.every(r=>r.net<0):source==='user_provided_case'&&Number.isInteger(reportedForeignDays)?reportedForeignDays>=4:null;
 const b=assessment('B_BREAK_LOW_CONTINUATION',[condition('BEARISH_SCORE_POSITIVE',ranking?.score==null?null:ranking.score>=1),condition('TRIAL_BELOW_PREVIOUS_LOW',positive(o)&&positive(p.low)?o<p.low:null),condition('TRIAL_AT_LEAST_2_PERCENT_BELOW_COST',positive(o)&&costReady?o<=cost*.98:null)],['ADDITIONAL_VETO_RULES_PENDING']);
 const a=assessment('A_DISTRIBUTION_DIVERGENCE',[condition('CLOSE_AT_HIGH',positive(p.close)&&positive(p.high)?p.close===p.high:null),condition('KD_UP',trend('kd',true)),condition('RSI_UP',trend('rsi',true)),condition('MACD_UP',trend('macd',true)),condition('FOUR_FOREIGN_NET_SELL_RECORDS',four),condition('NEAR_COST_PLUS_3_PERCENT',positive(o)&&costReady?o>=cost*1.03*.99&&o<=cost*1.03*1.01:null)],['A_FINAL_GATE_NOT_DEFINED']);
 // Minimal measurable screen only. No invented definition of long wick or large buys.
 const upper=numeric([p.high,p.open,p.close],()=>p.high-Math.max(p.open,p.close));
 const rebound=assessment('A_UPPER_SHADOW_REBOUND_REVIEW',[condition('CLOSE_BELOW_OPEN',positive(p.open)&&positive(p.close)?p.close<p.open:null),condition('HAS_UPPER_SHADOW',upper===null?null:upper>0),condition('KD_DOWN',trend('kd',false)),condition('RSI_DOWN',trend('rsi',false)),condition('TRIAL_BELOW_PREVIOUS_CLOSE',positive(o)&&positive(p.close)?o<p.close:null),condition('TRIAL_BELOW_COST',positive(o)&&costReady?o<cost:null),condition('FIRST_NET_BUY_BRANCH_AVAILABLE',comparison?.branch?true:null)],['LONG_UPPER_SHADOW_THRESHOLD_UNDEFINED','LARGE_BRANCH_BUY_THRESHOLD_UNDEFINED','REBOUND_NEAR_COST_THRESHOLD_UNDEFINED','A_FINAL_GATE_NOT_DEFINED']);
 rebound.scope='structural_candidate_only';rebound.evidence={upper_shadow:upper,body:numeric([p.open,p.close],()=>Math.abs(p.close-p.open)),branch_buy_lots:comparison?.branch?.buy_lots??null};
 // Recognize the supplied 6168 structure without inventing an overheat/wick
 // threshold or treating a projected sell-off as a verified trading outcome.
 const extension=assessment('A_COST_EXTENSION_DISTRIBUTION_REVIEW',[
  condition('KD_UP',trend('kd',true)),condition('RSI_UP',trend('rsi',true)),condition('MACD_UP',trend('macd',true)),
  condition('HAS_UPPER_SHADOW',upper===null?null:upper>0),
  condition('CLOSE_ABOVE_COST_PLUS_5_PERCENT',positive(p.close)&&costReady?p.close>cost*1.05:null),
  condition('TRIAL_AT_OR_ABOVE_COST_PLUS_5_PERCENT',positive(o)&&costReady?o>=cost*1.05:null)
 ],['ADDITIONAL_VETO_RULES_PENDING','A_FINAL_GATE_NOT_DEFINED']);
 extension.scope='structural_candidate_only';
 extension.evidence={upper_shadow:upper,close_cost_distance:positive(p.close)&&costReady?p.close/cost-1:null,trial_cost_distance:positive(o)&&costReady?o/cost-1:null,cost_plus_5_percent:costReady?cost*1.05:null,overheat_asserted:false,selloff_verified:false};
 return [b,a,rebound,extension];
}
module.exports={assess};
