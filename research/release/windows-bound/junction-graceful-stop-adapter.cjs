'use strict';
// Formal use requires a sealed, live Maintenance Owner authorization callback.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {validate,revalidate}=require('./junction-stop-identity.cjs');
const {validateAck}=require('./stop-ack-contract.cjs');
const h=b=>crypto.createHash('sha256').update(b).digest('hex'),wait=ms=>new Promise(r=>setTimeout(r,ms));
function local(p){const q=fs.realpathSync.native(p);if(/fuman-runtime|fuman-release-owner|prod81/i.test(p+' '+q))throw Error('FORMAL_OPERATION_NOT_AUTHORIZED');return q;}
function read(p){const s=fs.statSync(p);if(s.size>1048576)throw Error('CONTROL_LIMIT');return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));}
function within(root,p){const real=fs.realpathSync.native(p),r=path.relative(root,real);if(r==='..'||r.startsWith('..'+path.sep)||path.isAbsolute(r))throw Error('PROOF_OUTSIDE_RUNTIME');return real;}
function osProcess(pid){
 if(!Number.isSafeInteger(pid)||pid<=0)throw Error('PID_INVALID');
 const script=`$ErrorActionPreference='Stop';$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if(!$p){'null';exit};$x=Get-Process -Id ${pid};@{pid=[int]$p.ProcessId;creation_time=$x.StartTime.ToUniversalTime().ToString('o');cim_creation=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;command=$p.CommandLine;alive=$true}|ConvertTo-Json -Compress`;
 const x=readOs(script);if(!x)return null;
 if(!x.command||!x.executable||Math.abs(Date.parse(x.creation_time)-Date.parse(x.cim_creation))>1)throw Error('OS_IDENTITY_UNREADABLE');
 // Reject unsupported escaped quotes, and require one unambiguous main entry token.
 if(x.command.includes('\\"'))throw Error('COMMAND_ENCODING_UNSUPPORTED');
 const tokens=[...x.command.matchAll(/"([^\"]*)"|(\S+)/g)].map(m=>m[1]??m[2]);
 const entries=tokens.filter(t=>path.basename(t)==='fugle-futopt-websocket-collector.js');if(entries.length!==1)throw Error('ENTRY_TOKEN_AMBIGUOUS');
 return {pid:x.pid,creation_time:x.creation_time,cim_creation:x.cim_creation,executable:x.executable,entry:entries[0],alive:true};
}
function readOs(script){return JSON.parse(cp.execFileSync('pwsh',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true,timeout:10000}).replace(/^\uFEFF/,''));}
function observe(c){
 if(c.scope!=='ISOLATED_REVIEW'&&c.scope!=='FORMAL_OWNER')throw Error('SCOPE');
 if(c.scope==='FORMAL_OWNER'){if(typeof c.authorize!=='function')throw Error('OWNER_AUTHORIZATION_REQUIRED');c.authorize();}
 const runtime=c.scope==='ISOLATED_REVIEW'?local(c.runtime):fs.realpathSync.native(c.runtime),approvedRoot=c.scope==='ISOLATED_REVIEW'?local(c.approvedRoot):fs.realpathSync.native(c.approvedRoot);
 const owner=read(path.join(runtime,'state/futopt-shutdown/owner.json'));
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(owner.epoch||''))throw Error('EPOCH_INVALID');
 const control=within(runtime,path.join(runtime,'state/futopt-shutdown',owner.epoch));
 if(fs.realpathSync.native(owner.control_root)!==control)throw Error('CONTROL_ROOT_MISMATCH');
 const identity=read(path.join(control,'identity.json')),proc=osProcess(owner.pid);if(!proc)throw Error('PROCESS_EXITED');
 return {runtime,control,input:{owner,identity,process:proc,approvedRoot,approvedHash:c.approvedHash,observedAt:Date.now()}};
}
function prepare(c){const o=observe(c);return {...validate(o.input),control:o.control,runtime:o.runtime};}
async function stop(c,frozen){
 const o=observe(c);if(o.control!==frozen.control||o.runtime!==frozen.runtime)throw Error('CONTROL_DRIFT');revalidate(frozen,o.input);
 const id=crypto.randomUUID(),req={request_id:id,pid:frozen.pid,creation_time:frozen.creation_time,epoch:frozen.epoch,requested_at:new Date().toISOString()};
 const request=path.join(o.control,'request.json');if(fs.existsSync(request))throw Error('EXISTING_REQUEST_REQUIRES_REVIEW');
 const tmp=request+'.tmp-'+id,fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify(req));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,request);
 const receipt=path.join(o.control,'receipts',id+'.json'),deadline=Date.now()+20000;let ack;
 while(Date.now()<deadline){if(fs.existsSync(receipt)){ack=read(receipt);if(ack.status==='SAFE_STOP_FAILED')throw Error('ORIGINAL_SAVE_FAILED:'+ack.error);if(ack.status==='SAFE_STOP_SAVED')break;}await wait(100);}
 if(!ack||ack.status!=='SAFE_STOP_SAVED'||ack.safe_to_stop!==true||ack.request_id!==id||ack.pid!==frozen.pid||ack.epoch!==frozen.epoch||ack.creation_time!==frozen.creation_time||ack.entry!==frozen.owner_entry||ack.executable!==frozen.executable||ack.pending?.dirty_groups!==0||ack.pending?.pending_records!==0)throw Error('ORIGINAL_ACK_INVALID');
 const ackContract=validateAck(ack,req,{pid:frozen.pid,creation_time:frozen.creation_time,epoch:frozen.epoch,entry:frozen.owner_entry,executable:frozen.executable});
 const artifacts=[...ack.proof.files,...ack.proof.caches];
 for(const a of artifacts){const p=within(o.runtime,a.file),bytes=fs.readFileSync(p);if(bytes.length!==a.bytes||h(bytes)!==a.sha256)throw Error('ACK_ARTIFACT_MISMATCH');}
 while(Date.now()<deadline){const live=osProcess(frozen.pid);if(!live)return {status:c.scope==='FORMAL_OWNER'?'GRACEFUL_STOP_VERIFIED':'ISOLATED_GRACEFUL_STOP_VERIFIED',receipt,ack_status:ack.status,ack_contract:ackContract,artifacts:artifacts.length,pid:frozen.pid,pid_exited:true,request_id:id};if(live.creation_time!==frozen.creation_time)throw Error('PID_REUSED');await wait(200);}
 throw Error('PID_EXIT_TIMEOUT');
}
module.exports={prepare,stop,osProcess};

