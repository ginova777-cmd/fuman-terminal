'use strict';
const assert=require('node:assert/strict');
const {reviewCase,validate}=require('./premarket-plan-contract.cjs');
const cases=require('./premarket-example-cases.cjs');
const {cost3Proximity}=require('./premarket-scenario-workflow.cjs');
for(const input of cases){
 const result=reviewCase(input);
 assert(result.scenario_candidates.some(c=>c.id===input.expected_candidate));
 assert.equal(result.preopen_action,'NO_TRADE');assert.equal(result.intraday_direction,'none');assert.equal(result.complete,false);
 assert.equal(result.user_expected_action,'LIMIT_DOWN_SHORT');
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
