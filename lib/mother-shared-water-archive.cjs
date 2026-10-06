'use strict';
const {gzipSync,gunzipSync}=require('node:zlib'),{createHash}=require('node:crypto');
const hash=b=>createHash('sha256').update(b).digest('hex');
const MAX_RAW=16*1024*1024,MAX_ARCHIVE=3*1024*1024,MAX_BLOBS=8*1024*1024;
function unpack(archive,{archiveSha256,receiptSha256,runId}){
 if(!Buffer.isBuffer(archive)||archive.length>MAX_ARCHIVE||hash(archive)!==archiveSha256)throw Error('ARCHIVE_BYTES_OR_HASH_INVALID');
 const raw=gunzipSync(archive,{maxOutputLength:MAX_RAW});
 const object=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(object.contract!=='mother-shared-water-archive-v1'||typeof object.receipt_utf8!=='string'||Buffer.byteLength(object.receipt_utf8)>2*1024*1024||hash(Buffer.from(object.receipt_utf8))!==receiptSha256)throw Error('ARCHIVE_RECEIPT_MISMATCH');
 const receipt=JSON.parse(object.receipt_utf8),expected=receipt.evidence_hashes;
 if(receipt.contract!=='mother-pool-shared-water-acceptance-v1'||receipt.verification_run_id!==runId||!Array.isArray(expected)||expected.length<1||expected.length>8000||expected.some(h=>!/^[a-f0-9]{64}$/.test(h))||new Set(expected).size!==expected.length||JSON.stringify([...expected].sort())!==JSON.stringify(expected))throw Error('ARCHIVE_MANIFEST_INVALID');
 if(!Array.isArray(object.blobs)||JSON.stringify(object.blobs.map(b=>b.sha256))!==JSON.stringify(expected))throw Error('ARCHIVE_BLOB_SET_MISMATCH');
 const blobs=new Map();let total=0;
 for(const b of object.blobs){
  if(typeof b.base64!=='string'||b.base64.length>4*Math.ceil(4*1024*1024/3))throw Error('ARCHIVE_BLOB_SIZE');
  const bytes=Buffer.from(b.base64,'base64');total+=bytes.length;
  if(bytes.length>4*1024*1024||total>MAX_BLOBS||bytes.toString('base64')!==b.base64||hash(bytes)!==b.sha256)throw Error('ARCHIVE_BLOB_INVALID');
  blobs.set('sha256:'+b.sha256,bytes);
 }
 return {receipt,receipt_bytes:Buffer.from(object.receipt_utf8),blobs,raw_bytes:raw.length,decoded_bytes:total,resolve:ref=>blobs.has(ref)?Buffer.from(blobs.get(ref)):undefined};
}
function pack(bundle){
 const receiptText=JSON.stringify(bundle.receipt),receiptSha256=hash(Buffer.from(receiptText));
 const blobs=[...bundle.blobs].map(([ref,bytes])=>{
  if(!Buffer.isBuffer(bytes)||ref!=='sha256:'+hash(bytes))throw Error('ARCHIVE_LOCAL_BLOB_INVALID');
  return {sha256:ref.slice(7),base64:bytes.toString('base64')};
 }).sort((a,b)=>a.sha256<b.sha256?-1:a.sha256>b.sha256?1:0);
 const raw=Buffer.from(JSON.stringify({contract:'mother-shared-water-archive-v1',receipt_utf8:receiptText,blobs}));
 if(raw.length>MAX_RAW)throw Error('ARCHIVE_RAW_LIMIT');
 const archive=gzipSync(raw,{level:3}),archiveSha256=hash(archive);
 // Validate the EXACT archive that will be stored, including original receipt
 // and every evidence byte. Compression does not substitute for raw hashes.
 const restored=unpack(archive,{archiveSha256,receiptSha256,runId:bundle.receipt.verification_run_id});
 return {archive,archive_sha256:archiveSha256,receipt_sha256:receiptSha256,receipt_utf8:receiptText,raw_bytes:raw.length,decoded_bytes:restored.decoded_bytes};
}
module.exports={pack,unpack};
