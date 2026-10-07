'use strict';
// Explicit offline/full-cache recovery. Never called in the WS or ACK path.
// A baseline is not a replay of lost intents and never creates prepare/commit files.
const fs=require('node:fs'),path=require('node:path');
const {sha,keyOf,durable}=require('./mother-change-evidence.cjs');
const CONTRACT='mother-evidence-full-cache-recovery-v2-c2';
function boundedRead(file,maxBytes){const stat=fs.statSync(file);if(!stat.isFile()||stat.size>maxBytes)throw Error('RECOVERY_FILE_LIMIT');const bytes=fs.readFileSync(file);if(bytes.length>maxBytes)throw Error('RECOVERY_FILE_LIMIT');return bytes;}
function checkCache(bytes,kind){
 const data=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')),rows=data[kind==='quote'?'quotes':'candles'];
 if(!Array.isArray(rows))throw Error('RECOVERY_FULL_CACHE_INVALID');
 const keys=new Set();for(const row of rows){const key=keyOf(row,kind).key;if(keys.has(key))throw Error('RECOVERY_DUPLICATE_KEY');keys.add(key);}
 return rows.length;
}
function recover({cacheFile,kind,targetEpoch,targetDir,out,previousDir=null,bootstrap=false,maxBytes=512*1024*1024}){
 if(!['quote','candle'].includes(kind)||!targetEpoch||(!previousDir&&!bootstrap))throw Error('RECOVERY_CONTEXT_REQUIRED');
 if(fs.existsSync(targetDir)&&fs.readdirSync(targetDir).length)throw Error('RECOVERY_REQUIRES_NEW_EMPTY_EPOCH_DIRECTORY');
 if(previousDir&&path.resolve(previousDir)===path.resolve(targetDir))throw Error('RECOVERY_OLD_EVIDENCE_IMMUTABLE');
 fs.mkdirSync(out,{recursive:false});
 const previous=[];if(previousDir)for(const name of fs.readdirSync(previousDir).sort()){
  const file=path.join(previousDir,name);if(!fs.statSync(file).isFile())throw Error('RECOVERY_UNEXPECTED_DIRECTORY');
  const bytes=boundedRead(file,maxBytes);previous.push({file,bytes:bytes.length,sha256:sha(bytes)});
  if(name==='owner.lock'&&JSON.parse(bytes).epoch===targetEpoch)throw Error('RECOVERY_REQUIRES_NEW_EPOCH');
 }
 const bytes=boundedRead(cacheFile,maxBytes),count=checkCache(bytes,kind),snapshot=path.join(out,'full-cache-baseline.json');
 const fd=fs.openSync(snapshot,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const receipt={contract:CONTRACT,status:'FULL_CACHE_RECOVERY_COMPLETE',evidence_state:'GAP/CONTINUITY_UNKNOWN',continuous:false,lost_intent_count:null,lost_intents_reconstructed:0,gap_closed:false,kind,target_epoch:targetEpoch,target_dir:path.resolve(targetDir),previous_dir:previousDir?path.resolve(previousDir):null,previous_files:previous,reason:bootstrap?'BOOTSTRAP_PRIOR_CONTINUITY_UNKNOWN':'VOLATILE_INTENTS_MAY_HAVE_BEEN_LOST',recovered_at:new Date().toISOString(),source_cache:path.resolve(cacheFile),baseline_file:snapshot,baseline_sha256:sha(bytes),baseline_bytes:bytes.length,baseline_rows:count,scope:'Full current cache checkpoint only; not event history, not first availability, not gap repair',max_bytes:maxBytes};
 const file=path.join(out,'recovery-receipt.json');durable(file,receipt);
 return {path:file,sha256:sha(fs.readFileSync(file))};
}
function verify(reference,{epoch,kind,dir,recoverySourceCache}){
 if(!reference?.path||!reference.sha256)throw Error('FULL_CACHE_RECOVERY_REQUIRED');
 const bytes=boundedRead(reference.path,16*1024*1024);if(sha(bytes)!==reference.sha256)throw Error('RECOVERY_RECEIPT_HASH_MISMATCH');
 const r=JSON.parse(bytes);
 if(recoverySourceCache&&path.resolve(r.source_cache||'')!==path.resolve(recoverySourceCache))throw Error('RECOVERY_SOURCE_CACHE_MISMATCH');
 if(r.contract!==CONTRACT||r.status!=='FULL_CACHE_RECOVERY_COMPLETE'||r.evidence_state!=='GAP/CONTINUITY_UNKNOWN'||r.continuous!==false||r.gap_closed!==false||r.lost_intents_reconstructed!==0||r.target_epoch!==epoch||r.kind!==kind||r.target_dir!==path.resolve(dir)||!Number.isSafeInteger(r.max_bytes)||r.max_bytes<1||r.max_bytes>512*1024*1024)throw Error('RECOVERY_IDENTITY_INVALID');
 const snapshot=boundedRead(r.baseline_file,r.max_bytes);
 if(sha(snapshot)!==r.baseline_sha256||snapshot.length!==r.baseline_bytes||checkCache(snapshot,kind)!==r.baseline_rows)throw Error('RECOVERY_BASELINE_INVALID');
 for(const f of r.previous_files){const b=boundedRead(f.file,r.max_bytes);if(sha(b)!==f.sha256||b.length!==f.bytes)throw Error('OLD_EVIDENCE_CHANGED_SINCE_RECOVERY');}
 return r;
}
module.exports={recover,verify};
