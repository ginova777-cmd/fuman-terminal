'use strict';
const assert=require('node:assert/strict');
const {reviewCase,validate}=require('./premarket-plan-contract.cjs');
const cases=require('./premarket-example-cases.cjs');
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
console.log('PASS two-case workflow: distinct A/B, no symbol hardcoding, paths and sourced levels, no fabricated score/history, no case-to-live promotion');
