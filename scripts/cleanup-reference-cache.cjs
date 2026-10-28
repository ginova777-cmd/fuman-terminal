'use strict';
const fs=require('fs'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function index(file,expected){
 if(!expected||expected.ok!==true||!/^[a-f0-9]{64}$/i.test(expected.sha256||'')||!Number.isSafeInteger(expected.count))throw Error('reference_cache_seal_missing');
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error('reference_cache_link');
 const dictionary=new (require('./cleanup-reference-dictionary.cjs').Decoder)();const entries=Object.create(null),digest=crypto.createHash('sha256');let usesDictionary=false,pending=Buffer.alloc(0),offset=0,count=0;
 for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024})){
  digest.update(chunk);const data=pending.length?Buffer.concat([pending,chunk]):chunk;let start=0,end;
  while((end=data.indexOf(10,start))>=0){const raw=data.subarray(start,end);if(!raw.length)throw Error('reference_cache_empty_record');const row=JSON.parse(raw);if(typeof row.file!=='string'||Object.hasOwn(entries,row.file)||(!(['gzip-json-v1','reference-dictionary-v1'].includes(row.encoding)&&typeof row.payload==='string')&&(!Array.isArray(row.ids)||!Array.isArray(row.references)))||!/^[a-f0-9]{64}$/i.test(row.sha256||''))throw Error('reference_cache_record_invalid');
   if(row.encoding==='reference-dictionary-v1'){usesDictionary=true;dictionary.add(row);}entries[row.file]={cacheRecord:{file,offset,length:raw.length,sha256:hash(raw)}};offset+=raw.length+1;count++;start=end+1;
  }
  pending=Buffer.from(data.subarray(start));if(pending.length>128*1024*1024)throw Error('reference_cache_record_over_bound');
 }
 const after=fs.lstatSync(file);if(pending.length||count!==expected.count||digest.digest('hex')!==expected.sha256||after.ino!==stat.ino||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('reference_cache_seal_mismatch');if(usesDictionary){const bytes=Buffer.from(JSON.stringify(dictionary.strings)),shared=new SharedArrayBuffer(bytes.length);Buffer.from(shared).set(bytes);const descriptor={bytes:shared,sha256:hash(bytes),count:dictionary.strings.length};for(const entry of Object.values(entries))entry.cacheRecord.dictionary=descriptor;}return entries;
}
function readRecord(ref){const s=fs.lstatSync(ref.file);if(!s.isFile()||s.isSymbolicLink())throw Error('reference_cache_link');const fd=fs.openSync(ref.file,'r');try{const opened=fs.fstatSync(fd);if(opened.ino!==s.ino||opened.dev!==s.dev)throw Error('reference_cache_replaced');const bytes=Buffer.alloc(ref.length);let at=0;while(at<bytes.length){const n=fs.readSync(fd,bytes,at,bytes.length-at,ref.offset+at);if(!n)throw Error('reference_cache_truncated');at+=n;}if(hash(bytes)!==ref.sha256)throw Error('reference_cache_record_hash');return JSON.parse(bytes);}finally{fs.closeSync(fd);}}
module.exports={index,read};
const dictionaries=new WeakMap();function sharedDictionary(ref){if(dictionaries.has(ref.bytes))return dictionaries.get(ref.bytes);const bytes=Buffer.from(ref.bytes);if(hash(bytes)!==ref.sha256)throw Error('reference_dictionary_hash');const values=JSON.parse(bytes);if(!Array.isArray(values)||values.some(v=>typeof v!=='string')||(ref.count!==undefined&&ref.count!==values.length))throw Error('reference_dictionary_values');dictionaries.set(ref.bytes,values);return values;}
function writer(dir){
 const encoder=new (require('./cleanup-reference-dictionary.cjs').Encoder)();const path=require('path');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'cleanup-extended-reference-'+crypto.randomUUID()+'.jsonl'),fd=fs.openSync(file,'wx'),digest=crypto.createHash('sha256');let count=0,closed=false;
 return {write(row){if(closed)throw Error('reference_cache_writer_closed');const encoded=encoder.encode(row);const bytes=Buffer.from(JSON.stringify(encoded)+'\n');let at=0;while(at<bytes.length)at+=fs.writeSync(fd,bytes,at,bytes.length-at);digest.update(bytes);count++;},seal(){if(closed)throw Error('reference_cache_writer_closed');fs.fsyncSync(fd);fs.closeSync(fd);closed=true;return {contract:'cleanup-reference-cache-v2',ok:true,count,sha256:digest.digest('hex'),file,createdAt:new Date().toISOString()};},abort(){if(!closed){fs.closeSync(fd);closed=true;}}};
}
module.exports.writer=writer;

function read(ref){const record=readRecord(ref);if(record.encoding==='reference-dictionary-v1'){if(!ref.dictionary)throw Error('reference_dictionary_missing');const d=new (require('./cleanup-reference-dictionary.cjs').Decoder)();d.strings=sharedDictionary(ref.dictionary);return d.decode(record);}if(record.encoding==='gzip-json-v1'){const raw=require('zlib').gunzipSync(Buffer.from(record.payload,'base64'),{maxOutputLength:128*1024*1024});if(hash(raw)!==record.contentSha256)throw Error('reference_cache_content_hash');const row=JSON.parse(raw);if(row.file!==record.file||row.sha256!==record.sha256)throw Error('reference_cache_record_identity');return row;}return record;}

function readCompact(ref){const record=readRecord(ref);if(record.encoding!=='reference-dictionary-v1')return read(ref);if(!ref.dictionary)throw Error('reference_dictionary_missing');const count=compactDictionaryCount(ref.dictionary),value=JSON.parse(require('zlib').gunzipSync(Buffer.from(record.payload,'base64'),{maxOutputLength:128*1024*1024}));for(const values of [value.ids,value.references]){if(!Array.isArray(values))throw Error('reference_dictionary_indices');for(const i of values)if(!Number.isSafeInteger(i)||i<0||i>=count||i>=record.dictionaryStart+record.added.length)throw Error('reference_dictionary_index');}return {file:record.file,size:record.size,mtimeMs:record.mtimeMs,sha256:record.sha256,ids:value.ids,references:value.references,dictionary:ref.dictionary};}
module.exports.readCompact=readCompact;module.exports.sharedDictionary=sharedDictionary;

const compactDictionaries=new WeakMap();function compactDictionaryCount(ref){if(compactDictionaries.has(ref.bytes))return compactDictionaries.get(ref.bytes);if(!Number.isSafeInteger(ref.count)||ref.count<0)return sharedDictionary(ref).length;if(hash(Buffer.from(ref.bytes))!==ref.sha256)throw Error('reference_dictionary_hash');compactDictionaries.set(ref.bytes,ref.count);return ref.count;}

function expand(row){if(!row.dictionary)return row;const {dictionary,...result}=row,values=sharedDictionary(dictionary);const decode=items=>items.map(i=>{if(!Number.isSafeInteger(i)||i<0||i>=values.length)throw Error('reference_dictionary_index');return values[i];});result.ids=decode(row.ids);result.references=decode(row.references);return result;}module.exports.expand=expand;

// Internal worker output dictionary: references only validated, freshly hashed rows.
function liveDictionary(values){const descriptor={bytes:{},sha256:'live:'+crypto.randomUUID(),count:values.length};dictionaries.set(descriptor.bytes,values);return descriptor;}module.exports.liveDictionary=liveDictionary;
