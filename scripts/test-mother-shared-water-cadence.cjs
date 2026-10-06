'use strict';
const assert=require('node:assert/strict'),{runWindow}=require('../lib/mother-shared-water-cadence.cjs');
(async()=>{
 let time=0,active=0,peak=0,calls=0;
 const options={now:()=>time,deadline:180000,maxRounds:3,canPublish:()=>true,sleep:async ms=>{time+=ms;},run:async()=>{calls++;active++;peak=Math.max(peak,active);time+=2000;active--;return {shared_water_acceptance:{publication_status:'COMMITTED',readback_verified:true,checked_at:new Date(time).toISOString(),valid_until:new Date(time+30000).toISOString(),verification_run_id:'proof-'+calls,water_gate_pass:true}};}};
 let r=await runWindow(options);assert.equal(r.rounds.length,3);assert.equal(peak,1);assert(r.rounds.slice(1).every(x=>x.evidence_gap_ms===0));assert.equal(r.continuous_verified,false);
 r=await runWindow({...options,deadline:time+59000});assert.equal(r.rounds.length,0);assert.equal(r.stop_reason,'TIME_BUDGET');
 r=await runWindow({...options,canPublish:()=>false});assert.equal(r.rounds.length,0);assert.equal(r.stop_reason,'WRITER_GUARD');
 let failures=0;r=await runWindow({...options,run:async()=>{throw Error('HTTP 503');},onFailure:async()=>{failures++;}});assert.equal(failures,1);assert.equal(r.rounds.length,1);assert.equal(r.stop_reason,'PUBLICATION_FAILED');
 r=await runWindow({...options,run:async()=>({shared_water_acceptance:{publication_status:'UNKNOWN'}})});assert.equal(r.rounds.length,1);assert.equal(r.stop_reason,'PUBLICATION_NOT_CURRENT');
 r=await runWindow({...options,maxRounds:1,previousValidUntil:new Date(time-5000).toISOString()});assert.equal(r.rounds[0].evidence_gap_ms,7000);
 console.log(JSON.stringify({ok:true,cases:6,mode:'virtual_clock',deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
