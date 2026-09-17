'use strict';
const assert=require('node:assert/strict');
const {selectSessions}=require('../lib/mother-pool-historical-sessions');
const tradeDate='2026-09-17';
const resolveDay=async d=>({date:new Date(d.getTime()+28800000).toISOString().slice(0,10),isTradingDay:![0,6].includes(d.getUTCDay()),source:'twse'});
(async()=>{
 const r=await selectSessions({tradeDate,resolveDay});
 assert.equal(r.status,'SESSION_DATES_VERIFIED');assert.equal(r.session_dates.length,20);assert.equal(r.session_dates.at(-1),'2026-09-16');
 assert.equal(r.complete,false);
 for(const patch of [{source:'stale_cache'},{source:'weekend_fallback'},{override:true},{date:'2026-09-17'},{isTradingDay:'true'},{error:'failed'}]) {
  const bad=await selectSessions({tradeDate,resolveDay:async d=>({...await resolveDay(d),...patch})});
  assert.equal(bad.status,'BLOCKED');assert.deepEqual(bad.session_dates,[]);
 }
 await assert.rejects(()=>selectSessions({tradeDate:'2026-02-30',resolveDay}),/INVALID/);
 console.log('PASS historical sessions: exact 20 preceding sessions; fallback/override/wrong date/type rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
