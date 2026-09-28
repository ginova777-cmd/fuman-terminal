'use strict';
// Pure contract checks. No provider calls, notification, order, or runtime writes.
const crypto=require('crypto');
const {rankBRows}=require('./premarket-short-ranking.cjs');
const {buildShortRows}=require('./premarket-short-decision.cjs');
const {reviewCase}=require('./premarket-scenario-workflow.cjs');
const CONTRACT='telegram_premarket_plan_v1';
const {costTopBuyer}=require('./main-broker-cost.cjs');
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
 const observation=plan?.purpose==='intraday_observation';
 const c=plan?.coverage;
 if(observation){
  check(c?.scope==='captured_source_symbols'&&c.total>0&&c.total===plan.rows?.length&&c.evaluated===c.total&&c.symbols_sha256===digest((plan.rows||[]).map(r=>r.stock_id).sort())&&c.full_market_verified===false,'PLAN_OBSERVATION_COVERAGE_FAILED');
  check(plan.notifications_enabled===false&&plan.order_rules_complete===false&&Array.isArray(plan.order_unresolved_rules),'PLAN_OBSERVATION_ORDER_BOUNDARY_FAILED');
 }else check(c?.twse>=900&&c?.tpex>=700&&c?.total>=1700&&c.total===c.twse+c.tpex,'PLAN_UNIVERSE_COVERAGE_FAILED');
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
  if(observation){
   check(r.preopen_action==='NO_TRADE'&&r.order_allowed===false,'PLAN_OBSERVATION_CANNOT_ORDER');
   if(r.intraday_direction!=='none'){
    const allowed=['B_BREAK_LOW_CONTINUATION','A_DISTRIBUTION_DIVERGENCE'];
    const shortProven=r.observation_rule_ids?.some(id=>allowed.includes(id)&&r.scenario_assessments?.some(s=>s.id===id&&s.status==='matched'));
    const l=r.long_table_rule,longId=require('./premarket-long-table.cjs').ID;
    const longProven=l?.id===longId&&l.status==='matched'&&l.base_date===plan.base_date&&r.observation_rule_ids?.includes(longId)&&r.scenario_assessments?.some(s=>s.id===longId&&digest(s)===digest(l))&&Object.keys(l.checks||{}).length===4&&Object.values(l.checks).every(x=>x===true)&&Object.values(l.signals||{}).filter(x=>x===true).length>=2&&l.foreign_history?.length===3&&l.foreign_history.every((x,i)=>typeof x.net==='number'&&Number.isFinite(x.net)&&x.net>0&&(i===0||x.date>l.foreign_history[i-1].date))&&l.foreign_history.at(-1).date===plan.base_date&&l.trial_price===r.trial?.price&&l.cost===r.cost?.value&&l.trial_price<l.cost&&l.trial_price<l.previous_close&&l.target===l.cost*1.03;
    check(r.trial?.verified===true&&r.cost?.valid===true&&r.trial_price_levels?.trial_derived_complete===true&&((r.intraday_direction==='short'&&shortProven&&!longProven)||(r.intraday_direction==='long'&&longProven&&!shortProven)),'PLAN_OBSERVATION_RULE_NOT_PROVEN');
    if(r.intraday_direction==='long')check(r.preopen_recommendation==='LIMIT_UP_LONG'&&r.recommendation_only===true&&r.recommendation_target===l?.target,'PLAN_LONG_RECOMMENDATION_INVALID');
   }
   if(r.preopen_recommendation==='LIMIT_UP_LONG')check(r.intraday_direction==='long','PLAN_LONG_RECOMMENDATION_DIRECTION_CONFLICT');
  }
 }
 return {complete:failures.length===0,status:failures.length?'blocked':'complete',failed_checks:[...new Set(failures)],first_blocker:failures[0]||null};
}
function directionFor(plan,symbol,context){
 const result=validate(plan,context);if(!result.complete)return {direction:null,reason:result.first_blocker};
 const row=plan.rows.find(r=>r.stock_id===symbol);
 if(!row||row.intraday_direction==='none')return {direction:null,reason:'NOT_IN_DIRECTION_PLAN'};
 return {direction:row.intraday_direction,plan_run_id:plan.run_id,plan_sha256:digest(plan),scenario:row.scenario,preopen_action:row.preopen_action};
}
module.exports={CONTRACT,costTopBuyer,digest,validate,directionFor,rankBRows,buildShortRows,reviewCase};
