'use strict';
// Confirmed preopen near-cost band; large-buy qualification remains deferred.
const ID='L_NEAR_COST_DEALER_BUY_REVIEW';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const NEAR_COST_TOLERANCE=.01;
function nearCost(cost,price){
 const ready=finite(cost)&&cost>0&&finite(price)&&price>0&&finite(cost*(1+NEAR_COST_TOLERANCE));
 const lower=ready?cost*(1-NEAR_COST_TOLERANCE):null,upper=ready?cost*(1+NEAR_COST_TOLERANCE):null;
 return {relative_tolerance:NEAR_COST_TOLERANCE,lower,upper,inclusive:true,relative_distance:ready?price/cost-1:null,matched:ready?price>=lower&&price<=upper:null};
}
function assess({input,cost,comparison}){
 const rank=input.short_rank_input,c=rank?.current,p=rank?.previous;
 const up=name=>{if(c&&p){const pairs=name==='kd'?[[c.kd?.k,p.kd?.k],[c.kd?.d,p.kd?.d]]:name==='rsi'?[[c.rsi?.short,p.rsi?.short],[c.rsi?.long,p.rsi?.long]]:[[c.macd?.histogram,p.macd?.histogram]];return pairs.every(v=>v.every(finite))?pairs.every(([a,b])=>a>b):null;}return ['up','down'].includes(input.daily_trend?.[name])?input.daily_trend[name]==='up':null;};
 const reported=input.source==='user_provided_case';
 const dealer=finite(comparison?.institutions?.dealer?.net_shares)?comparison.institutions.dealer.net_shares:reported?input.institutions_reported?.dealer_total:null;
 const price=input.trial?.price,proximity=nearCost(cost,price);
 const checks=[...['kd','rsi','macd'].map(n=>({id:n.toUpperCase()+'_UP',value:up(n)})),{id:'DEALER_NET_BUY_POSITIVE',value:finite(dealer)?dealer>0:null},{id:'TRIAL_WITHIN_COST_1_PERCENT',value:proximity.matched}];
 return {id:ID,direction:'long',scope:'candidate_review_only',status:checks.some(c=>c.value===false)?'not_matched':checks.some(c=>c.value===null)?'insufficient_data':'matched',checks,formal_eligible:false,unresolved_rules:['LARGE_DEALER_BUY_THRESHOLD_UNDEFINED'],evidence:{cost_distance:proximity.relative_distance,near_cost:proximity,near_cost_source:proximity.matched===null?null:'numeric_cost_band',large_buy_threshold_applied:false}};
}
module.exports={ID,assess,nearCost,NEAR_COST_TOLERANCE};
