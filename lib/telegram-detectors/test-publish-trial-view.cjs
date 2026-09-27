'use strict';
const assert=require('node:assert/strict'),{publish}=require('./publish-trial-view.cjs'),{digest}=require('./premarket-plan-contract.cjs');
(async()=>{const now='2026-09-24T08:59:40+08:00',rows=[{stock_id:'3055',trial_price_levels:{trial_derived_complete:true}}],payload={contract:'telegram_premarket_validation_v1',mode:'validation',run_id:'premarket-validation-00000000-0000-0000-0000-000000000001',trade_date:'2026-09-24',checked_at:now,no_send:true,notifications_sent:0,rows,rows_sha256:digest(rows)},db=new Map(),store=async(k,p)=>db.set(k,p),readback=async k=>db.get(k)||null;
assert.equal((await publish({payload,store,readback,now})).published,true);
await assert.rejects(()=>publish({payload,store,readback,now:'2026-09-24T09:00:00+08:00'}),/NATURAL_WINDOW/);
await assert.rejects(()=>publish({payload:{...payload,rows_sha256:'bad'},store,readback,now}),/CONTRACT_INVALID/);
let writes=0;await assert.rejects(()=>publish({payload,store:async()=>writes++,readback:async()=>null,now}),/PINNED_READBACK/);assert.equal(writes,1);
const empty={...payload,rows:[],rows_sha256:digest([])};assert.equal((await publish({payload:empty,store:async()=>{throw Error('must preserve latest');},readback,now})).previous_good_preserved,true);
console.log('PASS trial-view pinned/latest readback, no stale/replay-out-of-window publication, no empty latest replacement; mock DB only');})().catch(e=>{console.error(e);process.exitCode=1;});
