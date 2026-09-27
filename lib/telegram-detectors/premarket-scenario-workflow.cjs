'use strict';
// Shared case-review workflow. It cannot create a live plan or send orders.
const {historicalSupports,evaluateShort}=require('./premarket-short-decision.cjs');
const {scoreB,buildBEvidence}=require('./premarket-short-ranking.cjs');
const {costTopBuyer}=require('./main-broker-cost.cjs');
const {compare}=require('./broker-institution-comparison.cjs');
const {assess}=require('./premarket-scenario-assessment.cjs');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
function cost3Proximity(cost,price){
 const target=positive(cost)?cost*1.03:null;
 const valid=positive(target)&&positive(price)&&finite(target*1.01);
 const lower=valid?target*.99:null,upper=valid?target*1.01:null;
 return {target,relative_tolerance:.01,lower,upper,relative_distance:valid?Math.abs(price/target-1):null,matched:valid?price>=lower&&price<=upper:null};
}
function reviewCase(input={}){
 const {stock_id,base_date,trade_date,previous={},trial={},plan_cost,foreign_history=[]}=input;
 if(!/^\d{4}$/.test(stock_id||''))throw Error('INVALID_SYMBOL');
 const costEvidence=Object.hasOwn(input,'branch_rows')?costTopBuyer({rows:input.branch_rows,symbol:stock_id,baseDate:base_date}):null;
 const O=trial.price,C=costEvidence?(costEvidence.valid?costEvidence.value:null):plan_cost;
 const ranking=scoreB(input.short_rank_input?buildBEvidence(input.short_rank_input):input.short_rank_evidence);
 const references=[['previous_high',previous.high],['previous_low',previous.low],['previous_close',previous.close],['plan_cost',C],['plan_cost_plus_3pct',positive(C)?C*1.03:null],['plan_cost_plus_5pct',positive(C)?C*1.05:null]]
  .map(([source,price])=>({source,price:positive(price)?price:null,kind:'reference',relative_to_trial:positive(price)&&positive(O)?(price>O?'above':price<O?'below':'at'):null}));
 const positions={versus_previous_close:positive(O)&&positive(previous.close)?Math.sign(O-previous.close):null,below_previous_low:positive(O)&&positive(previous.low)?O<previous.low:null,cost_distance:positive(O)&&positive(C)?O/C-1:null,cost_plus_3pct_proximity:cost3Proximity(C,O)};
 const support=historicalSupports({bars:input.history,baseDate:base_date,trialPrice:O});
 const foreignFour=foreign_history.length>=4?foreign_history.slice(-4):[];
 const foreignEvidence=foreignFour.length===4&&foreignFour.every((r,i)=>finite(r.net)&&r.net<0&&/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')&&r.date<=base_date&&(!i||foreignFour[i-1].date<r.date))&&foreignFour[3].date===base_date;
 const foreignReported=input.source==='user_provided_case'&&Number.isInteger(input.foreign_consecutive_sell_days_reported)&&input.foreign_consecutive_sell_days_reported>=4;
 const aStructure=(foreignEvidence||foreignReported)&&positive(previous.high)&&previous.close===previous.high&&['kd','rsi','macd'].every(k=>input.daily_trend?.[k]==='up');
 const bPrice=positive(O)&&positive(C)&&positive(previous.low)&&O<previous.low&&O<=C*.98;
 const candidates=[];
 // These are review candidates, not sufficient formal short qualification.
 if(bPrice)candidates.push({id:'B_BREAK_LOW_CONTINUATION',direction:'short',evidence:['TRIAL_BELOW_PREVIOUS_LOW','TRIAL_AT_LEAST_2_PERCENT_BELOW_COST'],score:ranking.score,paths:[{id:'CONTINUE_WEAK',description:'破昨低續弱'}]});
 if(aStructure)candidates.push({id:'A_DISTRIBUTION_DIVERGENCE',direction:'short',evidence:['CLOSE_AT_HIGH','DAILY_INDICATORS_UP',foreignEvidence?'FOREIGN_LAST_FOUR_RECORDS_NET_SELL':'USER_REPORTED_FOREIGN_FOUR_DAY_SELL'],opening_position_matched:positions.cost_plus_3pct_proximity.matched===true,paths:positions.cost_plus_3pct_proximity.matched===true?[{id:'DIRECT_DECLINE',reference:'plan_cost_plus_3pct'},{id:'RISE_THEN_DECLINE',reference:'plan_cost_plus_5pct'}]:[],unresolved:[...(positions.cost_plus_3pct_proximity.matched===true?[]:[positions.cost_plus_3pct_proximity.matched===null?'COST_3_PERCENT_POSITION_MISSING':'OUTSIDE_COST_3_PERCENT_BAND']),'FOUR_RECORDS_TRADING_CALENDAR_NOT_VERIFIED','A_FINAL_GATE_NOT_DEFINED']});
 const bDecision=evaluateShort({...input.short_decision_input,trial,tradeDate:trade_date,baseDate:base_date,previousLow:previous.low,planCost:C,bars:input.history,short_rank_input:input.short_rank_input,short_rank_evidence:input.short_rank_evidence});
 const brokerComparison=compare({branchRows:input.branch_rows,institutionalRows:input.institutional_rows,symbol:stock_id,baseDate:base_date});
 const scenarioAssessments=assess({previous,trial,cost:C,ranking,rankInput:input.short_rank_input,foreignHistory:foreign_history,reportedForeignDays:input.foreign_consecutive_sell_days_reported,source:input.source,dailyTrend:input.daily_trend,comparison:brokerComparison});
 const rebound=scenarioAssessments.find(s=>s.id==='A_UPPER_SHADOW_REBOUND_REVIEW');
 if(rebound.status==='matched')candidates.push({id:rebound.id,direction:'short',scope:rebound.scope,evidence:rebound.checks.map(c=>c.id),unresolved:rebound.unresolved_rules,paths:[{id:'REBOUND_TO_COST_THEN_WEAKEN',reference:'plan_cost',hypothesis_only:true}]});
 const blockers=['CASE_REVIEW_NOT_LIVE'];
 if(!costEvidence)blockers.push('BROKER_COST_SOURCE_UNVERIFIED');
 else if(!costEvidence.valid)blockers.push(...costEvidence.failed_checks);
 if(!candidates.length)blockers.push('NO_RECOGNIZED_SCENARIO');
 if(candidates.some(c=>c.id.startsWith('B_')))blockers.push(...bDecision.reasons);
 for(const c of candidates)blockers.push(...(c.unresolved||[]));
 const targets=[];
 if(positive(O))targets.push({kind:'projection_only',source:'trial_minus_2pct',price:O*.98});
 if(positive(O)&&finite(input.case_target_drop_pct)&&input.case_target_drop_pct>0&&input.case_target_drop_pct<1)targets.push({kind:'case_projection_only',source:'user_case_drop_pct',price:O*(1-input.case_target_drop_pct),drop_pct:input.case_target_drop_pct});
 return {contract:'premarket_scenario_review_v1',mode:'case_review',stock_id,base_date,trade_date,source:input.source||'unverified',cost_evidence:costEvidence,broker_comparison:brokerComparison,scenario_assessments:scenarioAssessments,reported_plan_cost:plan_cost??null,complete:false,status:'blocked',premarket_direction:candidates.length?'short_candidate':'unknown',scenario_candidates:candidates,ranking,positions,references,historical_support:support,observation_targets:targets,user_expected_action:input.user_expected_action||null,preopen_action:'NO_TRADE',intraday_direction:'none',b_decision:bDecision,blocking_reasons:[...new Set(blockers)]};
}
module.exports={reviewCase,cost3Proximity};
