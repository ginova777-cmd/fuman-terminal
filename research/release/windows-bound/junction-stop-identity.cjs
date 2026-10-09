'use strict';
// Identity verifier only: never writes requests or changes historical owner records.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw Error(m)};
function inside(root,p){const r=path.relative(root,p);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
function file(p){const real=fs.realpathSync.native(p),s=fs.statSync(real,{bigint:true});if(!s.isFile()||s.size>4194304n)fail('ENTRY_FILE_LIMIT');const b=fs.readFileSync(real);return {real,dev:String(s.dev),ino:String(s.ino),bytes:b.length,hash:hash(b)};}
function validate({owner,identity,process:proc,approvedRoot,approvedHash,observedAt},now=Date.now()){
 if(!Number.isFinite(observedAt)||now-observedAt<0||now-observedAt>5000)fail('OBSERVATION_STALE');
 if(owner?.contract!=='futopt-stop-control-v1'||!Number.isSafeInteger(owner.pid)||owner.pid<=0||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(owner.epoch||'')||!Number.isFinite(Date.parse(owner.creation_time)))fail('OWNER_INVALID');
 for(const k of ['pid','creation_time','epoch','entry','executable'])if(owner[k]!==identity?.[k])fail('OWNER_IDENTITY_MISMATCH:'+k);
 // CreationDate is supplied as the exact UTC string, never locale-converted.
 if(proc?.pid!==owner.pid||proc.creation_time!==owner.creation_time||proc.executable!==owner.executable||proc.alive!==true)fail('PROCESS_IDENTITY_MISMATCH');
 if(!path.isAbsolute(proc.entry||'')||!path.isAbsolute(owner.entry||'')||!/^[a-f0-9]{64}$/.test(approvedHash||''))fail('ENTRY_OR_HASH_INVALID');
 if(path.basename(proc.entry)!=='fugle-futopt-websocket-collector.js'||path.basename(owner.entry)!=='fugle-futopt-websocket-collector.js')fail('ENTRY_NAME');
 const root=fs.realpathSync.native(approvedRoot),a=file(owner.entry),b=file(proc.entry);
 if(!inside(root,a.real)||!inside(root,b.real))fail('ENTRY_OUTSIDE_APPROVED_ROOT');
 if(a.real.toLowerCase()!==b.real.toLowerCase()||a.dev!==b.dev||a.ino!==b.ino||a.hash!==b.hash||a.hash!==approvedHash)fail('ENTRY_PHYSICAL_IDENTITY_MISMATCH');
 return {pid:owner.pid,creation_time:owner.creation_time,epoch:owner.epoch,owner_entry:owner.entry,process_entry:proc.entry,executable:proc.executable,approvedRoot,approvedHash,owner_hash:hash(JSON.stringify(owner)),identity_hash:hash(JSON.stringify(identity)),root,file:a,observedAt,request_sent:false};
}
function revalidate(frozen,input,now=Date.now()){
 if(now-frozen.observedAt>5000||now<frozen.observedAt)fail('FROZEN_PROOF_STALE');
 const next=validate(input,now);
 for(const k of ['pid','creation_time','epoch','owner_entry','process_entry','executable','approvedRoot','approvedHash','owner_hash','identity_hash','root'])if(next[k]!==frozen[k])fail('IDENTITY_OR_JUNCTION_DRIFT:'+k);
 if(JSON.stringify(next.file)!==JSON.stringify(frozen.file))fail('IDENTITY_OR_JUNCTION_DRIFT:file');
 return {...next,status:'IDENTITY_VERIFIED_ONLY',stop_authorized:false};
}
module.exports={validate,revalidate};
