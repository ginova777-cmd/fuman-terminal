'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {build}=require('../lib/mother-pool-a16-baseline');
const {verify}=require('../lib/verify-mother-pool-a16');
// Explicit isolated fixtures. Never production acceptance evidence.
const dates=Array.from({length:20},(_,i)=>`2026-08-${String(i+1).padStart(2,'0')}`);
const raw={symbol:'2330',exchange:'TWSE',market:'TSE',type:'EQUITY',timeframe:'1',data:dates.flatMap((d,i)=>[{date:d+'T09:00:00+08:00',open:100,high:100,low:100,close:100,volume:10+i},{date:d+'T09:01:00+08:00',open:100,high:102,low:100,close:101,volume:20+i}])};
const history={contract:'mother_pool_historical_minute_fetch_evidence_v1',symbol:'2330',trade_date:'2026-09-18',calendar_verified:true,requested_sessions:dates,calendar:{checked_at:'2026-09-17T12:00:00Z',sha256:'a'.repeat(64)},result:{status:'HISTORY_FETCHED',raw,fetched_at:'2026-09-17T12:01:00Z',normalized:{raw_sha256:crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex')}}};
const input={symbol:'2330',tradeDate:'2026-09-18',canonicalRunId:'fugle_daytrade_source:20260918:canonical',asOf:'2026-09-17T13:00:00Z',history};
const r=build(input),row=(type,m='09:01')=>r.rows.find(x=>x.baseline_type===type&&x.minute===m);
assert.equal(row('VOLUME').baseline_value,29500);assert.equal(row('VOLUME').sample_count,20);
assert.equal(row('ABS_RETURN').baseline_value,1);assert.equal(row('ABS_RETURN','09:00').status,'NOT_APPLICABLE');
assert.equal(row('OUTSIDE_STRENGTH').sample_count,0);assert.equal(r.complete,false);
assert.equal(verify(r,input).verification_passed,true);
for(const mutate of [x=>x.complete=true,x=>x.rows[0].baseline_value++,x=>x.rows[0].unit='LOTS',x=>x.rows[0].sample_count=21,x=>x.rows[0].symbol='1101',x=>x.rows[1]={...x.rows[0]},x=>x.rows[0].source_trade_dates[0]='2026-09-18',x=>x.rows[0].is_synthetic=true,x=>x.rows[0].samples[0].value=0]){const bad=structuredClone(r);mutate(bad);assert.equal(verify(bad,input).verification_passed,false);}
const corrupt=structuredClone(input);corrupt.history.result.raw.data[0].volume=null;assert.equal(build(corrupt).complete,false);assert.equal(verify(r,corrupt).verification_passed,false);
assert.throws(()=>build({...input,symbol:'[object Object]'}),/IDENTITY/);
console.log('A16 isolated calculation and 11 rejection cases passed; not production evidence');
