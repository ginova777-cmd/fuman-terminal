'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {build}=require('./premarket-plan-producer.cjs'),{publish}=require('./premarket-plan-handoff.cjs'),{directionFor,digest}=require('./premarket-plan-contract.cjs');
const f=require('./premarket-validation-fixture.cjs').fixture(),now=f.tradeDate+'T08:59:50+08:00',input={...f,now,mode:'live'},dir=fs.mkdtempSync(path.join(os.tmpdir(),'observation-handoff-'));
try{
 const p=build(input).plan,first=publish({plan:p,runtimeRoot:dir,now});assert(first.created);
 const readback=JSON.parse(fs.readFileSync(first.path,'utf8'));assert.equal(digest(readback),digest(p));assert.equal(directionFor(readback,'3450',{tradeDate:f.tradeDate,now:f.asOf}).direction,'short');
 const changed=structuredClone(p);changed.run_id='later-observation-attempt';changed.rows[0].intraday_direction='none';changed.rows[0].direction_qualified=false;changed.rows_sha256=digest(changed.rows);const repeat=publish({plan:changed,runtimeRoot:dir,now});assert(repeat.existing_freeze_preserved);assert.equal(repeat.plan_sha256,first.plan_sha256);
 assert.throws(()=>publish({plan:build({...input,trialRows:[]}).plan,runtimeRoot:dir,now}),/HANDOFF_REJECTED/);
 assert.throws(()=>publish({plan:build({...input,mode:'replay'}).plan,runtimeRoot:dir,now}),/HANDOFF_REJECTED/);
 fs.writeFileSync(first.path,'{}');assert.throws(()=>publish({plan:p,runtimeRoot:dir,now}),/EXISTING_INVALID/);
 assert.equal(fs.readFileSync(first.path,'utf8'),'{}');
 console.log('PASS atomic observation handoff, consumer direction/readback, first freeze immutable, replay rejected, invalid prior plan preserved and blocked; isolated temp only');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
