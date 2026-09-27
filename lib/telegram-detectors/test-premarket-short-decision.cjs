'use strict';
const assert=require('node:assert/strict');
const {historicalSupports,evaluateShort}=require('./premarket-short-decision.cjs');
const {buildShortRows}=require('./premarket-plan-contract.cjs');
const {KEYS}=require('./premarket-short-ranking.cjs');
const bars=[102,101,98,101,102].map((low,i)=>({date:`2026-09-${21+i}`,low,high:110,completed:true}));
const input={trial:{price:100,timestamp:'2026-09-28T08:59:00+08:00',verified:true},tradeDate:'2026-09-28',baseDate:'2026-09-25',previousLow:102,planCost:110,shortQualified:true,b1:true,otherVeto:false,dataComplete:true,historyVerified:true,bars};
input.short_rank_evidence=Object.fromEntries(KEYS.map(k=>[k,true]));
let result=evaluateShort(input);
assert.equal(result.eligible,true);assert.equal(result.support.nearest.price,98);assert.equal(result.observation_target,98);
assert.equal(result.b1_restriction_lifted,true);
// Exactly 2% is accepted; closer support blocks even though the target is 2%.
let altered=structuredClone(input);altered.bars[2].low=98.01;
assert.equal(evaluateShort(altered).eligible,false);
assert(evaluateShort(altered).reasons.includes('DOWNSIDE_SPACE_BELOW_2_PERCENT'));
assert.equal(historicalSupports({bars:bars.slice(0,4),baseDate:'2026-09-24',trialPrice:100}).complete,false);
const future=[...bars,{date:'2026-09-29',low:1,high:110,completed:true}];
assert.deepEqual(historicalSupports({bars:future,baseDate:input.baseDate,trialPrice:100}),result.support);
for(const mutate of [x=>x.short_rank_evidence=undefined,x=>x.otherVeto=undefined,x=>x.otherVeto=true,x=>x.historyVerified=false,x=>x.trial.verified=false,x=>x.trial.timestamp='2026-09-28T08:50:00+08:00',x=>x.previousLow=100,x=>x.planCost=101,x=>x.bars[2].completed=false]) {
 altered=structuredClone(input);mutate(altered);assert.equal(evaluateShort(altered).eligible,false);
}
// No historical support cannot be replaced by the fixed target.
altered=structuredClone(input);altered.bars=bars.map(b=>({...b,low:99}));
assert.equal(evaluateShort(altered).support.complete,false);
assert.equal(evaluateShort(altered).observation_target,98);
const gapBars=[{low:80,high:85},{low:90,high:96},{low:92,high:97},{low:88,high:95},{low:91,high:96}].map((b,i)=>({...b,date:`2026-09-${21+i}`,completed:true}));
let gap=historicalSupports({bars:gapBars,baseDate:input.baseDate,trialPrice:100});
assert.equal(gap.nearest.kind,'unfilled_up_gap');assert.equal(gap.nearest.upper,88);assert.equal(gap.nearest.lower,85);
assert.equal(historicalSupports({bars:gapBars,baseDate:input.baseDate,trialPrice:87}).downside_space,0);
gapBars[4].low=85;
assert.equal(historicalSupports({bars:gapBars,baseDate:input.baseDate,trialPrice:100}).complete,false);
const rows=buildShortRows([{stock_id:'3450',short_rank_evidence:Object.fromEntries(KEYS.map(k=>[k,true])),short_decision_input:input}]);
assert.equal(rows[0].short_ranking.score,12);assert.equal(rows[0].preopen_action,'LIMIT_DOWN_SHORT');
assert.equal(buildShortRows([{stock_id:'3450',short_decision_input:input}])[0].preopen_action,'NO_TRADE');
console.log('PASS integrated ranking/support/exception: 2% boundary, no lookahead, unconfirmed pivot, partial/full gap fills, missing/Veto blocked, target cannot prove support');
for(const count of [0,1,12]){
 const evidence=Object.fromEntries(KEYS.map((k,i)=>[k,i<count]));
 const decision=evaluateShort({...input,shortQualified:true,short_rank_evidence:evidence});
 assert.equal(decision.eligible,count>=1);
 assert.equal(decision.intraday_direction,count>=1?'short':'none');
 const built=buildShortRows([{stock_id:'3450',short_rank_evidence:evidence,short_decision_input:input}])[0];
 assert.equal(built.short_decision.eligible,count>=1);
 if(count===0)assert(decision.reasons.includes('B_SHORT_SCORE_BELOW_ONE'));
}
assert.equal(evaluateShort({...input,short_rank_evidence:{foreign_sell:true}}).eligible,false);
console.log('PASS B minimum-one qualification: zero rejected, one accepted, incomplete blocked, upstream qualification cannot bypass score');
