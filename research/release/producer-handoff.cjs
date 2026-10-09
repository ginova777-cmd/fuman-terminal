'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {sha}=require('../../lib/mother-change-evidence.cjs');
function local(file){const p=path.resolve(file);if(/fuman-runtime|fuman-release-owner|prod81/i.test(p))throw Error('FORMAL_PATH_NOT_AUTHORIZED');let q=p;while(true){if(fs.existsSync(q)&&fs.lstatSync(q).isSymbolicLink())throw Error('LINK_NOT_AUTHORIZED');const parent=path.dirname(q);if(parent===q)break;q=parent;}return p;}
function read(file,max=1048576){local(file);const s=fs.statSync(file);if(!s.isFile()||s.size>max)throw Error('BOUNDED_FILE_LIMIT');const b=fs.readFileSync(file);if(b.length>max)throw Error('BOUNDED_FILE_LIMIT');return b;}
function reference(ref){if(!ref||!/^[a-f0-9]{64}$/.test(ref.sha256||''))throw Error('REFERENCE_REQUIRED');const b=read(ref.path);if(sha(b)!==ref.sha256)throw Error('REFERENCE_HASH');return JSON.parse(b);}
function baselineHash(file,max){local(file);const fd=fs.openSync(file,'r'),h=crypto.createHash('sha256'),buf=Buffer.alloc(65536);let total=0;try{for(let n;(n=fs.readSync(fd,buf,0,buf.length,null));){total+=n;if(total>max)throw Error('BASELINE_LIMIT');h.update(buf.subarray(0,n));}}finally{fs.closeSync(fd);}return {sha256:h.digest('hex'),bytes:total};}
function verifyHandoff(bundle){
 if(bundle?.contract!=='producer-handoff-v1'||bundle.scope!=='ISOLATED_REVIEW'||!['quote','candle'].includes(bundle.kind))throw Error('HANDOFF_SCOPE');
 const deployment=reference(bundle.deployment),start=reference(bundle.start),recovery=reference(bundle.recovery),boundary=reference(bundle.boundary);
 if(!/^[a-f0-9]{40}$/.test(deployment.sha||'')||start.loaded_sha!==deployment.sha||start.collector_role!=='daytrade'||!Number.isSafeInteger(start.pid)||!Number.isFinite(Date.parse(start.started_at))||!start.entrypoint)throw Error('DEPLOYMENT_START_BINDING');
 if(start.epoch!==bundle.epoch||recovery.epoch!==bundle.epoch||boundary.epoch!==bundle.epoch||boundary.kind!==bundle.kind||recovery.kind!==bundle.kind||boundary.trade_date!==bundle.trade_date)throw Error('HANDOFF_IDENTITY');
 if(local(start.cache[bundle.kind])!==local(recovery.cache_path)||local(start.feed[bundle.kind])!==local(bundle.feed_root))throw Error('CACHE_FEED_BINDING');
 if(recovery.status!=='INDEPENDENT_RECOVERY_VERIFIED'||boundary.recovery_hash!==bundle.recovery.sha256||boundary.start_hash!==bundle.start.sha256||boundary.continuity!=='FROM_BASELINE_BOUNDARY_ONLY')throw Error('HANDOFF_BOUNDARY');
 if(!Number.isSafeInteger(boundary.sequence)||boundary.sequence<0)throw Error('HANDOFF_SEQUENCE');
 const measured=baselineHash(recovery.baseline_file,536870912);if(measured.sha256!==recovery.baseline_sha256||measured.bytes!==recovery.baseline_bytes)throw Error('BASELINE_HASH');
 let cursor={sequence:0,commit_hash:null,revisions:{}};
 if(boundary.sequence){cursor=reference(boundary.checkpoint);if(cursor.sequence!==boundary.sequence||cursor.commit_hash!==boundary.commit_hash||cursor.epoch!==bundle.epoch||cursor.trade_date!==bundle.trade_date||cursor.kind!==bundle.kind)throw Error('BASELINE_CHECKPOINT_BINDING');}
 else if(boundary.commit_hash!==null)throw Error('BASELINE_ZERO_ANCHOR');
 if(!cursor.revisions||Object.keys(cursor.revisions).length>50000)throw Error('REVISION_LIMIT');
 return {binding:sha(bundle),kind:bundle.kind,epoch:bundle.epoch,trade_date:bundle.trade_date,source_sha:deployment.sha,evidence_version:start.evidence_version,start_hash:bundle.start.sha256,recovery_hash:bundle.recovery.sha256,feed_root:local(bundle.feed_root),cache_path:local(recovery.cache_path),cursor,formal_verified:false,continuity:'FROM_BASELINE_BOUNDARY_ONLY',prior_visibility:'UNKNOWN'};
}
module.exports={verifyHandoff,local,read,sha};

