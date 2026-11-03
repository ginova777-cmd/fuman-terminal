'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {identityFields}=require('./mother-pool-module-write-set');
const parents=['A15','A16','A17'];
async function run({identity,symbols,captures,runtime,selected,persist,capture,now=()=>new Date().toISOString()}) {
  const result={status:'WAITING',accepted:false};
  function authorized(){const ids=selected();return ['A18',...parents].every(id=>ids.includes(id));}
  if(!authorized())return {...result,first_blocker:'A18_OR_PARENTS_NOT_AUTHORIZED'};
  const asOf=now(),time=Date.parse(asOf);
  if(!Number.isFinite(time))return {...result,status:'BLOCKED',first_blocker:'INVALID_TIME'};
  const local=new Date(time+28800000).toISOString();
  if(local.slice(0,10)!==identity.trade_date||local.slice(11,16)<'08:59'||local.slice(11,16)>='09:00')return {...result,first_blocker:'OUTSIDE_A18_PREOPEN_SLOT'};
  const references={},sets={},root=path.resolve(runtime,'data','scan-receipts','modules')+path.sep;
  try {
    for(const c of captures){if(c.status!==0)continue;let doc;try{doc=JSON.parse(c.stdout||'{}');}catch{continue;}
      for(const item of doc.results||[])if(parents.includes(item.module_id)){
        if(references[item.module_id])throw Error('DUPLICATE_PARENT_REFERENCE:'+item.module_id);
        references[item.module_id]=item.file;
      }
    }
    const evidence={};
    for(const id of parents){
      const file=path.resolve(references[id]||'');
      if(!file.toLowerCase().startsWith(root.toLowerCase()))throw Error('PARENT_REFERENCE_MISSING_OR_OUTSIDE_RUNTIME:'+id);
      const bytes=fs.readFileSync(file),round=require('./daytrade-shared-evidence.cjs').read(file,runtime);
      if(round.module_id!==id||identityFields.some(k=>round[k]!==identity[k]))throw Error('PARENT_IDENTITY_MISMATCH:'+id);
      if(!Number.isFinite(Date.parse(round.captured_at))||Date.parse(round.captured_at)>time)throw Error('PARENT_CAPTURE_TIME_INVALID:'+id);
      if(!require('./verify-mother-pool-module-round').createVerifier(id).validRound(round))throw Error('PARENT_FULL_VERIFIER_FAILED:'+id);
      sets[id]=round.writer_write_set;
      evidence[id]={file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    }
    const input=require('./mother-pool-preopen-quality').collect({identity,symbols,parents:sets,asOf});
    if(input.rows.some(row=>row.status!=='READY'))throw Error('PARENT_WRITE_SET_NOT_READY');
    if(!authorized())throw Error('AUTHORIZATION_CHANGED_BEFORE_WRITE');
    const saved=await persist(input);
    if(!authorized())throw Error('AUTHORIZATION_CHANGED_BEFORE_READBACK');
    const readback=await capture('A18',saved);
    if(readback.status!==0)return {status:'READBACK_BLOCKED',accepted:false,parent_evidence:evidence,capture:readback};
    const output=JSON.parse(readback.stdout||'{}'),items=(output.results||[]).filter(item=>item.module_id==='A18');
    if(items.length!==1)throw Error('A18_READBACK_REFERENCE_REQUIRED');
    const file=path.resolve(items[0].file||'');
    if(!file.toLowerCase().startsWith(root.toLowerCase()))throw Error('A18_READBACK_PATH_INVALID');
    const round=require('./daytrade-shared-evidence.cjs').read(file,runtime);
    if(round.module_id!=='A18'||identityFields.some(k=>round[k]!==identity[k])||round.writer_write_set?.plan_hash!==saved.plan_hash)throw Error('A18_READBACK_IDENTITY_MISMATCH');
    if(!require('./verify-mother-pool-module-round').createVerifier('A18').validRound(round))throw Error('A18_FULL_VERIFIER_FAILED');
    return {status:'A18_ROUND_VERIFIED_PENDING_FORMAL_ACCEPTANCE',accepted:false,parent_evidence:evidence,capture:readback};
  }catch(error){return {...result,status:'BLOCKED',first_blocker:String(error.message)};}
}
module.exports={run};
