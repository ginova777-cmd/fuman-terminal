'use strict';
// Case recognition only: do not invent a universal near-cost/large-buy cutoff.
const ID='L_NEAR_COST_DEALER_BUY_REVIEW';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function assess({input,cost,comparison}){
 const rank=input.short_rank_input,c=rank?.current,p=rank?.previous;
 const up=name=>{if(c&&p){const pairs=name==='kd'?[[c.kd?.k,p.kd?.k],[c.kd?.d,p.kd?.d]]:name==='rsi'?[[c.rsi?.short,p.rsi?.short],[c.rsi?.long,p.rsi?.long]]:[[c.macd?.histogram,p.macd?.histogram]];return pairs.every(v=>v.every(finite))?pairs.every(([a,b])=>a>b):null;}return ['up','down'].includes(input.daily_trend?.[name])?input.daily_trend[name]==='up':null;};
 const reported=input.source==='user_provided_case';
 const dealer=finite(comparison?.institutions?.dealer?.net_shares)?comparison.institutions.dealer.net_shares:reported?input.institutions_reported?.dealer_total:null;
 const price=input.trial?.price,ready=finite(price)&&price>0&&finite(cost)&&cost>0;
 const checks=[...['kd','rsi','macd'].map(n=>({id:n.toUpperCase()+'_UP',value:up(n)})),{id:'DEALER_NET_BUY_POSITIVE',value:finite(dealer)?dealer>0:null},{id:'USER_CASE_NEAR_COST',value:ready&&reported&&typeof input.case_near_cost_reported==='boolean'?input.case_near_cost_reported:null}];
 return {id:ID,direction:'long',scope:'reported_case_only',status:checks.some(c=>c.value===false)?'not_matched':checks.some(c=>c.value===null)?'insufficient_data':'matched',checks,formal_eligible:false,unresolved_rules:['PREOPEN_NEAR_COST_TOLERANCE_UNDEFINED','LARGE_DEALER_BUY_THRESHOLD_UNDEFINED'],evidence:{cost_distance:ready?price/cost-1:null,near_cost_source:reported&&input.case_near_cost_reported===true?'user_case_description':null,large_buy_threshold_applied:false}};
}
module.exports={ID,assess};
