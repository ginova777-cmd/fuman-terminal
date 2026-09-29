'use strict';
const {isDeepStrictEqual}=require('node:util');
const {hash,identityFields}=require('./mother-pool-module-write-set');
// This proves the write only. Independent DB/anon business verification follows.
function verify(document, rounds, rows) {
 if(document?.contract!=='mother_pool_module_write_set_v1'||hash(document.plan)!==document.plan_hash)throw Error('MODULE_ACK_PLAN_INVALID');
 if(!Array.isArray(rounds)||rounds.length!==1)throw Error('MODULE_ACK_ROUND_COUNT');
 const round=rounds[0];
 if(!isDeepStrictEqual(round.document,document))throw Error('MODULE_ACK_DOCUMENT_MISMATCH');
 for(const key of ['module_id','trade_date','writer_run_id'])if(round[key]!==document[key])throw Error('MODULE_ACK_ROUND_IDENTITY:'+key);
 if(!Number.isFinite(Date.parse(round.committed_at))||Date.parse(round.committed_at)<Date.parse(document.plan.created_at))throw Error('MODULE_ACK_COMMIT_TIME');
 const requested=document.plan.requested_symbols,planned=document.plan.rows;
 if(!Array.isArray(requested)||!requested.length||new Set(requested).size!==requested.length||!Array.isArray(planned)||planned.length!==requested.length)throw Error('MODULE_ACK_REQUESTED_INVALID');
 if(!Array.isArray(rows)||rows.length!==requested.length||new Set(rows.map(r=>r.symbol)).size!==requested.length)throw Error('MODULE_ACK_ROW_COUNT');
 const bySymbol=new Map(planned.map(r=>[r.symbol,r]));
 if(bySymbol.size!==requested.length||requested.some(s=>!bySymbol.has(s)))throw Error('MODULE_ACK_PLAN_SET');
 for(const row of rows){
  for(const key of ['module_id','trade_date','writer_run_id'])if(row[key]!==document[key])throw Error('MODULE_ACK_ROW_IDENTITY:'+key);
  if(!bySymbol.has(row.symbol)||!isDeepStrictEqual(row.evidence,bySymbol.get(row.symbol)))throw Error('MODULE_ACK_ROW_CONTENT');
 }
 return {committed:true,committed_at:round.committed_at,module_id:document.module_id,
  ...Object.fromEntries(identityFields.map(k=>[k,document[k]])),plan_hash:document.plan_hash,
  written_symbols:rows.map(r=>r.symbol),acknowledgement_mode:'exact_readback_after_timeout'};
}
module.exports={verify};
