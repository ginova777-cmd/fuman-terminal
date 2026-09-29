'use strict';
const assert=require('node:assert/strict');
const {reviewCase,validate}=require('./premarket-plan-contract.cjs');
const cases=require('./premarket-example-cases.cjs');
const {cost3Proximity}=require('./premarket-scenario-workflow.cjs');
for(const input of cases){
 const result=reviewCase(input);
 if(input.expected_candidate)assert(result.scenario_candidates.some(c=>c.id===input.expected_candidate));
 if(input.expected_assessment)assert.equal(result.scenario_assessments.find(s=>s.id===input.expected_assessment).status,'insufficient_data'); // User labels alone do not prove broker source.
 assert.equal(result.preopen_action,'NO_TRADE');assert.equal(result.intraday_direction,'none');assert.equal(result.complete,false);
 assert.equal(result.user_expected_action,input.user_expected_action);
 assert.equal(result.ranking.score,null); // Descriptions cannot fabricate 12 booleans.
 assert.equal(validate(result,{tradeDate:input.trade_date,now:input.trade_date+'T09:00:00+08:00'}).complete,false);
}
const a=reviewCase(cases[1]);
assert.equal(a.scenario_candidates[0].paths.length,2);
assert(Math.abs(a.references.find(r=>r.source==='plan_cost_plus_3pct').price-1138.15)<1e-8);
assert(Math.abs(a.observation_targets.find(r=>r.source==='user_case_drop_pct').price-1089.6)<1e-8);
assert.equal(a.historical_support.complete,false);
const b=reviewCase(cases[0]);assert.equal(b.positions.below_previous_low,true);
assert(Math.abs(b.observation_targets[0].price-505.68)<1e-8);
const differentSymbol=reviewCase({...cases[1],stock_id:'9999'});
assert.equal(differentSymbol.scenario_candidates[0].id,'A_DISTRIBUTION_DIVERGENCE');
assert.equal(reviewCase({...cases[1],foreign_consecutive_sell_days_reported:0}).scenario_candidates.length,0);
assert.equal(reviewCase({...cases[1],source:'live'}).scenario_candidates.length,0);
assert.equal(reviewCase({...cases[0],trial:{price:530}}).scenario_candidates.length,0);
assert.throws(()=>reviewCase({}),/INVALID_SYMBOL/);
const hua=cases.find(c=>c.stock_id==='4979'),h=reviewCase(hua);
assert.equal(h.scenario_candidates[0].id,b.scenario_candidates[0].id);
assert(Math.abs(h.positions.cost_distance-(581/597-1))<1e-10);
assert(Math.abs(h.observation_targets.find(r=>r.source==='user_case_drop_pct').price-557.76)<1e-8);
assert.equal(reviewCase({...hua,stock_id:'9998'}).scenario_candidates[0].id,'B_BREAK_LOW_CONTINUATION');
assert.equal(reviewCase({...hua,trial:{price:583}}).scenario_candidates.length,0);
assert.equal(reviewCase({...hua,plan_cost:590}).scenario_candidates.length,0);
assert.equal(h.historical_support.complete,false);
console.log('PASS three-case workflow: distinct A/B, 4979 break-low/cost boundary rejection, no symbol hardcoding, no case-to-live promotion');
const band=cost3Proximity(1105,1135);
assert.equal(band.matched,true);
for(const price of [band.lower,band.upper])assert.equal(cost3Proximity(1105,price).matched,true);
for(const price of [band.lower-.000001,band.upper+.000001]){
 assert.equal(cost3Proximity(1105,price).matched,false);
 const outside=reviewCase({...cases[1],trial:{price}});
 assert.equal(outside.scenario_candidates[0].paths.length,0);
 assert(outside.blocking_reasons.includes('OUTSIDE_COST_3_PERCENT_BAND'));
}
for(const value of [null,undefined,NaN,Infinity,0,-1,'1135']){
 assert.equal(cost3Proximity(1105,value).matched,null);
 assert.equal(cost3Proximity(value,1135).matched,null);
}
assert(!a.blocking_reasons.includes('COST_3_PERCENT_PROXIMITY_NOT_DEFINED'));
assert.equal(a.scenario_candidates[0].opening_position_matched,true);
console.log('PASS cost+3% proximity: target-based 1%, inclusive bounds, outside/missing blocked, A structure preserved without unmatched opening paths');
const costRows=[{stock_id:'2368',date:'2026-09-23',securities_trader_id:'a',price:1100,buy:100,sell:0},{stock_id:'2368',date:'2026-09-23',securities_trader_id:'a',price:1200,buy:0,sell:10}];
const repriced=reviewCase({...cases[1],branch_rows:costRows});
assert.equal(repriced.cost_evidence.value,1100);
assert.equal(repriced.references.find(r=>r.source==='plan_cost').price,1100);
assert.equal(repriced.reported_plan_cost,1105);
assert.equal(reviewCase({...cases[1],branch_rows:[]}).references.find(r=>r.source==='plan_cost').price,null);
console.log('PASS source-derived first-broker cost overrides reported cost; missing branch data cannot silently fall back');
const extended=cases.find(c=>c.stock_id==='6168'),e=reviewCase(extended),extensionId='A_COST_EXTENSION_DISTRIBUTION_REVIEW';
assert.equal(extended.base_date,'2026-09-22');assert.equal(extended.trade_date,'2026-09-23');
assert.equal(e.scenario_assessments.find(s=>s.id===extensionId).status,'matched');
assert.equal(e.scenario_candidates.find(s=>s.id===extensionId).scope,'structural_candidate_only');
assert.equal(e.user_expected_action,'LIMIT_DOWN_SHORT');assert.equal(e.preopen_action,'NO_TRADE');
assert(Math.abs(e.observation_targets.find(t=>t.source==='user_case_drop_pct').price-41.76)<1e-9);
assert(Math.abs(e.observation_targets.find(t=>t.source==='user_case_rebound_pct').price-42.5952)<1e-9);
assert(Math.abs(e.references.find(t=>t.source==='plan_cost_plus_5pct').price-40.782)<1e-9);
assert.equal(reviewCase({...extended,stock_id:'9997'}).scenario_candidates.some(s=>s.id===extensionId),true);
const extensionStatus=x=>reviewCase(x).scenario_assessments.find(s=>s.id===extensionId).status;
assert.equal(extensionStatus({...extended,trial:{price:extended.plan_cost*1.05}}),'matched');
assert.equal(extensionStatus({...extended,trial:{price:extended.plan_cost*1.05-.00001}}),'not_matched');
assert.equal(extensionStatus({...extended,previous:{...extended.previous,close:extended.plan_cost*1.05}}),'not_matched');
assert.equal(extensionStatus({...extended,previous:{...extended.previous,high:45}}),'not_matched');
assert.equal(extensionStatus({...extended,daily_trend:{...extended.daily_trend,kd:'down'}}),'not_matched');
assert.equal(extensionStatus({...extended,daily_trend:{...extended.daily_trend,kd:'unknown'}}),'insufficient_data');
assert.equal(extensionStatus({...extended,branch_rows:[]}),'insufficient_data');
assert.equal(e.scenario_assessments.find(s=>s.id===extensionId).evidence.overheat_asserted,false);
assert.equal(extended.actual_outcome_verified,false);
console.log('PASS 6168 cost-extension classification, exact targets, boundary/missing rejection, no symbol hardcoding, expected short action distinct from live permission');
// Synthetic provider-shaped history proves the production source path reaches
// the new candidate; it is not the historical 6168 price series.
const fixture=require('./premarket-validation-fixture.cjs').fixture(),source=fixture.snapshot.symbols[0],count=source.price_rows.length;
for(let i=0;i<count;i++){const c=(i>=count-4?[88,91,96,104][i-count+4]:100-i*.3)*44/104;Object.assign(source.price_rows[i],{open:c,max:c+.5,min:c-.5,close:c});}
source.branch_rows[0].price=38.84;fixture.trialRows[0].trial_price=43.5;
const audit=require('./premarket-validation-flow.cjs').runValidation(fixture);
assert.equal(audit.rows[0].scenario_assessments.find(s=>s.id===extensionId).status,'matched');
assert(audit.rows[0].scenarios.some(s=>s.id===extensionId));assert.equal(audit.rows[0].direction_candidate,'none');
const plan=require('./premarket-plan-producer.cjs').build({...fixture,now:fixture.tradeDate+'T08:59:50+08:00',mode:'live'}).plan;
assert.equal(plan.rows[0].intraday_direction,'none');assert(!plan.rows[0].observation_rule_ids.includes(extensionId));
assert.equal(plan.rows[0].order_allowed,false);assert.equal(plan.notifications_enabled,false);
console.log('PASS provider-shaped source -> candidate -> display; unconfirmed short gate remains closed');
const longCase=cases.find(c=>c.stock_id==='3042'),longId='L_NEAR_COST_DEALER_BUY_REVIEW',l=reviewCase(longCase);
assert.equal(l.premarket_direction,'long_candidate');assert.equal(l.user_expected_action,'LIMIT_UP_LONG');
assert.equal(l.scenario_assessments.find(s=>s.id===longId).status,'matched');
assert.equal(l.scenario_candidates.find(s=>s.id===longId).paths[0].target,198);
assert.equal(l.observation_targets.find(t=>t.source==='user_case_up_target').price,198);
assert(Math.abs(l.observation_targets.find(t=>t.source==='user_case_drop_pct').price-190.08)<1e-8);
assert(Math.abs(l.observation_targets.find(t=>t.source==='user_case_rebound_pct').price-193.8816)<1e-8);
assert(Math.abs(l.references.find(t=>t.source==='plan_cost_plus_3pct').price-200.85)<1e-8);
assert.equal(l.preopen_action,'NO_TRADE');assert.equal(l.intraday_direction,'none');
assert.equal(reviewCase({...longCase,stock_id:'9996'}).premarket_direction,'long_candidate');
for(const patch of [{source:'cached_finmind_source'},{branch_rows:[]}])assert.equal(reviewCase({...longCase,...patch}).scenario_assessments.find(s=>s.id===longId).status,'insufficient_data');
for(const patch of [{daily_trend:{kd:'down',rsi:'up',macd:'up'}},{institutions_reported:{dealer_total:0}},{trial:{price:longCase.plan_cost*1.01001}}])assert.equal(reviewCase({...longCase,...patch}).scenario_assessments.find(s=>s.id===longId).status,'not_matched');
assert.notEqual(reviewCase({...cases[1],case_near_cost_reported:true}).premarket_direction,'conflict');
console.log('PASS 3042 long case, separate absolute target, exact drop/rebound bases, no symbol hardcoding or case-to-live promotion, direction conflict explicit');

// Confirmed numeric band replaces reported flags, including for provider input.
const {nearCost,assess:assessLong}=require('./premarket-long-cost-review.cjs');
for(const cost of [100,195.86580090133,577.8822083245268]){
 for(const price of [cost*.99,cost,cost*1.01])assert.equal(nearCost(cost,price).matched,true);
 for(const price of [cost*.99-.000001,cost*1.01+.000001])assert.equal(nearCost(cost,price).matched,false);
}
for(const bad of [null,undefined,0,-1,NaN,Infinity,'100']){assert.equal(nearCost(bad,100).matched,null);assert.equal(nearCost(100,bad).matched,null);}
assert.equal(nearCost(195.86580090133,196).matched,true);
assert.equal(nearCost(577.8822083245268,581).matched,true);
for(const flag of [undefined,false,true])assert.equal(reviewCase({...longCase,case_near_cost_reported:flag}).scenario_assessments.find(s=>s.id===longId).status,'matched');
const providerLong=assessLong({input:{source:'validation_source',trial:{price:101},daily_trend:{kd:'up',rsi:'up',macd:'up'}},cost:100,comparison:{institutions:{dealer:{net_shares:1}}}});
assert.equal(providerLong.status,'matched');assert.equal(providerLong.formal_eligible,false);
assert.deepEqual(providerLong.unresolved_rules,['LARGE_DEALER_BUY_THRESHOLD_UNDEFINED']);
const bandFixture=require('./premarket-validation-fixture.cjs').fixture();bandFixture.trialRows[0].trial_price=101;
const bandAudit=require('./premarket-validation-flow.cjs').runValidation(bandFixture);
assert.equal(bandAudit.rows[0].positions.near_cost_proximity.matched,true);
assert.equal(bandAudit.rows[0].scenario_assessments.find(s=>s.id===longId).checks.find(c=>c.id==='TRIAL_WITHIN_COST_1_PERCENT').value,true);
assert.equal(bandAudit.rows[0].preopen_action,'NO_TRADE');assert.equal(bandAudit.rows[0].direction_candidate,'none');assert.equal(bandAudit.no_send,true);
bandFixture.trialRows=[];const missingAudit=require('./premarket-validation-flow.cjs').runValidation(bandFixture);
assert.equal(missingAudit.rows[0].positions.near_cost_proximity.matched,null);
assert.equal(missingAudit.rows[0].direction_candidate,'none');
console.log('PASS confirmed inclusive near-cost band, source pipeline, invalid/missing and outside rejection, no independent order/direction permission');
