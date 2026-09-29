'use strict';
const assert=require('node:assert/strict'),{evaluate,collect,verify}=require('../lib/mother-pool-warmup-union');
const date='2026-09-29',asOf='2026-09-29T00:00:00Z',sourceDate='2026-09-24';
const group=key=>({status:'ready',runId:key+'-run',scanDate:sourceDate,symbols:['2330'],sourceReceipt:{run_id:key+'-run',trade_date:sourceDate,status:'complete',result_count:1,checked_at:'2026-09-24T05:00:00Z'},sourceRows:[{symbol:'2330',run_id:key+'-run',trade_date:sourceDate}],handoff:{ok:true,failed_checks:[],source_run_id:key+'-run',strategy_source_date:sourceDate,handoff_trade_date:date}});
const bridge={tradeDate:date,previousSourceDate:sourceDate,updatedAt:asOf,groups:{strategy2:group('strategy2'),strategy3:group('strategy3')}};
let result=evaluate(bridge,date,asOf);assert.deepEqual(result.union,['2330']);assert.deepEqual(result.flags['2330'],['strategy2','strategy3']);
assert(result.failed_checks.includes('watch_case:SOURCE_ADAPTER_NOT_REGISTERED'));assert(result.failed_checks.includes('futures:FUTURES_CATALOGUE_IDENTITY_OR_TIME'));
const changed=structuredClone(bridge);changed.groups.strategy2.sourceRows[0].run_id='wrong';result=evaluate(changed,date,asOf);assert(!result.flags['2330'].includes('strategy2'));assert(result.failed_checks.includes('strategy2:SOURCE_ROW_RUN_MISMATCH'));
changed.groups.strategy1=group('strategy1');assert(evaluate(changed,date,asOf).failed_checks.includes('A03_UNAPPROVED_SOURCE'));
const identity={trade_date:date,canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1};
const input=collect({identity,symbols:['2317'],bridge,asOf});assert.deepEqual(input.requested_symbols,['2317','2330']);assert(input.rows.every(r=>r.status==='DATA_GAP'));assert.equal(input.rows.find(r=>r.symbol==='2317').in_warmup_union,false);
// A partial union is useful evidence, but must not pass complete verification.
assert.equal(verify(input.rows,{...identity,writer_write_set:{plan:{...input,source_evidence:input.source_evidence}}}),false);
console.log('PASS A03 source union/dedupe, source run mismatch, Strategy1 rejection, missing adapters retained as gaps');
