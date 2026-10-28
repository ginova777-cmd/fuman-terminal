'use strict';
const fs=require('fs'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function index(file,expected){
 if(!expected||expected.ok!==true||!/^[a-f0-9]{64}$/i.test(expected.sha256||'')||!Number.isSafeInteger(expected.count))throw Error('reference_cache_seal_missing');
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('reference_cache_link');
 const entries=Object.create(null),digest=crypto.createHash('sha256');let pending=Buffer.alloc(0),offset=0,count=0;
 for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024})){
  digest.update(chunk);const data=pending.length?Buffer.concat([pending,chunk]):chunk;let start=0,end;
  while((end=data.indexOf(10,start))>=0){const raw=data.subarray(start,end);if(!raw.length)throw Error('reference_cache_empty_record');const row=JSON.parse(raw);if(typeof row.file!=='string'||Object.hasOwn(entries,row.file)||!Array.isArray(row.ids)||!Array.isArray(row.references)||!/^[a-f0-9]{64}$/i.test(row.sha256||''))throw Error('reference_cache_record_invalid');
   entries[row.file]={cacheRecord:{file,offset,length:raw.length,sha256:hash(raw)}};offset+=raw.length+1;count++;start=end+1;
  }
  pending=Buffer.from(data.subarray(start));if(pending.length>128*1024*1024)throw Error('reference_cache_record_over_bound');
 }
 const after=fs.lstatSync(file);if(pending.length||count!==expected.count||digest.digest('hex')!==expected.sha256||after.ino!==stat.ino||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('reference_cache_seal_mismatch');return entries;
}
function read(ref){const s=fs.lstatSync(ref.file);if(!s.isFile()||s.isSymbolicLink())throw Error('reference_cache_link');const fd=fs.openSync(ref.file,'r');try{const opened=fs.fstatSync(fd);if(opened.ino!==s.ino||opened.dev!==s.dev)throw Error('reference_cache_replaced');const bytes=Buffer.alloc(ref.length);let at=0;while(at<bytes.length){const n=fs.readSync(fd,bytes,at,bytes.length-at,ref.offset+at);if(!n)throw Error('reference_cache_truncated');at+=n;}if(hash(bytes)!==ref.sha256)throw Error('reference_cache_record_hash');return JSON.parse(bytes);}finally{fs.closeSync(fd);}}
module.exports={index,read};
function writer(dir){
 const path=require('path');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'cleanup-extended-reference-'+crypto.randomUUID()+'.jsonl'),fd=fs.openSync(file,'wx'),digest=crypto.createHash('sha256');let count=0,closed=false;
 return {write(row){if(closed)throw Error('reference_cache_writer_closed');const bytes=Buffer.from(JSON.stringify(row)+'\n');let at=0;while(at<bytes.length)at+=fs.writeSync(fd,bytes,at,bytes.length-at);digest.update(bytes);count++;},seal(){if(closed)throw Error('reference_cache_writer_closed');fs.fsyncSync(fd);fs.closeSync(fd);closed=true;return {contract:'cleanup-reference-cache-v2',ok:true,count,sha256:digest.digest('hex'),file,createdAt:new Date().toISOString()};},abort(){if(!closed){fs.closeSync(fd);closed=true;}}};
}
module.exports.writer=writer;
