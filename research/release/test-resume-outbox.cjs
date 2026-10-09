'use strict';
const assert=require('assert/strict');const {seed,resume}=require('./test-recovery.cjs');const {digest}=require('../integration/coordinator.cjs');
async function prepare(){const x=seed();await x.c.run(x.frame);const root=x.c.store.root();
 for(const s of ['1000','1001'])root.outbox['FIXTURE-'+s]=x.c.store.put({payload:{stock_id:s,timestamp:x.frame.trade_date+'T12:40:00+08:00',event_type:'VOLUME_ANOMALY_EVENT',volume_raw:999},status:'DRY_RUN_PENDING',delivery_authorized:false});
 x.c.store.transaction(()=>root);const e=structuredClone(x.frame.events[0]);e.payload.volume=1;e.payload_sha256=digest(e.payload);x.frame={...x.frame,sequence:2,asOf:x.frame.trade_date+'T13:01:00+08:00',events:[e],gate:{...x.frame.gate,as_of:x.frame.trade_date+'T13:01:00+08:00'}};return x;}
(async()=>{const full=await prepare();await full.c.run(full.frame);const expected=full.c.store.root();const x=await prepare(),before=x.c.store.root();
 await x.c.run(x.frame,{recovery:{maxSteps:5000,fault:key=>{if(key==='R4:1000'){const e=Error('yield');e.code='RECOVERY_YIELD';throw e;}}}});assert.deepEqual(x.c.store.root(),before);await resume(x.dir);assert.deepEqual(x.c.store.root(),expected);
 assert.equal(Object.keys(expected.outboxRevisions).length,1);assert(expected.outbox['FIXTURE-1001']);assert(!expected.outbox['FIXTURE-1000']);assert.equal(x.c.store.get(before.outbox['FIXTURE-1000']).status,'DRY_RUN_PENDING');
 console.log(JSON.stringify({status:'PASS',tests:['unpublished outbox changes survive R4 interruption','one revised event withdrawn; other symbol preserved','original receipt immutable','full root identical to non-resumable calculation'],notifications:0,peak_rss_kib:process.resourceUsage().maxRSS}));
})().catch(e=>{console.error(e);process.exitCode=1});
