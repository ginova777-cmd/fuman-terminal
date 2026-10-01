'use strict';
const {gzipSync,gunzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const CONTRACT='mother_pool_evidence_archive_v1',MAX_BYTES=32*1024*1024;
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
function pack(bridge){
 const raw=Buffer.from(JSON.stringify(bridge));
 if(raw.length<65536||raw.length>MAX_BYTES)return {bridge};
 const compressed=gzipSync(raw,{level:6});
 const archive={contract:CONTRACT,encoding:'gzip+base64',raw_bytes:raw.length,raw_sha256:digest(raw),data:compressed.toString('base64')};
 return Buffer.byteLength(JSON.stringify(archive))<raw.length?{bridge_archive:archive}:{bridge};
}
function unpack(evidence){
 if(!evidence||typeof evidence!=='object')throw Error('A03_EVIDENCE_MISSING');
 if(!Object.hasOwn(evidence,'bridge_archive')){
  if(!Object.hasOwn(evidence,'bridge'))throw Error('A03_EVIDENCE_MISSING');
  return evidence.bridge;
 }
 if(Object.hasOwn(evidence,'bridge'))throw Error('A03_EVIDENCE_AMBIGUOUS');
 const a=evidence.bridge_archive;
 if(a?.contract!==CONTRACT||a.encoding!=='gzip+base64'||!Number.isInteger(a.raw_bytes)||a.raw_bytes<1||a.raw_bytes>MAX_BYTES||!/^([a-f0-9]{64})$/.test(a.raw_sha256||'')||typeof a.data!=='string'||a.data.length>MAX_BYTES*2)throw Error('A03_ARCHIVE_INVALID');
 const bytes=Buffer.from(a.data,'base64');
 if(bytes.toString('base64')!==a.data)throw Error('A03_ARCHIVE_ENCODING');
 const raw=gunzipSync(bytes,{maxOutputLength:a.raw_bytes});
 if(raw.length!==a.raw_bytes||digest(raw)!==a.raw_sha256)throw Error('A03_ARCHIVE_HASH_MISMATCH');
 return JSON.parse(raw.toString('utf8'));
}
module.exports={pack,unpack};
