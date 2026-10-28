'use strict';
const fs=require('fs'),path=require('path');
const {Worker,isMainThread,parentPort,workerData}=require('worker_threads');
const proof=require('./cleanup-item-observation');
// Hash every enumerated file with the same content/race checks. Concurrency changes
// throughput only; it does not replace content hashes with metadata or sample files.
async function filesParallel(roots){
 const files=new Map();
 function visit(file,optional=false){let s;try{s=fs.lstatSync(file);}catch(e){if(optional&&e.code==='ENOENT')return;throw e;}if(s.isSymbolicLink())throw Error('item_inventory_link');if(s.isDirectory()){for(const n of fs.readdirSync(file))visit(path.join(file,n));return;}if(!s.isFile())throw Error('item_inventory_special_file');files.set(file,{file,size:s.size});}
 for(const root of roots)visit(root,true);
 const rows=[...files.values()];if(rows.length<64)return proof.files(roots);
 const groups=Array.from({length:Math.min(4,require('os').availableParallelism?.()||2)},()=>({bytes:0,files:[]}));
 for(const row of rows.sort((a,b)=>b.size-a.size)){groups.sort((a,b)=>a.bytes-b.bytes||a.files.length-b.files.length);groups[0].files.push(row.file);groups[0].bytes+=row.size;}
 const workers=[];
 try{
  const results=await Promise.all(groups.filter(g=>g.files.length).map(g=>new Promise((resolve,reject)=>{
   const w=new Worker(__filename,{workerData:{files:g.files}});workers.push(w);let result;
   w.on('message',v=>{result=v;});w.on('error',reject);
   w.on('exit',code=>{if(code!==0||!result)reject(Error('item_inventory_worker_failed:'+code));else if(result.error)reject(Error(result.error));else resolve(result.rows);});
  })));
  const actual=results.flat(),seen=new Set();for(const row of actual){if(!files.has(row.key)||seen.has(row.key))throw Error('item_inventory_worker_membership');seen.add(row.key);}if(seen.size!==files.size)throw Error('item_inventory_worker_missing');
  return actual.sort((a,b)=>a.key.localeCompare(b.key));
 }finally{await Promise.all(workers.map(w=>w.terminate()));}
}
if(!isMainThread){try{const rows=proof.files(workerData.files);if(rows.length!==workerData.files.length)throw Error('item_inventory_worker_missing');parentPort.postMessage({rows});}catch(e){parentPort.postMessage({error:e.message});}}
module.exports={filesParallel};
