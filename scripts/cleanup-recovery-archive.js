'use strict';
// Durable row payload before deletion. This is not a database restore command.
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function seal(runtime,runId,stage,tables){
 if(!/^[a-zA-Z0-9_-]+$/.test(runId||'')||!/^[a-zA-Z0-9_-]+$/.test(stage||''))throw Error('recovery_identity_invalid');
 if(!tables||!Object.keys(tables).length||Object.entries(tables).some(([t,rows])=>!/^\w+$/.test(t)||!Array.isArray(rows)))throw Error('recovery_inventory_invalid');
 const parent=path.resolve(runtime,'archive','cleanup-recovery');fs.mkdirSync(parent,{recursive:true});
 for(let p=parent;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())throw Error('recovery_link_rejected');if(p===path.dirname(p))break;}
 const dir=path.join(parent,runId);fs.mkdirSync(dir,{recursive:true});if(fs.lstatSync(dir).isSymbolicLink())throw Error('recovery_link_rejected');
 const raw=Buffer.from(JSON.stringify({contract:'cleanup-row-recovery-v1',runId,stage,tables}));
 if(raw.length>256*1024*1024)throw Error('recovery_archive_bound');
 const space=fs.statfsSync(dir);if(space.bavail*space.bsize<raw.length*3+64*1024*1024)throw Error('recovery_disk_space');
 const file=path.join(dir,stage+'.json.gz'),compressed=zlib.gzipSync(raw),fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,compressed);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const bytes=fs.readFileSync(file),decoded=zlib.gunzipSync(bytes);if(!decoded.equals(raw))throw Error('recovery_readback_failed');
 const receipt={contract:'cleanup-row-recovery-receipt-v1',runId,stage,file,sha256:hash(bytes),payloadSha256:hash(raw),bytes:bytes.length,rows:Object.fromEntries(Object.entries(tables).map(([t,r])=>[t,r.length])),readbackVerified:true,createdAt:new Date().toISOString(),restoreScope:'row_payload_only_schema_required_no_automatic_production_restore'};
 const index=file+'.receipt.json',indexFd=fs.openSync(index,'wx',0o600);try{fs.writeFileSync(indexFd,JSON.stringify(receipt,null,2));fs.fsyncSync(indexFd);}finally{fs.closeSync(indexFd);}
 const indexSha256=hash(fs.readFileSync(index));verify(index,{...receipt,indexSha256});return {...receipt,index,indexSha256};
}
function verify(index,expected){
 const indexBytes=fs.readFileSync(index),r=JSON.parse(indexBytes);
 if(!/^[a-zA-Z0-9_-]+$/.test(r.runId||'')||!/^[a-zA-Z0-9_-]+$/.test(r.stage||''))throw Error('recovery_identity_invalid');
 const expectedFile=path.join(path.dirname(path.resolve(index)),r.stage+'.json.gz');
 if(path.resolve(r.file)!==expectedFile||path.basename(path.dirname(expectedFile))!==r.runId||path.resolve(index)!==expectedFile+'.receipt.json')throw Error('recovery_path_mismatch');
 for(const file of [index,r.file])if(fs.lstatSync(file).isSymbolicLink())throw Error('recovery_link_rejected');
 if(expected&&(hash(indexBytes)!==expected.indexSha256||r.file!==expected.file||r.runId!==expected.runId||r.stage!==expected.stage||r.sha256!==expected.sha256||r.payloadSha256!==expected.payloadSha256))throw Error('recovery_receipt_binding_mismatch');
 const b=fs.readFileSync(r.file),raw=zlib.gunzipSync(b,{maxOutputLength:256*1024*1024});
 if(r.contract!=='cleanup-row-recovery-receipt-v1'||hash(b)!==r.sha256||hash(raw)!==r.payloadSha256)throw Error('recovery_hash_mismatch');
 const p=JSON.parse(raw);if(p.contract!=='cleanup-row-recovery-v1'||p.runId!==r.runId||p.stage!==r.stage||JSON.stringify(Object.fromEntries(Object.entries(p.tables).map(([t,rows])=>[t,rows.length])))!==JSON.stringify(r.rows))throw Error('recovery_identity_mismatch');return p;
}
module.exports={seal,verify};
