'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const CONTRACT='opening-report-writer-pool-refresh-v1';
function directory(runtime,date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('invalid_refresh_date');
  return path.join(runtime,'state','opening-report-writer-refreshes',date);
}
// Emit only after a successful pool upsert and prune. Repeated writes in one
// writer generation must never count as multiple independent refreshes.
function record({runtime,date,identity,rows}){
  if(!identity?.generation_id||!identity?.writer_run_id||!rows?.length)throw Error('invalid_refresh_identity');
  const symbols=[...new Set(rows.map(r=>String(r.symbol||'')))].sort();
  if(symbols.includes(''))throw Error('invalid_refresh_symbol');
  const event={contract:CONTRACT,trade_date:date,generation_id:identity.generation_id,writer_run_id:identity.writer_run_id,completed_at:new Date().toISOString(),operation:'priority_pool_upsert_and_prune',write_complete:true,symbols,symbol_count:symbols.length,db_readback_verified:false};
  const dir=directory(runtime,date);fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,crypto.createHash('sha256').update(String(identity.generation_id)).digest('hex')+'.json');
  try{fs.writeFileSync(file,JSON.stringify(event,null,2),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
  return file;
}
function readAfter(runtime,date,after,now=Date.now()){
  const dir=directory(runtime,date),seen=new Map();if(!fs.existsSync(dir))return [];
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.json')))try{
    const file=path.join(dir,name),bytes=fs.readFileSync(file),e=JSON.parse(bytes),t=Date.parse(e.completed_at);
    if(e.contract!==CONTRACT||e.trade_date!==date||e.write_complete!==true||e.operation!=='priority_pool_upsert_and_prune'||!e.generation_id||!e.writer_run_id||!Number.isFinite(t)||t<=after||t>now||!Array.isArray(e.symbols)||!e.symbols.length||e.symbol_count!==new Set(e.symbols).size)continue;
    seen.set(e.generation_id,{...e,evidence_path:file,evidence_sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }catch{/* Invalid evidence never counts. */}
  return [...seen.values()].sort((a,b)=>Date.parse(a.completed_at)-Date.parse(b.completed_at));
}
module.exports={record,readAfter,CONTRACT};
