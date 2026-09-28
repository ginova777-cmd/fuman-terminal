'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const file=path.resolve(__dirname,'../../scripts/publish-telegram-trial-view.cjs'),realRequire=require('node:module').createRequire(file);
const f=require('./premarket-validation-fixture.cjs').fixture();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publisher-handoff-'));
const sandbox={module:{exports:{}},process,Date,require(name){
 if(name.endsWith('premarket-source-collector.cjs'))return {collect:()=>f};
 if(name.endsWith('publish-trial-view.cjs'))return {publish:async()=>{throw Error('MOCK_DISPLAY_DB_FAILURE');}};
 if(name.endsWith('server-supabase-key'))return {anonKey:()=> 'mock-only'};
 return realRequire(name);
}};
vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
(async()=>{try{
 await assert.rejects(()=>sandbox.module.exports.main({runtimeRoot:dir,now:f.tradeDate+'T08:59:50+08:00'}),/MOCK_DISPLAY_DB_FAILURE/);
 const plan=JSON.parse(fs.readFileSync(path.join(dir,'data/telegram-detectors',f.tradeDate,'premarket-plan.json'),'utf8'));
 assert.equal(require('./premarket-plan-contract.cjs').directionFor(plan,'3450',{tradeDate:f.tradeDate,now:f.asOf}).direction,'short');
 assert.equal(plan.rows[0].order_allowed,false);assert.equal(plan.notifications_enabled,false);
 console.log('PASS scheduled publisher preserves verified local handoff when display DB fails; mocked DB, isolated runtime');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
