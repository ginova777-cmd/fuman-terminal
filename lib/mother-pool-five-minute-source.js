'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {envelopeOk}=require('./mother-pool-five-minute-producer');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function read({snapshot,asOf,runtime,get,paged}){
 const receipts=await get('v_fugle_intraday_5m_verification_readback',`select=*&trade_date=eq.${snapshot.trade_date}&verified_at=lte.${encodeURIComponent(asOf)}&order=verified_at.desc&limit=1`);
 const receipt=receipts?.[0]||null;
 if(!envelopeOk(receipt,snapshot,asOf))return {receipt,history:[],data_gap_reason:'FIVE_MINUTE_RECEIPT_INVALID'};
 const dir=path.join(runtime,'data','mother-pool-five-minute-source'),file=path.join(dir,hash({date:snapshot.trade_date,run:receipt.run_id})+'.json');
 let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 let history;
 if(saved?.contract==='mother_pool_five_minute_source_cache_v1'&&saved.trade_date===snapshot.trade_date&&saved.run_id===receipt.run_id&&Array.isArray(saved.rows)&&saved.rows_sha256===hash(saved.rows))history=saved.rows;
 else {
  history=await paged('v_fugle_intraday_5m_history_readback',`select=*&trade_date=eq.${snapshot.trade_date}&run_id=eq.${encodeURIComponent(receipt.run_id)}&order=symbol.asc,bar_start.asc`);
 }
 if(!Array.isArray(history)||!history.length||history.length!==receipt.history_readback_rows||history.some(r=>r.trade_date!==snapshot.trade_date||r.run_id!==receipt.run_id)||new Set(history.map(r=>r.symbol+'|'+r.bar_start)).size!==history.length)throw Error('FIVE_MINUTE_FIXED_HISTORY_SET_MISMATCH');
 if(!saved){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify({contract:'mother_pool_five_minute_source_cache_v1',trade_date:snapshot.trade_date,run_id:receipt.run_id,rows:history,rows_sha256:hash(history)}),{flag:'wx'});}
 return {receipt,history};
}
module.exports={read};
