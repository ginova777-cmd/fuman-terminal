'use strict';
const path=require('node:path');
const io=require('./mother-pool-a16-io');
const checkpoint=require('./mother-pool-a16-checkpoint');
function retained({runtime,universe,generation,mode,asOf}){
 const dir=path.join(runtime,'data','mother-pool-a16',universe.trade_date);
 let summary;try{summary=io.read(path.join(dir,'writer-summary.json'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
 if(summary.contract!=='mother_pool_a16_writer_summary_v1'||summary.trade_date!==universe.trade_date||summary.canonical_run_id!==universe.canonical_run_id||summary.generation!==generation||summary.mode!==mode||summary.universe_sha256!==io.hash(universe)||!Array.isArray(summary.rows)||summary.rows_sha256!==io.hash(summary.rows)||summary.attempted_count!==summary.rows.length||summary.requested_count!==universe.symbols.length||io.hash(summary.requested_symbols)!==io.hash(universe.symbols)||new Set(summary.rows.map(r=>r.symbol)).size!==summary.rows.length||summary.rows.some(r=>!universe.symbols.includes(r.symbol)))throw Error('A16_RESUME_SUMMARY_MISMATCH');
 const rows=[];
 for(const row of summary.rows){
  if(row.db_readback_ok!==true||row.anon_readback_ok!==true||row.verifier_passed!==true)continue;
  const artifact=io.read(path.join(dir,generation,row.symbol+'.json')),receipt=artifact.receipt;
  if(receipt?.symbol!==row.symbol||receipt.trade_date!==universe.trade_date||receipt.canonical_run_id!==universe.canonical_run_id||!checkpoint.retainable(artifact,receipt,generation,mode,asOf)||row.payload_sha256!==artifact.db.payload_sha256||row.requested_count!==1084||row.written_count!==1084||row.readback_count!==1084||row.source_ready!==receipt.complete)throw Error('A16_RESUME_ARTIFACT_MISMATCH:'+row.symbol);
  rows.push(row);
 }
 return rows;
}
module.exports={retained};
