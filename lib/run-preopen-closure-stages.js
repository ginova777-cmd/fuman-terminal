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
  const asOf=now(),time=Date.parse(asOf);
  if(!Number.isFinite(time))throw Error('PREOPEN_CLOSURE_TIME_INVALID');
  const local=new Date(time+28800000).toISOString();
  if(local.slice(0,10)!==identity.trade_date)throw Error('PREOPEN_CLOSURE_CROSS_DAY');
  const due=moduleId==='A14'?'08:50':'08:59';
  if(local.slice(11,16)<due){results.push({module_id:moduleId,status:'NOT_DUE',complete:false,due_slot:due,checked_at:asOf});continue;}
  const input=require('./mother-pool-preopen-closure').collect({moduleId,identity,symbols,references:structuredClone(references),asOf,runtime});
  const saved=await persist(input);
  const result=await capture(moduleId,saved);results.push(result);include(result);
 }
 return results;
}
module.exports={run};
