'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createGuard,createLeasePreparation}=require('../lib/mother-shared-water-writer-guard.cjs');
const {runWindow}=require('../lib/mother-shared-water-cadence.cjs');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'water-lease-')),file=path.join(directory,'backoff.json');
 let time=Date.parse('2026-10-06T01:00:00Z'),renewals=0,publications=0;
 let lease={ok:true,status:'claimed',leaseExpiresAt:new Date(time+240000).toISOString()};
 const config={backoffFile:file,lease:()=>lease,tradeDate:'2026-10-06',now:()=>time};
 const prepare=createLeasePreparation({...config,renew:async()=>{renewals++;lease={...lease,leaseExpiresAt:new Date(time+240000).toISOString()};}});
 try{
  const started=time;
  const result=await runWindow({now:()=>time,deadline:time+720000,maxRounds:100,canPublish:createGuard(config),prepareRound:prepare,sleep:async ms=>{time+=ms;},run:async()=>{publications++;time+=2000;return {shared_water_acceptance:{publication_status:'COMMITTED',readback_verified:true,checked_at:new Date(time).toISOString(),valid_until:new Date(time+30000).toISOString(),verification_run_id:'p'+publications,water_gate_pass:true}};}});
  assert(time-started>=600000);assert(renewals>=3);assert(publications>=40);assert(result.rounds.slice(1).every(r=>r.evidence_gap_ms===0));assert.equal(result.natural_acceptance,false);
  const before=renewals;lease.leaseExpiresAt=new Date(time+10000).toISOString();fs.writeFileSync(file,JSON.stringify({contract:'writer_database_backoff_v1',failures:1,until:time+60000}));assert.equal(await prepare(),false);assert.equal(renewals,before);
  fs.unlinkSync(file);lease.leaseExpiresAt=new Date(time-1).toISOString();assert.equal(await prepare(),false);assert.equal(renewals,before);
  lease.leaseExpiresAt=new Date(time+10000).toISOString();time+=86400000;assert.equal(await prepare(),false);assert.equal(renewals,before);
  console.log(JSON.stringify({ok:true,cases:4,publications,renewals,mode:'virtual_clock_no_network',natural_acceptance:false,deployed:false}));
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(directory);}
})().catch(e=>{console.error(e);process.exitCode=1;});
