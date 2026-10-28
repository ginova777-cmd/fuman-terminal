'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'refresh-proof-'));process.env.FUMAN_RUNTIME_DIR=runtime;
const proof=require('../lib/opening-report-refresh-proof.cjs'),evidence=require('../lib/opening-report-writer-refresh-evidence');
const {observeWriterRefreshes}=require('./verify-opening-report-0830-mother-pool-persistence-ack');
const date='2026-10-05',after=Date.now()-60000;
const handoff=path.join(runtime,'data/opening-report-stages/us_0820/scan-receipts/opening-report-0830-mother-pool-handoff-ack-20261005.json');fs.mkdirSync(path.dirname(handoff),{recursive:true});fs.writeFileSync(handoff,JSON.stringify({complete:true,trade_date:date,report_run_id:'morning',checked_at:new Date(after).toISOString(),accepted_symbols:[]}));
const snapshot={trade_date:date,canonical_run_id:'canonical',run_id:'snapshot-7',generation:'snapshot-7',snapshot_sequence:7,complete:true,symbol_count:1,symbols:['2330']};
let calls=0;
async function round(id,mode='good'){
 const identity={writer_run_id:'writer-'+id,generation_id:'writer-gen-'+id},rows=[{symbol:'2330',payload:{...identity,trade_date:date,canonical_run_id:'canonical'}},{symbol:'1301',payload:{...identity,trade_date:date,canonical_run_id:'canonical'}}];
 const send=async ({resource})=>{calls++;if(mode==='http')throw Error('REFRESH_HTTP_522');const data=resource.startsWith('v_')?[{symbol:'2330',trade_date:date,canonical_run_id:'canonical',mother_pool_run_id:snapshot.run_id,generation:mode==='mixed'?'wrong':snapshot.generation,snapshot_sequence:7,complete:true}]:rows.map(proof.projection);return {status:200,range:mode==='range'?'0-0/99':`0-${data.length-1}/${data.length}`,raw:Buffer.from(JSON.stringify(data))};};
 const p=await proof.capture({runtime,date,identity,rows,membershipSymbols:['2330'],snapshot,url:'fixture',serviceKey:'service',anonKey:'anon',events:evidence.readAfter(runtime,date,after),send});
 evidence.record({runtime,date,identity,rows,proof:p});return p;
}
function saveTerminal(id){
 const crypto=require('crypto'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const event=evidence.readAfter(runtime,date,after).find(e=>e.writer_run_id==='writer-'+id);
 const dir=path.join(runtime,'data','writer-terminals',date);fs.mkdirSync(dir,{recursive:true});
 const end=new Date().toISOString(),identity={trade_date:date,canonical_run_id:'canonical',writer_run_id:event.writer_run_id,generation_id:event.generation_id,snapshot_generation:'snapshot-7',snapshot_sequence:7};
 const wrapper='fixture-wrapper-'+id;
 const raws={verifier:{ok:true,trade_date:date,verifier_ok:true,closed_loop_ok:true,canonical_run_id:'canonical',publication:{status:'POST_ACKNOWLEDGED',acknowledged_at:end}},refresh:{ok:true,trade_date:date,wrapper_run_id:wrapper,completed_at:end}};
 const input={identity,startedAt:new Date(after+1).toISOString(),completedAt:end,exitCode:0,status:'SUCCESS'};
 for(const kind of ['verifier','refresh']){const bytes=Buffer.from(JSON.stringify(raws[kind])),digest=hash(bytes);fs.writeFileSync(path.join(dir,digest+'.raw'),bytes);const payload={raw_sha256:digest};input[kind]={identity,success:true,completed_at:end,payload,hash:require('../lib/mother-pool-preopen-v11.cjs').hash(payload)};}
 const receipt=require('../lib/mother-pool-preopen-module-evidence.cjs').terminalEvidence(input);
 const file=path.join(dir,hash(identity.writer_run_id)+'.json');fs.writeFileSync(file,JSON.stringify({contract:'mother_pool_writer_terminal_v11',wrapper_run_id:wrapper,input,receipt}));return file;
}
(async()=>{
 let p=await round('1');assert.equal(p.complete,true);assert.equal((await observeWriterRefreshes(after,2,0,date,[],'morning')).length,0,'readback without terminal rejected');const terminal1=saveTerminal('1');const saved=JSON.parse(fs.readFileSync(p.files.find(f=>f.kind==='expected').path));assert.deepStrictEqual(saved.membership_symbols,['2330']);assert.deepStrictEqual(saved.write_only_symbols,['1301']);assert.equal(calls,3);assert.equal((await observeWriterRefreshes(after,2,0,date,[],'morning')).length,1,'zero requested still needs two verified rounds');
 p=await round('2','mixed');assert.equal(p.complete,false);assert.equal((await observeWriterRefreshes(after,2,0,date,[],'morning')).length,1);
 let before=calls;p=await round('3','http');assert.equal(p.complete,false);assert.equal(calls-before,1,'first HTTP error stops');
 p=await round('4','range');assert.equal(p.complete,false);
 p=await round('5');assert.equal(p.complete,true);assert.equal((await observeWriterRefreshes(after,2,0,date,[],'morning')).length,1,'second readback alone insufficient');const terminal5=saveTerminal('5');assert.equal((await observeWriterRefreshes(after,2,0,date,[],'morning')).length,2);
 assert.equal((await observeWriterRefreshes(after,2,0,date,[],'other')).length,0,'wrong report cannot reuse proof');
 const original=fs.readFileSync(terminal5);fs.writeFileSync(terminal5,'{}');assert.equal((await observeWriterRefreshes(after,2,0,date,[],'morning')).length,1,'invalid terminal rejected');fs.writeFileSync(terminal5,original);assert.equal((await observeWriterRefreshes(after,2,0,date,[],'morning')).length,2);before=calls;p=await round('6');assert.equal(p.status,'NOT_REQUIRED');assert.equal(calls,before,'after two good rounds no HTTP');
 const events=evidence.readAfter(runtime,date,after),good=events.find(e=>e.generation_id==='writer-gen-1');const file=good.readback_proof.files.find(f=>f.kind==='anon').path;fs.appendFileSync(file,' ');assert.equal(proof.verified(runtime,good,'morning'),false,'modified raw bytes rejected');
 assert.equal((await observeWriterRefreshes(after,2,0,date,[],'morning')).length,1);
 console.log('PASS per-round service/anon/snapshot proof; wrong generation, truncation, HTTP stop, hash tamper, report binding, zero requested and two-round quota');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(runtime,{recursive:true,force:true}));

