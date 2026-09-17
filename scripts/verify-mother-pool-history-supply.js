'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {inspectSnapshot}=require('../lib/daytrade-mother-pool-snapshot');
const {selectHistory}=require('../lib/mother-pool-history-input');
function verify(receipt,snapshot,{readFile=fs.readFileSync,asOf=new Date().toISOString()}={}){
 const failed=[],verified=[];
 const identity=inspectSnapshot(snapshot,snapshot?.trade_date);
 if(!identity.ok)failed.push('SNAPSHOT_INVALID');
 if(receipt?.contract!=='mother_pool_history_supply_batch_v1'||receipt.trade_date!==snapshot?.trade_date
  ||receipt.mother_pool_run_id!==identity.runId||receipt.snapshot_sequence!==snapshot?.snapshot_sequence)failed.push('RECEIPT_IDENTITY_MISMATCH');
 const rows=Array.isArray(receipt?.rows)?receipt.rows:[];
 const symbols=rows.map(r=>r?.symbol);
 if(receipt?.requested!==identity.symbols.size||rows.length!==identity.symbols.size||new Set(symbols).size!==symbols.length
  ||symbols.some(s=>!identity.symbols.has(s)))failed.push('SCOPE_MISMATCH');
 if(receipt?.fetched!==rows.filter(r=>r?.status==='HISTORY_FETCHED').length||receipt?.reused!==rows.filter(r=>r?.status==='HISTORY_REUSED').length)failed.push('COUNT_MISMATCH');
 for(const row of rows){
  if(!row){failed.push('INVALID_ROW');continue;}
  if(!['HISTORY_FETCHED','HISTORY_REUSED'].includes(row.status)){
   if(!['PENDING','DATA_GAP'].includes(row.status)||!row.reason)failed.push('GAP_INVALID:'+row.symbol);
   continue;
  }
  try{
   const raw=readFile(row.file);
   if(crypto.createHash('sha256').update(raw).digest('hex')!==row.sha256)throw Error('hash');
   const artifact=JSON.parse(raw);
   const selected=selectHistory(artifact,{symbol:row.symbol,tradeDate:snapshot.trade_date,asOf,minute:'09:22'});
   if(artifact.result.raw.data.length!==row.rows||row.http_status!==200||row.exit_code!==0)throw Error('count or fetch');
   verified.push({symbol:row.symbol,file:row.file,sha256:row.sha256,rows:row.rows,raw_sha256:selected.provenance.raw_sha256});
  }catch{failed.push('ARTIFACT_READBACK_INVALID:'+row.symbol);}
 }
 return {contract:'mother_pool_history_supply_readback_v1',complete:false,status:failed.length?'BLOCKED':'LOCAL_READBACK_VERIFIED',
  checked_at:asOf,requested:snapshot?.symbol_count,verified_count:verified.length,pending_or_gap_count:rows.length-verified.length,
  verified,failed_checks:failed,first_blocker:failed[0]||null,exit_code:failed.length?1:0,
  limitation:'Local historical artifacts only; not DB/anon or natural Writer acceptance.'};
}
module.exports={verify};
if(require.main===module){
 const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.slice(n.length+3);
 const out=arg('out');if(!out||fs.existsSync(out))throw Error('NEW_OUTPUT_REQUIRED');
 const input=JSON.parse(fs.readFileSync(arg('snapshot'),'utf8'));
 const result=verify(JSON.parse(fs.readFileSync(arg('receipt'),'utf8')),input.authoritative_candidate||input);
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:result.status,verified_count:result.verified_count,pending_or_gap_count:result.pending_or_gap_count,failed_checks:result.failed_checks,complete:false,out}));
 process.exitCode=result.exit_code;
}
