'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function create({runtime,releaseSha,journalFactory=require('./provider-journal-background.cjs').createJournal,clock=()=>new Date().toISOString()}){
 const epoch=crypto.randomUUID(),root=path.join(runtime,'data/provider-trade-evidence',epoch);
 let current=null,last=null,writing=false,failure=null,transition=Promise.resolve(),pending=0;
 async function stop(){const c=current;current=null;last=null;if(c)try{await c.journal.close();}catch(e){failure=e.code||e.message;}}
 function sequence(fn){pending++;transition=transition.then(fn).catch(e=>{failure=e.code||e.message;}).finally(()=>{pending--;});return transition;}
 return {
  open(connection,at){return sequence(async()=>{
   await stop();const id=crypto.randomUUID(),dir=path.join(root,id);last=null;
   try{await fsp.mkdir(dir,{recursive:true});current={id,connection,opened_at:at,dir,journal:journalFactory(path.join(runtime,'data/provider-trade-journal'),{kind:'trade',segmentEvidence:{root:dir,epoch,connection_id:connection,evidenceContract:'trade_segment_evidence_formal_v1'}})};}
   catch(e){failure=e.code||'FORMAL_EVIDENCE_UNAVAILABLE';current={id,connection,opened_at:at,dir,journal:journalFactory(path.join(runtime,'data/provider-trade-journal'),{kind:'trade'})};}
  });},
  capture(data,at){if(pending){failure='CAPTURE_DURING_CONNECTION_TRANSITION';return {queued:false,reason:failure};}return current?current.journal.capture(data,at):{queued:false,reason:'FORMAL_TRADE_CONNECTION_NOT_OPEN'};},
  health(){
   const h=current?.journal.health();
   if(current&&!pending&&!writing&&h?.ok===true&&h.queued_records===0&&h.segment_evidence?.status==='CAPTURED_ONLY'&&!h.gap_evidence?.total&&!h.gap_evidence?.error){
    const c=current,through=clock(),cp={contract:'formal_live_trade_checkpoint_v1',epoch,session_id:c.id,connection_id:c.connection,release_sha:releaseSha,opened_at:c.opened_at,through_at:through,health:structuredClone(h)};
    const bytes=Buffer.from(JSON.stringify(cp)),sha256=hash(bytes),file=path.join(c.dir,'checkpoint-current.json'),tmp=file+'.tmp';writing=true;
    fsp.writeFile(tmp,bytes).then(()=>fsp.rename(tmp,file)).then(()=>{if(current===c)last={file,sha256,epoch,session_id:c.id,connection_id:c.connection,through_at:through,release_sha:releaseSha};}).catch(e=>{failure=e.code||'CHECKPOINT_WRITE_FAILED';}).finally(()=>{writing=false;});
   }
   return {contract:'formal_live_trade_capture_v1',epoch,connection_id:current?.connection||null,status:failure?'GAP':pending?'TRANSITION':current?'OPEN':'CLOSED',error:failure,checkpoint:last,current:h};
  },
  close(){return sequence(stop);},
 };
}
function configured({runtime,repo}){
 const fallback=()=>require('./provider-journal-background.cjs').createJournal(path.join(runtime,'data/provider-trade-journal'),{kind:'trade'});
 try{
  const p=JSON.parse(fs.readFileSync(path.join(runtime,'config/daytrade-module-recovery-policy.json'),'utf8'));
  const date=new Date(Date.now()+28800000).toISOString().slice(0,10);
  if(p.trade_date!==date)return fallback();
  const sha=require('node:child_process').execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
  const evaluated=require('./daytrade-module-recovery-policy.cjs').evaluate(p,require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json'),{release_sha:sha,trade_date:date});
  if(evaluated.probe!=='B22'&&!evaluated.enabled.includes('B22')&&!evaluated.supply_only?.includes('B22'))return fallback();
  return create({runtime,releaseSha:sha});
 }catch{return fallback();}
}
module.exports={create,configured};
