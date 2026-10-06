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
 return {path:file,archive_sha256:packed.archive_sha256,receipt_sha256:packed.receipt_sha256,bytes:bytes.length,independent_readback:true,remote_publication_verified:false};
}
module.exports={save};
