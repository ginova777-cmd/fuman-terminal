'use strict';
const crypto=require('node:crypto');
const {CONTRACT,digest,validate}=require('./premarket-plan-contract.cjs');
const {runValidation}=require('./premarket-validation-flow.cjs');
// Produce the exact consumer contract. Deferred rules remain explicit blockers;
// neither a historical replay nor a user-provided case can grant live eligibility.
function build({snapshot,trialRows,calendar,universe,tradeDate,baseDate,now,mode='replay'}){
 if(!['live','replay'].includes(mode))throw Error('INVALID_PLAN_MODE');
 const stamp=Date.parse(now);if(!Number.isFinite(stamp))throw Error('INVALID_PLAN_CLOCK');
 const local=new Date(stamp+28800000).toISOString();
 const frozen=local.slice(0,10)===tradeDate&&local.slice(11,16)==='08:59';
 const audit=runValidation({snapshot,trialRows,calendar,tradeDate,baseDate,asOf:now});
 const members=Array.isArray(universe?.rows)?universe.rows:[];
 const universeValid=universe?.verified===true&&universe.trade_date===tradeDate&&typeof universe.source==='string'&&members.length>0&&new Set(members.map(r=>r.symbol)).size===members.length&&members.every(r=>/^\d{4}$/.test(r.symbol)&&['TWSE','TPEX'].includes(r.market));
 const sourceSymbols=new Set(audit.rows.map(r=>r.stock_id));
 const coverageValid=universeValid&&members.length===sourceSymbols.size&&members.every(r=>sourceSymbols.has(r.symbol));
 const coverage={twse:universeValid?members.filter(r=>r.market==='TWSE').length:0,tpex:universeValid?members.filter(r=>r.market==='TPEX').length:0,total:universeValid?members.length:0,evaluated:audit.rows.length,universe_verified:coverageValid};
 const unresolved=['ADDITIONAL_VETO_RULES_PENDING','A_FINAL_GATE_NOT_DEFINED','LONG_UPPER_SHADOW_THRESHOLD_UNDEFINED','LARGE_BRANCH_BUY_THRESHOLD_UNDEFINED','REBOUND_NEAR_COST_THRESHOLD_UNDEFINED'];
 const rows=audit.rows.map(r=>({stock_id:r.stock_id,scenario:r.scenario_assessments.filter(s=>s.status==='matched').map(s=>s.id).join('|')||'NO_CONFIRMED_SCENARIO',scenario_assessments:r.scenario_assessments,broker_comparison:r.broker_comparison,preopen_action:'NO_TRADE',intraday_direction:'none',direction_candidate:r.direction_candidate,direction_qualified:false,data_complete:r.trial.verified===true&&r.provenance.calendar.complete===true&&r.cost?.valid===true,reasons:r.blockers,trial:r.trial,cost:r.cost,references:r.references,historical_support:r.support,base_date:baseDate}));
 const failures=[...(!frozen?['NOT_NATURAL_0859_FREEZE']:[]),...(!coverageValid?['AUTHORITATIVE_UNIVERSE_NOT_VERIFIED']:[]),...unresolved];
 const plan={contract:CONTRACT,run_id:'premarket-plan-'+crypto.randomUUID(),source_run_id:audit.run_id,source_sha256:audit.source_sha256,trade_date:tradeDate,base_date:baseDate,mode,created_at:now,frozen_at:frozen?now:null,calendar_verified:audit.rows.length>0&&audit.rows.every(r=>r.provenance.calendar.complete),source_verified:false,coverage,rules_complete:false,unresolved_rules:unresolved,rows,rows_sha256:digest(rows),status:'blocked',complete:false,notifications_enabled:false,blocking_reasons:failures,notification_status:'paused_by_user'};
 // Observation qualification uses only confirmed A/B conditions. Deferred
 // order vetoes do not change the fixed observation direction into an order.
 plan.purpose='intraday_observation';
 plan.order_rules_complete=false;
 plan.order_unresolved_rules=unresolved;
 plan.rules_complete=true;
 plan.unresolved_rules=[];
 plan.coverage={scope:'captured_source_symbols',total:rows.length,evaluated:rows.length,symbols_sha256:digest(rows.map(r=>r.stock_id).sort()),full_market_verified:false};
 for(const r of rows){
  const a=audit.rows.find(a=>a.stock_id===r.stock_id);
  r.intraday_direction=a.direction_candidate;
  r.direction_qualified=r.intraday_direction!=='none';
  r.data_complete=r.direction_qualified;
  r.order_allowed=false;
  r.preopen_recommendation=a.preopen_recommendation;
  r.recommendation_only=true;
  r.recommendation_target=a.recommendation_target;
  r.long_table_rule=a.long_table_rule;
  r.trial_price_levels=a.trial_price_levels;
  r.observation_rule_ids=a.scenario_assessments.filter(s=>s.status==='matched'&&s.id!=='A_UPPER_SHADOW_REBOUND_REVIEW').map(s=>s.id);
 }
 plan.rows_sha256=digest(rows);
 plan.source_verified=rows.some(r=>r.trial?.verified===true)&&snapshot.symbols.every(s=>s.trade_date===tradeDate&&s.signal_date===baseDate&&Number.isFinite(Date.parse(s.fetched_at))&&Date.parse(s.fetched_at)<=stamp);
 plan.blocking_reasons=[...(!frozen?['NOT_NATURAL_0859_FREEZE']:[]),...(!plan.source_verified?['SOURCE_IDENTITY_NOT_VERIFIED']:[])];
 plan.complete=mode==='live'&&frozen&&plan.source_verified&&plan.calendar_verified;
 plan.status=plan.complete?'complete':'blocked';
 const verification=validate(plan,{tradeDate,now});
 if(!verification.complete){plan.complete=false;plan.status='blocked';}
 return {plan,verification,source_audit:audit,receipt:{contract:'premarket_plan_production_receipt_v1',scope:'intraday_observation_only',run_id:plan.run_id,trade_date:tradeDate,status:plan.status,complete:plan.complete,plan_sha256:digest(plan),row_count:rows.length,failed_checks:[...new Set([...plan.blocking_reasons,...verification.failed_checks])],notifications_sent:0}};
}
module.exports={build};
