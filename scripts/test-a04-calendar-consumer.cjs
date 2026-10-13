'use strict';
const assert=require('node:assert/strict');
const {fixture,refresh}=require('./test-a04-owner-decision.cjs');
const {collect}=require('../lib/mother-pool-historical-volume-price');
const {select}=require('../lib/verify-a04-warmup.cjs');
let checks=0;
for(const mode of ['valid','expired','future','bad-hash','blocked','null-check']){
 const f=fixture();f.raw.rows[14].volume_lots=250;
 f.raw.calendar.contract='a04_verified_calendar_v1';
 f.raw.calendar.checks.forEach(c=>Object.assign(c,{fetched_at:'2026-10-13T06:00:00+08:00',available_at:'2026-10-13T06:01:00+08:00',calendar_source_sha256:'a'.repeat(64)}));
 if(mode==='expired')f.raw.calendar.checks[0].fetched_at='2026-10-01';
 if(mode==='future')f.raw.calendar.checks[0].available_at='2026-10-14';
 if(mode==='bad-hash')f.raw.calendar.checks[0].calendar_source_sha256='bad';
 if(mode==='blocked')f.raw.calendar.status='BLOCKED';
 if(mode==='null-check')f.raw.calendar.checks[0]=null;
 refresh(f);f.value.a04_daily_evidence=f.raw;
 const plan=collect(f,f.trustedBinding),result=select(plan,{identity:f.identity,asOf:f.asOf,trustedBinding:f.trustedBinding});
 assert.equal(result.symbols.length,mode==='valid'?1:0);checks++;
}
console.log(JSON.stringify({ok:true,checks,scope:'A04 Producer and independent verifier reject invalid bounded calendar even with matching source proof hash'}));
