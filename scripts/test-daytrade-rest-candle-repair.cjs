'use strict';
const assert=require('node:assert/strict');
const {normalizeResponse:n}=require('../lib/daytrade-rest-candle-repair.cjs');
const options={symbol:'3163',tradeDate:'2026-10-02',receivedAt:'2026-10-03T04:43:10Z',runId:'test-only'};
const bar={date:'2026-10-02T09:00:00+08:00',open:10,high:11,low:9,close:10,volume:0};
const body={symbol:'3163',date:'2026-10-02',type:'EQUITY',market:'OTC',timeframe:'1',data:[bar]};
assert.equal(n(body,options).rows[0].volume,0);
for(const patch of [{volume:null},{volume:undefined},{volume:''},{volume:'0'},{volume:-1},{high:9},{low:11},{date:'2026-10-01T09:00:00+08:00'},{date:'2026-10-02T09:00:00'},{date:'2026-10-02T09:00:01+08:00'},{date:'2026-10-02T08:59:00+08:00'},{isSynthetic:true}])assert.equal(n({...body,data:[{...bar,...patch}]},options).rows.length,0,JSON.stringify(patch));
for(const patch of [{symbol:'2330'},{date:'2026-10-01'},{market:'ESB'},{timeframe:'5'},{data:null},{isSynthetic:true}])assert.throws(()=>n({...body,...patch},options));
assert.equal(n({...body,data:[bar,bar]},options).rows.length,1);
assert.equal(n({...body,data:[bar,{...bar,volume:1}]},options).rows.length,0);
const row=n(body,options).rows[0];assert.equal(row.payload.volume_unit,'lots');assert.equal(row.payload.historical_availability_proven,false);assert.equal(row.payload.source_received_at,options.receivedAt);assert.equal(row.is_formal_entry_eligible,false);assert.equal(row.payload.raw_sha256.length,64);
console.log('PASS native response identity, missing volume rejection, real zero, OHLC, event time, units, conflicts and historical availability');

(async()=>{
 const {publishMissing}=require('../lib/daytrade-rest-candle-repair.cjs');
 const row=n(body,options).rows[0];let calls=0;
 const done=await publishMissing({existing:[],candidates:[row],insert:async rows=>{calls++;return rows},readback:async()=>[row]});assert.equal(done.written,1);assert.equal(calls,1);
 const old={...row,close:10.5};
 const blocked=await publishMissing({existing:[old],candidates:[row],insert:async()=>{throw Error('must not overwrite')},readback:async()=>[old]});assert.equal(blocked.written,0);assert.equal(blocked.blocked.length,1);assert.equal(blocked.rows[0].close,10.5);
 await assert.rejects(()=>publishMissing({existing:[],candidates:[row],insert:async()=>[],readback:async()=>[old]}),/READBACK_MISMATCH/);
 await assert.rejects(()=>publishMissing({existing:[],candidates:[row],insert:async rows=>rows,readback:async()=>[]}),/READBACK_MISMATCH/);
 await assert.rejects(()=>publishMissing({existing:[],candidates:[row],insert:async rows=>rows,readback:async()=>[{...row,payload:{}}]}),/EVIDENCE_MISSING/);
 await assert.rejects(()=>publishMissing({existing:[],candidates:[row],insert:async()=>{throw Error('timeout')},readback:async()=>{throw Error('must stop after failed write')}}),/timeout/);
 const concurrent=await publishMissing({existing:[],candidates:[row],insert:async()=>[],readback:async()=>[row]});assert.equal(concurrent.written,0);
 const script=require('fs').readFileSync(require.resolve('./repair-daytrade-intraday-1m-gaps.js'),'utf8');assert.ok(script.includes('resolution=ignore-duplicates,return=representation'));assert.ok(!script.includes('localRows.push(...realRows)'));assert.ok(!script.includes('limit=1000000'));
 console.log('PASS no overwrite, concurrent conflict, independent readback, exact inserted count, missing evidence and timeout stop');
})().catch(e=>{console.error(e);process.exitCode=1});
