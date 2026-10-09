'use strict';
const path=require('path'),{spawnSync}=require('child_process');
const {read,sha}=require('./producer-handoff.cjs');
function ref(r){const b=read(r.path);if(sha(b)!==r.sha256)throw Error('OWNER_REFERENCE_HASH');return JSON.parse(b);}
function norm(s){return String(s||'').replaceAll('\\','/').toLowerCase();}
function resolve(owner,snapshot,registration,now=Date.now()){
 const unknown=reason=>({status:'UNKNOWN',reason,identity_hash:sha(owner)});
 if(snapshot.contract!=='windows-owner-probe-v1'||!snapshot.query_ok||snapshot.host!==owner.host||snapshot.pid!==owner.pid||!Number.isFinite(Date.parse(snapshot.checked_at))||Math.abs(now-Date.parse(snapshot.checked_at))>30000)return unknown('QUERY_OR_FRESHNESS');
 const proof=ref(registration);if(proof.contract!=='owner-start-attestation-v1'||proof.owner_hash!==sha(owner)||proof.loaded_sha!==owner.release_sha||proof.pid!==owner.pid||proof.host!==owner.host||Date.parse(proof.started_at)!==Date.parse(owner.started_at)||!proof.entrypoint||!proof.executable)return unknown('START_ATTESTATION');
 // Evidence of this exact historical process is mandatory before treating absence as death.
 if(snapshot.exists===false)return {status:'CONFIRMED_DEAD_EXACT_IDENTITY',identity_hash:sha(owner),evidence_ref:registration.path,probe_sha256:sha(snapshot)};
 if(!snapshot.creation_time||!snapshot.executable||!snapshot.entrypoint)return unknown('PROCESS_FIELDS_UNREADABLE');
 if(Date.parse(snapshot.creation_time)!==Date.parse(owner.started_at))return unknown('PID_REUSED');
 if(norm(snapshot.executable)!==norm(proof.executable)||norm(snapshot.entrypoint)!==norm(proof.entrypoint))return unknown('PROCESS_PATH_MISMATCH');
 return {status:'ALIVE_EXACT_IDENTITY',identity_hash:sha(owner),evidence_ref:registration.path,probe_sha256:sha(snapshot)};
}
function probe(pid){if(!Number.isSafeInteger(pid)||pid<1)throw Error('PID');const r=spawnSync('pwsh',['-NoProfile','-File',path.join(__dirname,'Read-WindowsOwner.ps1'),'-TargetPid',String(pid)],{encoding:'utf8',timeout:12000,maxBuffer:65536,windowsHide:true});if(r.error||r.status!==0)return {query_ok:false,reason:'PROBE_FAILED'};return JSON.parse(r.stdout.replace(/^\uFEFF/,''));}
module.exports={resolve,probe};
