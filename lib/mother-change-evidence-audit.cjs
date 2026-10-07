'use strict';
// Read-only replay/audit. No consumer cursor and no publication or GC authority.
const fs=require('node:fs'),path=require('node:path');
const {CONTRACT,sha,projection,validateBatch,validateSaved}=require('./mother-change-evidence.cjs');
function audit(dir){
 const names=fs.readdirSync(dir),final=new Map();let sequence=0,events=0;
 if(names.some(n=>n.endsWith('.tmp')))throw Error('PARTIAL_EVIDENCE');
 for(const n of names.filter(n=>/^\d{12}\.prepare\.json$/.test(n)).sort()){
  const batch=JSON.parse(fs.readFileSync(path.join(dir,n))),body={...batch};delete body.batch_hash;
  validateBatch(batch);
  if(batch.sequence!==sequence+1||sha(body)!==batch.batch_hash)throw Error('PREPARE_SEQUENCE_OR_HASH');
  const stem=n.replace('.prepare.json',''),saved=JSON.parse(fs.readFileSync(path.join(dir,stem+'.saved.json'))),commit=JSON.parse(fs.readFileSync(path.join(dir,stem+'.commit.json')));
  validateSaved(batch,saved);
  for(const part of [saved,commit])if(part.sequence!==batch.sequence||part.batch_id!==batch.batch_id||part.collector_epoch!==batch.collector_epoch||part.batch_hash!==batch.batch_hash)throw Error('IDENTITY_MISMATCH');
  if(commit.status!==(batch.contract===CONTRACT?'COMMITTED':'DURABLE_COMMITTED')||commit.commit_sequence!==batch.sequence||commit.saved_hash!==sha(saved)||!saved.shadow_audit.ok)throw Error('COMMIT_NOT_VERIFIED');
  if(saved.confirmed_rows_sha256){
   const proof=saved.original_ack;
   if(!proof||!proof.original_ack||!proof.ok||proof.collector_epoch!==batch.collector_epoch||proof.token!==batch.context.token||sha(proof.rows_json)!==saved.confirmed_rows_sha256)throw Error('CONFIRMATION_NOT_VERIFIED');
   const boundary=batch.contract===CONTRACT?saved.prepared_durable_ns:batch.context.intent.frozen_ns;
   if(BigInt(boundary)>BigInt(proof.cache_started_ns)||BigInt(proof.cache_started_ns)>BigInt(proof.cache_finished_ns))throw Error('CONFIRMATION_ORDER_INVALID');
  }
  for(const e of batch.events){
   const previous=final.get(e.key);
   if(e.sequence!==batch.sequence||e.batch_id!==batch.batch_id||e.collector_epoch!==batch.collector_epoch||sha(projection(e.payload,batch.kind))!==e.content_hash)throw Error('EVENT_HASH_OR_IDENTITY');
   if(e.revision!==(previous?.revision||0)+1||previous&&previous.content_hash!==e.previous_hash)throw Error('REVISION_CHAIN');
   final.set(e.key,{...e,persisted_time:saved.persisted_at,commit_sequence:commit.commit_sequence});events++;
  }
  sequence=batch.sequence;
 }
 for(const n of names.filter(n=>/^\d{12}\.(saved|commit)\.json$/.test(n)))if(!names.includes(n.replace(/\.(saved|commit)\.json$/,'.prepare.json')))throw Error('ORPHAN_EVIDENCE');
 return {ok:true,scope:'retained committed batches only; not whole-process continuity',continuity:'GAP/CONTINUITY_UNKNOWN',continuous:false,sequence,events,unique_keys:final.size,final};
}
module.exports={audit};
