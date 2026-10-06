'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {pack,unpack}=require('./mother-shared-water-archive.cjs');
// Existing Writer lock serializes quota checks. Content-addressed hard-link
// publication exposes only a fully written file and never replaces old bytes.
function save(bundle,{directory,maxBytes=536870912,maxFiles=8192}){
 const packed=pack(bundle),file=path.join(directory,packed.archive_sha256+'.gz');
 fs.mkdirSync(directory,{recursive:true});
 if(!fs.existsSync(file)){
  const entries=fs.readdirSync(directory,{withFileTypes:true});
  if(entries.length>=maxFiles)throw Error('LOCAL_EVIDENCE_FILE_LIMIT');
  let used=0;for(const entry of entries){if(!entry.isFile())throw Error('LOCAL_EVIDENCE_UNEXPECTED_ENTRY');used+=fs.statSync(path.join(directory,entry.name)).size;}
  if(used+packed.archive.length>maxBytes)throw Error('LOCAL_EVIDENCE_BYTE_LIMIT');
  const temporary=path.join(directory,randomUUID()+'.tmp');
  try{
   const fd=fs.openSync(temporary,'wx');try{fs.writeFileSync(fd,packed.archive);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   try{fs.linkSync(temporary,file);}catch(e){if(e.code!=='EEXIST')throw e;}
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 }
 const bytes=fs.readFileSync(file);
 unpack(bytes,{archiveSha256:packed.archive_sha256,receiptSha256:packed.receipt_sha256,runId:bundle.receipt.verification_run_id});
 return {path:file,verification_run_id:bundle.receipt.verification_run_id,archive_sha256:packed.archive_sha256,receipt_sha256:packed.receipt_sha256,bytes:bytes.length,independent_readback:true,remote_publication_verified:false};
}
function prepareRetirement(records,{directory,nowMs=Date.now()}){
 if(!Array.isArray(records)||records.length>16||!Number.isFinite(nowMs))throw Error('ARCHIVE_RETIRE_BATCH_INVALID');
 const items=[],seen=new Set(),root=path.resolve(directory);
 for(const record of records){
  if(!/^[a-f0-9]{64}$/.test(record?.archive_sha256||'')||!/^[a-f0-9]{64}$/.test(record.receipt_sha256||'')||seen.has(record.archive_sha256))throw Error('ARCHIVE_RETIRE_RECORD_INVALID');
  seen.add(record.archive_sha256);
  const file=path.resolve(root,record.archive_sha256+'.gz');
  if(path.dirname(file)!==root||path.resolve(record.path||'')!==file)throw Error('ARCHIVE_RETIRE_PATH_INVALID');
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>3*1024*1024)throw Error('ARCHIVE_RETIRE_FILE_INVALID');
  const restored=unpack(fs.readFileSync(file),{archiveSha256:record.archive_sha256,receiptSha256:record.receipt_sha256,runId:record.verification_run_id});
  const r=restored.receipt,until=Date.parse(r.valid_until),checked=Date.parse(r.checked_at);
  if(!Number.isFinite(until)||!Number.isFinite(checked)||checked>until)throw Error('ARCHIVE_RETIRE_TIME_INVALID');
  if(until>=nowMs-3600000||checked>=nowMs-3600000)continue;
  items.push({verification_run_id:r.verification_run_id,archive_sha256:record.archive_sha256,receipt_sha256:record.receipt_sha256});
 }
 return {items,local_evidence_deleted:false,local_readback_verified:true};
}
module.exports={save,prepareRetirement};
