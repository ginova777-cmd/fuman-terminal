'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {run}=require('../lib/run-mother-pool-checkpoint-recovery');
const cp=require('../lib/mother-pool-module-input-checkpoint'),journal=require('../lib/daytrade-source-status-journal');
(async()=>{
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'recovery-entry-')),originalFetch=global.fetch;
 try{
 fs.mkdirSync(path.join(runtime,'state'));const input=require('../lib/mother-pool-identity-source').collect(require('./test-mother-identity-source').fixture());
 const identity=Object.fromEntries(require('../lib/mother-pool-module-write-set').identityFields.map(k=>[k,input[k]]));
 const ref=cp.save({directory:path.join(runtime,'checkpoint'),identity,observedAt:input.created_at,inputs:[input]});
 const row={source_name:'fugle_daytrade_source',trade_date:identity.trade_date,updated_at:input.created_at,payload:{...identity,mother_pool_snapshot_sequence:identity.snapshot_sequence,module_input_checkpoint:ref}};
 const sourceIntent=journal.prepare(path.join(runtime,'intents'),row);let posts=0,captures=0,stored,denyLease=false;
 global.fetch=async(raw,options)=>{const u=new URL(raw);let data=[],range='*/0';
  if(options.method==='POST'){posts++;stored=JSON.parse(JSON.parse(options.body).p_document);data={committed:true,...identity,module_id:stored.module_id,plan_hash:stored.plan_hash,written_symbols:stored.plan.requested_symbols,committed_at:input.created_at};}
  else if(stored){if(u.pathname.endsWith('round_v2'))data=[{module_id:stored.module_id,trade_date:identity.trade_date,writer_run_id:identity.writer_run_id,document:stored,committed_at:input.created_at}];else data=stored.plan.rows.map(evidence=>({module_id:stored.module_id,trade_date:identity.trade_date,writer_run_id:identity.writer_run_id,symbol:evidence.symbol,evidence}));range=`0-${data.length-1}/${data.length}`;}
  return {status:200,headers:{get:()=>range},json:async()=>data};};
 const options={sourceIntent,runtime,url:'https://isolated.invalid',key:'fake',hostId:'host',instanceId:'writer',tradeDate:identity.trade_date,guard:async()=>{},calendar:async()=>{},read:async table=>table==='source_status'?[row]:[{source_name:row.source_name,trade_date:identity.trade_date,writer_host_id:'host',writer_instance_id:denyLease?'other':'writer',lease_expires_at:'2099-01-01T00:00:00Z'}],invoke:async(script,args,env)=>{if(script==='run-daytrade-module-verifiers.js'){assert.equal(env.MOTHER_POOL_REQUIRED_WRITER_RUN_ID,identity.writer_run_id);return {exit_code:2};}captures++;assert.equal(script,'capture-daytrade-module-readbacks.js');assert(args.includes('--writer-run-id='+identity.writer_run_id));const index=JSON.parse(fs.readFileSync(args.find(x=>x.startsWith('--write-set-index=')).split('=').slice(1).join('=')));assert.deepEqual(index.modules.A01.plan.rows,input.rows);return {exit_code:0};}};
 let result=await run(options);assert.equal(result.complete,false);assert.equal(result.first_blocker.error,'RECOVERY_TWO_ROUND_VERIFICATION_INCOMPLETE');assert.equal(posts,1);assert.equal(captures,1);assert(!fs.existsSync(path.join(runtime,'state','daytrade-source-writer.cross-session.lock')));
 result=await run(options);assert.equal(posts,1);assert.equal(captures,2);
 const failed=await run({...options,invoke:async()=>{throw Error('capture process failed');}});assert.equal(failed.first_blocker.error,'RECOVERY_CAPTURE_OR_VERIFICATION_FAILED');assert.equal(JSON.parse(fs.readFileSync(failed.progress_file,'utf8')).capture_or_verification_error,'capture process failed');assert.equal(posts,1);
 denyLease=true;await assert.rejects(run(options),/OWNER_MISMATCH/);assert.equal(posts,1);assert.equal(captures,2);
 const lock=path.join(runtime,'state','daytrade-source-writer.cross-session.lock');fs.writeFileSync(lock,'other-owner');await assert.rejects(run(options),e=>e.code==='EEXIST');assert.equal(fs.readFileSync(lock,'utf8'),'other-owner');
 console.log('PASS recovery entry: fixed input -> persistence -> independent capture; restart no POST, lease rejection, competing lock preserved, never COMPLETE');
 }finally{global.fetch=originalFetch;const target=path.resolve(runtime);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('recovery-entry-'));fs.rmSync(target,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
