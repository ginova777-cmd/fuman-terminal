'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {persistModuleRound}=require('../lib/persist-mother-pool-module-round');
const {writeExclusive}=require('../lib/daytrade-durable-json');
const {hash,identityFields}=require('../lib/mother-pool-module-write-set');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'module-intent-'));
const make=()=>({module_id:'A01',trade_date:'2026-09-29',canonical_run_id:'canonical',writer_run_id:'writer',generation_id:'writer-generation',mother_pool_run_id:'pool',snapshot_generation:'snapshot-generation',snapshot_sequence:1,created_at:'2026-09-29T00:00:00Z',requested_symbols:['2330'],rows:[{symbol:'2330',status:'READY',source:'isolated-test',source_contract:'test',source_updated_at:'2026-09-29T00:00:00Z',is_synthetic:false,replay:false,look_ahead:false,value:7}]});
(async()=>{
 const input=make();let writes=0;
 const saved=await persistModuleRound(input,{
  savePlan:async plan=>{writeExclusive(path.join(root,'plan.json'),plan);input.rows[0].value=99;input.requested_symbols.push('9999');plan.plan.rows[0].value=88;},
  persist:async body=>{writes++;const document=JSON.parse(body.p_document),plan=JSON.parse(body.p_plan);assert.deepEqual(document,JSON.parse(fs.readFileSync(path.join(root,'plan.json'))));assert.equal(plan.rows[0].value,7);assert.equal(hash(plan),document.plan_hash);return {committed:true,module_id:'A01',...Object.fromEntries(identityFields.map(k=>[k,document[k]])),plan_hash:document.plan_hash,written_symbols:['2330']};},
  saveEvidence:async evidence=>writeExclusive(path.join(root,'ack.json'),evidence)
 });
 assert.equal(saved.plan.rows[0].value,7);assert.equal(writes,1);
 assert.throws(()=>writeExclusive(path.join(root,'plan.json'),{}),/EEXIST/);
 await assert.rejects(persistModuleRound(make(),{savePlan:async()=>{throw Error('DISK_FULL');},persist:async()=>{writes++;}}),/DISK_FULL/);assert.equal(writes,1);
 let evidence=false;
 await assert.rejects(persistModuleRound(make(),{savePlan:async plan=>writeExclusive(path.join(root,'interrupted.json'),plan),persist:async()=>{throw Error('NETWORK_TIMEOUT');},saveEvidence:async()=>{evidence=true;}}),/NETWORK_TIMEOUT/);
 assert.equal(evidence,false);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'interrupted.json'))).plan.rows[0].value,7);
 await assert.rejects(persistModuleRound(make(),{savePlan:async()=>{},persist:async()=>({committed:true,plan_hash:'wrong',written_symbols:['2330']}),saveEvidence:async()=>{evidence=true;}}),/INVALID_DB_ACK/);assert.equal(evidence,false);
 console.log('PASS immutable wire plan, exclusive durable file, disk failure prevents RPC, interrupted intent retained, invalid ACK rejected; no network.');
})().catch(e=>{console.error(e);process.exitCode=1;});
