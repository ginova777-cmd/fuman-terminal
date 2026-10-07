'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {sha,durable}=require('./mother-change-evidence.cjs');
const {inspect,hashFile}=require('./mother-evidence-recovery-stream.cjs');
const CONTRACT='mother-evidence-full-cache-recovery-v3-c2-capacity';
function small(file,max=16*1048576){const s=fs.statSync(file);if(!s.isFile()||s.size>max)throw Error('RECOVERY_FILE_LIMIT');const b=fs.readFileSync(file);if(b.length>max)throw Error('RECOVERY_FILE_LIMIT');return b;}
function recover({cacheFile,kind,targetEpoch,targetDir,out,previousDir=null,bootstrap=false,maxBytes=512*1048576,streamLimits={},fault=()=>{}}){
 if(!['quote','candle'].includes(kind)||!targetEpoch||(!previousDir&&!bootstrap))throw Error('RECOVERY_CONTEXT_REQUIRED');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>512*1048576)throw Error('RECOVERY_FILE_LIMIT');
 if(fs.existsSync(targetDir)&&fs.readdirSync(targetDir).length)throw Error('RECOVERY_REQUIRES_NEW_EMPTY_EPOCH_DIRECTORY');
 if(previousDir&&path.resolve(previousDir)===path.resolve(targetDir))throw Error('RECOVERY_OLD_EVIDENCE_IMMUTABLE');
 fs.mkdirSync(out,{recursive:false});const previous=[];
 if(previousDir){const names=[],directory=fs.opendirSync(previousDir);try{for(let e;(e=directory.readSync());){if(names.length>=4096)throw Error('RECOVERY_PREVIOUS_INDEX_LIMIT');names.push(e.name);}}finally{directory.closeSync();}names.sort();for(const name of names){const file=path.join(previousDir,name);if(!fs.lstatSync(file).isFile())throw Error('RECOVERY_UNEXPECTED_DIRECTORY');const h=hashFile(file,maxBytes);previous.push({file,...h});if(name==='owner.lock'&&JSON.parse(small(file,4096)).epoch===targetEpoch)throw Error('RECOVERY_REQUIRES_NEW_EPOCH');}}
 const snapshot=path.join(out,'full-cache-baseline.json'),tmp=snapshot+'.tmp';fault('before_copy');const copied=hashFile(cacheFile,maxBytes,tmp);fault('after_copy');
 const validated=inspect(tmp,kind,maxBytes,path.join(out,'keys-validate'),streamLimits);fault('after_sort');if(validated.sha256!==copied.sha256||validated.bytes!==copied.bytes)throw Error('RECOVERY_BASELINE_INVALID');
 fs.renameSync(tmp,snapshot);fault('after_rename');const readback=inspect(snapshot,kind,maxBytes,path.join(out,'keys-readback'),streamLimits);if(readback.sha256!==copied.sha256||readback.rows!==validated.rows)throw Error('RECOVERY_BASELINE_INVALID');
 const receipt={contract:CONTRACT,status:'FULL_CACHE_RECOVERY_COMPLETE',evidence_state:'GAP/CONTINUITY_UNKNOWN',continuous:false,lost_intent_count:null,lost_intents_reconstructed:0,gap_closed:false,kind,target_epoch:targetEpoch,target_dir:path.resolve(targetDir),previous_dir:previousDir?path.resolve(previousDir):null,previous_files:previous,reason:bootstrap?'BOOTSTRAP_PRIOR_CONTINUITY_UNKNOWN':'VOLATILE_INTENTS_MAY_HAVE_BEEN_LOST',recovered_at:new Date().toISOString(),source_cache:path.resolve(cacheFile),baseline_file:snapshot,baseline_sha256:copied.sha256,baseline_bytes:copied.bytes,baseline_rows:validated.rows,validation:readback,scope:'Full current cache checkpoint only; not event history, not first availability, not gap repair',max_bytes:maxBytes};
 const file=path.join(out,'recovery-receipt.json');fault('before_receipt');durable(file,receipt);fault('after_receipt');return {path:file,sha256:sha(small(file))};
}
function verify(reference,{epoch,kind,dir,recoverySourceCache}){
 if(!reference?.path||!reference.sha256)throw Error('FULL_CACHE_RECOVERY_REQUIRED');const bytes=small(reference.path);if(sha(bytes)!==reference.sha256)throw Error('RECOVERY_RECEIPT_HASH_MISMATCH');const r=JSON.parse(bytes);
 if(recoverySourceCache&&path.resolve(r.source_cache||'')!==path.resolve(recoverySourceCache))throw Error('RECOVERY_SOURCE_CACHE_MISMATCH');
 if(r.contract!==CONTRACT||r.status!=='FULL_CACHE_RECOVERY_COMPLETE'||r.evidence_state!=='GAP/CONTINUITY_UNKNOWN'||r.continuous!==false||r.gap_closed!==false||r.lost_intents_reconstructed!==0||r.target_epoch!==epoch||r.kind!==kind||r.target_dir!==path.resolve(dir)||!Number.isSafeInteger(r.max_bytes)||r.max_bytes<1||r.max_bytes>512*1048576||!Array.isArray(r.previous_files)||r.previous_files.length>4096)throw Error('RECOVERY_IDENTITY_INVALID');
 let v;try{v=inspect(r.baseline_file,kind,r.max_bytes,path.join(path.dirname(reference.path),'keys-verify-'+crypto.randomUUID()),r.validation?.limits);}catch(e){throw Error('RECOVERY_BASELINE_INVALID:'+e.message);}
 if(v.sha256!==r.baseline_sha256||v.bytes!==r.baseline_bytes||v.rows!==r.baseline_rows)throw Error('RECOVERY_BASELINE_INVALID');
 for(const f of r.previous_files){const h=hashFile(f.file,r.max_bytes);if(h.sha256!==f.sha256||h.bytes!==f.bytes)throw Error('OLD_EVIDENCE_CHANGED_SINCE_RECOVERY');}return r;
}
module.exports={recover,verify,CONTRACT};
