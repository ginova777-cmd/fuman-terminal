'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {load}=require('../lib/mother-pool-deferred-recovery-input'),{persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const {hash,identityFields}=require('../lib/mother-pool-module-write-set');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deferred-recovery-'));
 try{
 const input=require('../lib/mother-pool-identity-source').collect(require('./test-mother-identity-source').fixture());input.module_id='A18';
 const identity=Object.fromEntries(identityFields.map(k=>[k,input[k]]));let original;
 await assert.rejects(persistModuleRound(input,{savePlan:async d=>{original=d;},persist:async()=>{throw Error('capture');}}),/capture/);
 assert.equal(load(dir,'A18',identity),null);
 const file=path.join(dir,'original-plan.json');fs.writeFileSync(file,JSON.stringify(original));
 const recovered=load(dir,'A18',identity);let regenerated;
 await assert.rejects(persistModuleRound(recovered,{savePlan:async d=>{regenerated=d;},persist:async()=>{throw Error('capture');}}),/capture/);
 assert.deepEqual(regenerated,original);
 const attempts=path.join(dir,'attempts');fs.mkdirSync(attempts);const second=path.join(attempts,'copy.attempt.json');fs.writeFileSync(second,JSON.stringify({contract:'daytrade_module_attempt_v1',document:original}));assert.deepEqual(load(dir,'A18',identity),recovered);
 const changed=structuredClone(original);changed.plan.rows[0].source_updated_at='2026-09-18T00:00:00Z';changed.plan_hash=hash(changed.plan);fs.writeFileSync(second,JSON.stringify({contract:'daytrade_module_attempt_v1',document:changed}));assert.throws(()=>load(dir,'A18',identity),/CONFLICT/);
 fs.unlinkSync(second);original.generation_id='other';fs.writeFileSync(file,JSON.stringify(original));assert.throws(()=>load(dir,'A18',identity),/INVALID/);
 console.log('PASS deferred recovery: exact original plan reconstruction, missing stays absent, differing intents and batch identity rejected');
 }finally{const target=path.resolve(dir);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('deferred-recovery-'));fs.rmSync(target,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
