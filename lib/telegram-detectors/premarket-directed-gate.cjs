'use strict';
// New plan-aware entry; the live runner must supply a verified same-day plan.
// Not a provider or plan generator, and never falls back to two-direction scans.
const planContract=require('./premarket-plan-contract.cjs');
const gate=require('./level-cross-gate.cjs');
function evaluate({plan,event,bars,levelInput,now}){
 const selected=planContract.directionFor(plan,event.stock_id,{tradeDate:event.trade_date,now});
 if(!selected.direction)return {contract:gate.CONTRACT,status:'source_missing',eligible:false,reason:selected.reason,matches:[],plan_run_id:plan?.run_id||null};
 return {...gate.evaluate({event,bars,levelInput,now,requiredDirection:selected.direction}),plan_run_id:selected.plan_run_id,plan_sha256:selected.plan_sha256};
}
module.exports={evaluate};
