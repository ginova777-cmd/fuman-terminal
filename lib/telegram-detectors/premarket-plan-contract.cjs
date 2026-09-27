'use strict';
// Pure contract checks. No provider calls, notification, order, or runtime writes.
const crypto=require('crypto');
const {rankBRows}=require('./premarket-short-ranking.cjs');
const {buildShortRows}=require('./premarket-short-decision.cjs');
const {reviewCase}=require('./premarket-scenario-workflow.cjs');
const CONTRACT='telegram_premarket_plan_v1';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function costTop15({rows,symbol,baseDate}){
 const failed=[],brokers=new Map();
 if(!/^\d{4}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)||!Array.isArray(rows)||!rows.length)return {valid:false,value:null,failed_checks:['BRANCH_SOURCE_MISSING']};
 for(const r of rows){
  if(r.stock_id!==symbol||r.date!==baseDate||!r.securities_trader_id||!finite(r.price)||r.price<=0||!finite(r.buy)||r.buy<0||!finite(r.sell)||r.sell<0){failed.push('BRANCH_ROW_INVALID');continue;}
  const id=String(r.securities_trader_id),p=brokers.get(id)||{id,buy:0,sell:0,buyAmount:0};
  p.buy+=r.buy;p.sell+=r.sell;p.buyAmount+=r.price*r.buy;brokers.set(id,p);
 }
 if(failed.length)return {valid:false,value:null,failed_checks:[...new Set(failed)]};
 const selected=[...brokers.values()].filter(p=>p.buy>p.sell).sort((a,b)=>(b.buy-b.sell)-(a.buy-a.sell)||a.id.localeCompare(b.id)).slice(0,15).map(p=>({id:p.id,netBuy:p.buy-p.sell,buyVolume:p.buy,buyAmount:p.buyAmount,buyCost:p.buyAmount/p.buy}));
 const net=selected.reduce((n,p)=>n+p.netBuy,0),value=net?selected.reduce((n,p)=>n+p.buyCost*p.netBuy,0)/net:null;
 return {valid:finite(value)&&value>0,value,method:'top15_net_buy_weighted_buy_vwap',selected,failed_checks:value===null?['NO_POSITIVE_NET_BUY_BRANCH']:[]};
}
function canonical(v){return Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
const digest=p=>crypto.createHash('sha256').update(canonical(p)).digest('hex');
function validate(plan,{tradeDate,now}){
 const failures=[],check=(ok,key)=>{if(!ok)failures.push(key);};
 const end=Date.parse(now),frozen=Date.parse(plan?.frozen_at),stamp=Number.isFinite(frozen)?new Date(frozen+28800000).toISOString():'';
 check(plan?.contract===CONTRACT,'PLAN_CONTRACT_MISMATCH');
 check(plan?.trade_date===tradeDate&&/^\d{4}-\d{2}-\d{2}$/.test(tradeDate),'PLAN_TRADE_DATE_MISMATCH');
 check(/^\d{4}-\d{2}-\d{2}$/.test(plan?.base_date||'')&&plan.base_date<tradeDate&&plan?.calendar_verified===true,'PLAN_CALENDAR_NOT_VERIFIED');
 check(plan?.complete===true&&plan?.status==='complete'&&plan?.mode==='live'&&plan?.source_verified===true,'PLAN_NOT_COMPLETE');
 check(typeof plan?.run_id==='string'&&plan.run_id.length>0&&typeof plan?.source_run_id==='string'&&plan.source_run_id.length>0,'PLAN_RUN_ID_MISSING');
 check(Number.isFinite(end)&&new Date(end+28800000).toISOString().slice(0,10)===tradeDate&&frozen<=end&&stamp.slice(0,10)===tradeDate&&stamp.slice(11,16)==='08:59','PLAN_NOT_FROZEN_AT_0859');
 const c=plan?.coverage;check(c?.twse>=900&&c?.tpex>=700&&c?.total>=1700&&c.total===c.twse+c.tpex,'PLAN_UNIVERSE_COVERAGE_FAILED');
 check(plan?.rules_complete===true&&Array.isArray(plan?.unresolved_rules)&&plan.unresolved_rules.length===0,'PLAN_RULES_UNRESOLVED');
 const rows=Array.isArray(plan?.rows)?plan.rows:[];
 check(Array.isArray(plan?.rows)&&plan?.rows_sha256===digest(rows),'PLAN_ROWS_HASH_MISMATCH');
 check(new Set(rows.map(r=>r.stock_id)).size===rows.length,'PLAN_DUPLICATE_SYMBOL');
 for(const r of rows){
  check(/^\d{4}$/.test(r.stock_id),'PLAN_INVALID_SYMBOL');
  check(['LIMIT_UP_LONG','LIMIT_DOWN_SHORT','NO_TRADE'].includes(r.preopen_action),'PLAN_INVALID_PREOPEN_ACTION');
  check(['long','short','none'].includes(r.intraday_direction),'PLAN_INVALID_DIRECTION');
  check(typeof r.scenario==='string'&&r.scenario.length>0&&Array.isArray(r.reasons),'PLAN_SCENARIO_OR_REASON_MISSING');
  check(r.preopen_action!=='LIMIT_UP_LONG'||r.intraday_direction==='long','PLAN_LONG_DIRECTION_CONFLICT');
  check(r.preopen_action!=='LIMIT_DOWN_SHORT'||r.intraday_direction==='short','PLAN_SHORT_DIRECTION_CONFLICT');
  if(r.intraday_direction!=='none')check(r.direction_qualified===true&&r.data_complete===true,'PLAN_DIRECTION_NOT_QUALIFIED');
 }
 return {complete:failures.length===0,status:failures.length?'blocked':'complete',failed_checks:[...new Set(failures)],first_blocker:failures[0]||null};
}
function directionFor(plan,symbol,context){
 const result=validate(plan,context);if(!result.complete)return {direction:null,reason:result.first_blocker};
 const row=plan.rows.find(r=>r.stock_id===symbol);
 if(!row||row.intraday_direction==='none')return {direction:null,reason:'NOT_IN_DIRECTION_PLAN'};
 return {direction:row.intraday_direction,plan_run_id:plan.run_id,plan_sha256:digest(plan),scenario:row.scenario,preopen_action:row.preopen_action};
}
module.exports={CONTRACT,costTop15,digest,validate,directionFor,rankBRows,buildShortRows,reviewCase};
