'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
async function run({identity,symbols,captures,persist,capture,runtime,now=()=>new Date().toISOString()}){
 const references={},results=[];
 function include(result){
  let parsed;try{parsed=JSON.parse(result.stdout||'{}');}catch{return;}
  for(const item of parsed.results||[]){if(!item.file||!item.module_id)continue;try{
   const bytes=fs.readFileSync(item.file);references[item.module_id]={file:item.file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  }catch{}}
 }
 for(const c of captures)include(c);
 for(const moduleId of ['A14','A19']){
  const input=require('./mother-pool-preopen-closure').collect({moduleId,identity,symbols,references:structuredClone(references),asOf:now(),runtime});
  const saved=await persist(input);
  const result=await capture(moduleId,saved);results.push(result);include(result);
 }
 return results;
}
module.exports={run};
