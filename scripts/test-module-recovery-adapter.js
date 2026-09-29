'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {create}=require('../lib/mother-pool-module-recovery-adapter');
const {resumeInput}=require('../lib/mother-pool-resume-module-input');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'module-http-recovery-'));
 try{
 const input={module_id:'A01',trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1,created_at:'2026-09-29T00:00:00Z',requested_symbols:Array.from({length:501},(_,i)=>String(1000+i))};
 input.rows=input.requested_symbols.map(symbol=>({symbol,status:'DATA_GAP',data_gap_reason:'isolated test',source:'test',source_contract:'test',source_updated_at:input.created_at,is_synthetic:false,replay:false,look_ahead:false}));
 for(const fault of ['none','range','identity','http','empty','changed']){
 const directory=path.join(root,fault);fs.mkdirSync(directory);let stored,posts=0,reads=0;
 const fetchImpl=async(raw,opts)=>{
  const u=new URL(raw);if(opts.method==='POST'){posts++;stored=JSON.parse(JSON.parse(opts.body).p_document);throw Object.assign(Error('lost response'),{name:'TimeoutError'});}
  assert.equal(u.searchParams.get('limit'),'500');assert.equal(u.searchParams.get('writer_run_id'),'eq.w');reads++;
  let data=[],range='*/0',status=200;
  if(stored){if(u.pathname.endsWith('round_v2')){data=[{module_id:'A01',trade_date:input.trade_date,writer_run_id:'w',document:stored,committed_at:input.created_at}];range='0-0/1';}
  else{const offset=Number(u.searchParams.get('offset'));data=stored.plan.rows.slice(offset,offset+500).map(evidence=>({module_id:'A01',trade_date:input.trade_date,writer_run_id:'w',symbol:evidence.symbol,evidence}));range=`${offset}-${offset+data.length-1}/501`;if(fault==='range')range='*/*';if(fault==='identity')data[0].writer_run_id='other';if(fault==='http')status=503;if(fault==='empty')data=[];if(fault==='changed'&&offset)range='500-500/500';}}
  return {status,headers:{get:()=>range},json:async()=>data};
 };
 const adapter=()=>create({url:'https://isolated.invalid',key:'fake',directory,guard:async()=>{},assertLease:async()=>{},fetchImpl});
 if(fault==='none'){const result=await resumeInput(input,adapter());assert.equal(result.ack.written_symbols.length,501);await resumeInput(input,adapter());assert(reads>=8);}
 else await assert.rejects(resumeInput(input,adapter()),/MODULE_RECOVERY/);
 assert.equal(posts,1);
 }
 const legacyDir=path.join(root,'legacy');fs.mkdirSync(legacyDir);
 let plan;await require('../lib/persist-mother-pool-module-round').persistModuleRound(input,{savePlan:async d=>{plan=d;},persist:async()=>{throw Error('capture-only');},saveEvidence:async()=>{}}).catch(e=>{assert.equal(e.message,'capture-only');});
 fs.writeFileSync(path.join(legacyDir,'old-plan.json'),JSON.stringify(plan));
 let legacyPosts=0;
 const legacy=create({url:'https://isolated.invalid',key:'fake',directory:legacyDir,guard:async()=>{},assertLease:async()=>{},fetchImpl:async(_url,opts)=>{if(opts.method==='POST')legacyPosts++;return {status:200,headers:{get:()=>'*/0'},json:async()=>[]};}});
 await assert.rejects(resumeInput(input,legacy),/PREVIOUS_ATTEMPT_UNCONFIRMED/);assert.equal(legacyPosts,0);
 fs.writeFileSync(path.join(legacyDir,'old-plan.json'),'{broken');await assert.rejects(resumeInput(input,legacy),SyntaxError);assert.equal(legacyPosts,0);
 console.log('PASS recovery HTTP adapter: 500-row pagination, lost response exact ACK, restart no POST, range/identity/HTTP/truncation failures rejected');
 }finally{const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('module-http-recovery-'));fs.rmSync(target,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
