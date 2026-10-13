'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function create({root,epoch,connection_id,heads={},maxBatchBytes=1048576,maxBatchRecords=256,maxSidecarBytes=67108864,isolatedPauseAfterOpen=null}){
 if(!path.isAbsolute(root)||!epoch||!connection_id)throw Error('SEGMENT_BINDING');
 let failure=null,count=0,batch=null,io={writes:0,bytes:0,read_bytes:0};const chain=structuredClone(heads);
 const save=(name,p)=>{const bytes=Buffer.from(JSON.stringify(p));if(io.bytes+bytes.length>maxSidecarBytes)throw Error('SIDECAR_DISK_BUDGET');fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,name+'.json'),bytes,{flag:'wx'});io.writes++;io.bytes+=bytes.length;};
 function fail(e){failure=failure||e.code||e.message||String(e);}
 return {
 beginBatch(id,inputs){
  batch={id:crypto.randomUUID(),worker_batch_id:id,groups:new Map(),gaps:[],records:0,bytes:0,enabled:!failure};
  if(!batch.enabled)return;
  try{if(inputs.length>maxBatchRecords)throw Error('SEGMENT_BATCH_LIMIT');
   save(batch.id+'-open',{contract:'trade_segment_batch_v2',epoch,connection_id,batch_id:batch.id,worker_batch_id:id,status:'OPEN',inputs:inputs.map(r=>({symbol:r.data?.symbol,serial:r.data?.serial,received_at:r.receivedAt}))});
   if(isolatedPauseAfterOpen instanceof SharedArrayBuffer){const barrier=new Int32Array(isolatedPauseAfterOpen);Atomics.store(barrier,0,1);Atomics.wait(barrier,1,0,5000);}
  }catch(e){fail(e);batch.enabled=false;}
 },
 prepare({row,file,bytes}){try{
  if(!batch?.enabled)return null;
  if(++batch.records>maxBatchRecords||(batch.bytes+=bytes.length)>maxBatchBytes)throw Error('SEGMENT_BATCH_LIMIT');
  const key=row.trade_date+'/'+row.stock_id;
  let g=batch.groups.get(key);
  if(!g){if(Object.keys(chain).length+batch.groups.size>=10000)throw Error('CHAIN_KEY_LIMIT');const start=fs.existsSync(file)?fs.statSync(file).size:0;g={key,file,start,parts:[],rows:0,opened_at:row.received_at,closed_at:row.received_at,symbol:row.stock_id,trade_date:row.trade_date};batch.groups.set(key,g);}
  return {g,bytes,row};
 }catch(e){fail(e);batch.enabled=false;return null;}},
 stored(p){if(!p)return;p.g.parts.push(p.bytes);p.g.rows++;p.g.closed_at=p.row.received_at;},
 rejected(reason,data,received_at){if(!batch?.enabled)return;batch.gaps.push({reason,symbol:data?.symbol??null,serial:data?.serial??null,received_at});},
 failed(p,error){fail(error||'WRITE_FAILED');if(batch)batch.gaps.push({reason:error||'WRITE_FAILED',symbol:p?.row?.stock_id||null,received_at:p?.row?.received_at||null});},
 endBatch(){
  if(!batch)return;
  try{
   if(!batch.enabled)return;
   const proofs=[];
   for(const g of batch.groups.values()){
    const bytes=Buffer.concat(g.parts);if(!bytes.length)continue;
    const fd=fs.openSync(g.file,'r'),actual=Buffer.alloc(bytes.length);
    try{if(fs.readSync(fd,actual,0,actual.length,g.start)!==actual.length||!actual.equals(bytes))throw Error('APPEND_READBACK');io.read_bytes+=actual.length;}finally{fs.closeSync(fd);}
    const previous=chain[g.key]||null;
    if(previous&&previous.end_offset!==g.start)batch.gaps.push({reason:'OFFSET_CHAIN_GAP',symbol:g.symbol,expected:previous.end_offset,actual:g.start});
    const base={contract:'trade_segment_evidence_isolated_v1',epoch,connection_id,symbol:g.symbol,trade_date:g.trade_date,start_offset:g.start,end_offset:g.start+bytes.length,opened_at:g.opened_at,closed_at:g.closed_at,rows:g.rows,sha256:hash(bytes),previous_proof_hash:previous?.proof_hash||null,status:'SEALED',reason:null};
    const proof={...base,ack:{...base,status:'STORED'}};proof.proof_hash=hash(Buffer.from(JSON.stringify(proof)));
    proofs.push(proof);chain[g.key]={end_offset:proof.end_offset,proof_hash:proof.proof_hash};count+=g.rows;
   }
   save(batch.id+'-sealed',{contract:'trade_segment_batch_v2',epoch,connection_id,batch_id:batch.id,worker_batch_id:batch.worker_batch_id,status:failure||batch.gaps.length?'GAP':'SEALED',error:failure,gaps:batch.gaps,proofs});
   if(batch.gaps.length)failure=failure||'VALIDATION_OR_CHAIN_GAP';
  }catch(e){fail(e);}finally{batch=null;}
 },
 health(){return {status:failure?'GAP':'CAPTURED_ONLY',error:failure,sealed_records:count,heads:chain,io,continuity_verified:false};}
 };
}
module.exports={create};
