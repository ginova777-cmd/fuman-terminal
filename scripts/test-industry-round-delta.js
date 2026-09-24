'use strict';
const assert=require('node:assert/strict'),{compare}=require('../lib/mother-pool-industry-round-delta');
const tradeDate='2026-09-18',canonicalRunId='fugle_daytrade_source:20260918:canonical',asOf=tradeDate+'T10:01:00+08:00';
const previous={trade_date:tradeDate,canonical_run_id:canonicalRunId,writer_run_id:'w1',updated_at:tradeDate+'T10:00:00+08:00',symbols:['1101','2330'],net_flow_proxy:1000000};
const current={...previous,writer_run_id:'w2',updated_at:asOf,symbols:['2330','1101'],net_flow_proxy:600000000};
const input={current,previous,tradeDate,canonicalRunId,asOf};assert.equal(compare(input).delta,599000000);assert.equal(compare(input).window_seconds,60);
for(const patch of [{previous:null},{previous:{...previous,symbols:['1101']}},{previous:{...previous,writer_run_id:'w2'}},{previous:{...previous,canonical_run_id:'other'}},{previous:{...previous,updated_at:tradeDate+'T09:50:00+08:00'}},{current:{...current,net_flow_proxy:null}},{current:{...current,symbols:['1101','1101']}}]){const r=compare({...input,...patch});assert.equal(r.status,'NOT_COMPARABLE');assert.equal(r.delta,null);}
const zero=compare({...input,current:{...current,net_flow_proxy:1000000}});assert.equal(zero.comparable,true);assert.equal(zero.delta,0);
assert.equal(compare({...input,current:{...current,formula_version:'v2'},previous:{...previous,formula_version:'v1'}}).reason,'FORMULA_VERSION_MISMATCH');
assert.equal(compare({...input,current:{...current,formula_version:'v2'}}).reason,'FORMULA_VERSION_MISMATCH');
const {collect}=require('../lib/mother-pool-industry-delta-producer');
const discovery={trade_date:tradeDate,canonical_run_id:canonicalRunId,updated_at:asOf,requested_symbols:['1101','2330'],source_rows:[{symbol:'1101',event_at:asOf,classification:{industry:'test'}}],industry_heatmap:[{...current,industry:'test',previous_round_evidence:previous}]};
const plan=collect({identity:{trade_date:tradeDate,canonical_run_id:canonicalRunId,writer_run_id:'w2'},discovery,asOf});
assert.equal(plan.rows[0].status,'READY');assert.equal(plan.rows[0].delta,599000000);assert.equal(plan.rows[1].status,'DATA_GAP');assert.equal(plan.rows[1].delta,null);
console.log(JSON.stringify({status:'passed',checks:9,scope:'isolated',production_complete:false}));
