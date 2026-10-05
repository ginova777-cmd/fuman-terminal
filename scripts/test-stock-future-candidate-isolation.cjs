'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {run}=require('../lib/stock-future-candidate-isolation.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-isolation-'));fs.mkdirSync(path.join(root,'state'));let clock=Date.parse('2026-10-05T00:20:00Z'),calls=0;
const writeJson=(f,v)=>fs.writeFileSync(f,JSON.stringify(v));const opts={root,tradeDate:'2026-10-05',writerRunId:'writer',apply:true,leaseValid:()=>true,writeJson,now:()=>clock,operation:async()=>{calls++;throw Object.assign(Error('request aborted'),{name:'AbortError'});}};
(async()=>{
 for(const minutes of [1,2,4,5,5]){const r=await run(opts);assert.equal(r.publication_ok,false);assert.equal(r.complete,false);assert.equal(Date.parse(r.next_retry_at)-clock,minutes*60000);const n=calls;assert.equal((await run(opts)).status,'backoff');assert.equal(calls,n);clock=Date.parse(r.next_retry_at);}
 const pending=path.join(root,'state/stock-future-candidate-pending.json');writeJson(pending,{revision:'saved',payload:{exact:'bytes'}});const before=fs.readFileSync(pending,'utf8');
 const ok=await run({...opts,operation:async()=>({status:'unchanged',revision:'saved'})});assert.equal(ok.publication_ok,true);assert.equal(ok.failures,0);assert.equal(ok.complete,false);assert.equal(fs.readFileSync(pending,'utf8'),before);
 await assert.rejects(()=>run({...opts,leaseValid:()=>false}),/LEASE/);
 await assert.rejects(()=>run({...opts,operation:async()=>{throw Error('CANDIDATE_WRITER_LEASE_EXPIRED');}}),/LEASE/);
 const result=await run({...opts,operation:async()=>({status:'source_blocked',reason:'SOURCE_FAILED'})});assert.equal(result.publication_ok,false);assert.equal(result.failures,1);
 let dryCalls=0;await run({...opts,apply:false,operation:async()=>dryCalls++});assert.equal(dryCalls,0);
 // Execute the real Writer call-site fragment, proving a publication rejection reaches
 // the following core work and remains represented in nonfatal errors.
 const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');const begin=source.indexOf('  const stockFutureCandidates = await');const end=source.indexOf('  const state = readWriterState();',begin);assert.ok(begin>0&&end>begin);
 const root2=fs.mkdtempSync(path.join(os.tmpdir(),'candidate-callsite-'));fs.mkdirSync(path.join(root2,'state'));let stage;
 const ctx={require:p=>p.includes('isolation')?{run}:p.includes('publish-stock')?{publish:async()=>{throw Object.assign(Error('HTTP 403'),{name:'Error'});}}:require(p),runtimePath:()=>root2,taipeiDate:()=>opts.tradeDate,writerTickIdentity:{writer_run_id:'natural-fixture'},APPLY:true,DRY_RUN:false,writeJsonAtomic:writeJson,writerLease:{ok:true,status:'claimed',leaseExpiresAt:new Date(Date.now()+600000).toISOString()},FUGLE_API_KEY:'fixture',tickStage:(name,e)=>{stage=e;},Date,URLSearchParams};
 const r=await vm.runInNewContext('(async()=>{'+source.slice(begin,end)+'return {core_can_continue:true,stockFutureCandidates};})()',ctx);assert.equal(r.core_can_continue,true);assert.equal(r.stockFutureCandidates.publication_ok,false);assert.equal(stage.ok,false);
 const line=source.split('\n').find(x=>x.includes('const nonFatalWriteErrors = stockFutureCandidates'));assert.ok(line);const errors=Function('stockFutureCandidates',line+';return nonFatalWriteErrors;')(r.stockFutureCandidates);assert.equal(errors.length,1);assert.equal(errors[0].complete,false);assert.ok(source.includes('result.payload.stock_future_candidate_publication = stockFutureCandidates;'));
 console.log('PASS bounded 1/2/4/5 minute backoff, no calls during wait, success reset, pending bytes retained, lease stops, real Writer call-site core continuation and explicit failed module');
})().catch(e=>{console.error(e);process.exitCode=1;});
