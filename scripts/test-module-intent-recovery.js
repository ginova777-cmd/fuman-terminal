'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {recover}=require('./recover-daytrade-module-intent-readonly'),{hash}=require('../lib/mother-pool-module-write-set');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'module-recovery-'));
const plan={created_at:'2026-09-29T01:00:00Z',requested_symbols:Array.from({length:501},(_,i)=>String(1000+i)),rows:Array.from({length:501},(_,i)=>({symbol:String(1000+i),value:i}))};
const doc={contract:'mother_pool_module_write_set_v1',module_id:'A07',trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g',mother_pool_run_id:'m',snapshot_generation:'s',snapshot_sequence:1,plan,plan_hash:hash(plan)};
const file=path.join(root,'intent.json');fs.writeFileSync(file,JSON.stringify(doc));const sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function attempt(mode){let calls=0,guarded=false;const out=path.join(root,mode+'.json');
 try{const result=await recover({file,sha256:mode==='hash'?'0'.repeat(64):sha256,out,url:'https://isolated.invalid',key:'isolated',guard:async()=>{if(mode==='guard')throw Error('INCIDENT');guarded=true;},fetchImpl:async(url,options)=>{
  assert(guarded);calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(url.searchParams.get('writer_run_id'),'eq.w');assert.equal(url.searchParams.get('limit'),'500');
  const isRound=url.pathname.endsWith('round_v2'),offset=Number(url.searchParams.get('offset'));
  let data=isRound?[{module_id:'A07',trade_date:doc.trade_date,writer_run_id:'w',document:structuredClone(doc),committed_at:'2026-09-29T01:00:01Z'}]:plan.rows.slice(offset,offset+500).map(evidence=>({module_id:'A07',trade_date:doc.trade_date,writer_run_id:'w',symbol:evidence.symbol,evidence:{...evidence}}));
  if(mode==='identity'&&isRound)data[0].document.generation_id='new';
  if(mode==='content'&&!isRound)data[0].evidence.value=-1;
  if(mode==='duplicate'&&!isRound&&offset===500)data[0].symbol='1000';
  if(mode==='empty')data=[];
  const total=isRound?1:501,range=mode==='range'?'0-999/1000':`${offset}-${offset+data.length-1}/${total}`;
  return {status:mode==='http'?503:200,json:async()=>data,headers:{get:()=>range}};
 }});return {result,calls,out};}catch(error){return {error,calls,out};}
}
(async()=>{
 const good=await attempt('ok');assert.equal(good.calls,3);assert.equal(good.result.written,501);assert.equal(good.result.complete,false);const evidence=JSON.parse(fs.readFileSync(good.out));assert.equal(evidence.recovery.pages.length,3);assert.equal(evidence.ack.acknowledgement_mode,'exact_readback_after_interruption');
 for(const mode of ['hash','guard','http','identity','content','duplicate','range','empty']){const r=await attempt(mode);assert(r.error,mode);assert(!fs.existsSync(r.out),mode);if(['hash','guard'].includes(mode))assert.equal(r.calls,0);if(mode==='identity')assert.equal(r.calls,1);}
 await assert.rejects(recover({file,sha256,out:good.out,url:'https://isolated.invalid',key:'isolated',guard:async()=>assert.fail('must not query existing output')}),/OUTPUT_ALREADY_EXISTS/);
 console.log('PASS 501-row exact recovery, guard before GET, hash/identity/content/page/duplicate rejection and no overwrite; no production I/O.');
})().catch(e=>{console.error(e);process.exitCode=1;});
