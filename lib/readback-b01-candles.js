'use strict';
const {verifyCandleReadback}=require('./verify-b01-candle-readback');
async function readbackCandles(expected,{readRpc,deadlineMs,now=Date.now}={}) {
  if(!Array.isArray(expected?.items)||typeof readRpc!=='function'||!Number.isFinite(deadlineMs))throw Error('B01_READBACK_CONFIG_INVALID');
  const symbols=[...new Set(expected.items.filter(x=>x.status==='READY').map(x=>x.symbol))].sort();
  const rows=[],batches=[],errors=[];
  if(!symbols.length)errors.push('B01_NO_READY_CANDLE_TO_VERIFY');
  for(let offset=0;offset<symbols.length;offset+=100){
    const selected=symbols.slice(offset,offset+100),remaining=deadlineMs-now();
    if(remaining<=0){errors.push('B01_READBACK_BUDGET_EXHAUSTED');break;}
    const started=now();
    try{
      // <=300 rows per response, safely below the 1000-row REST ceiling.
      const result=await readRpc({symbols:selected,bars_per_symbol:3},{timeoutMs:Math.max(1,Math.min(5000,remaining))});
      if(!Array.isArray(result)||result.some(x=>!x||!selected.includes(x.symbol)))throw Error('INVALID_RESPONSE');
      rows.push(...result);
      batches.push({offset,symbols:selected,rows:result.length,elapsed_ms:now()-started,status:'READ'});
    }catch{
      errors.push('B01_ANON_RPC_READ_FAILED');
      batches.push({offset,symbols:selected,rows:null,elapsed_ms:now()-started,status:'FAILED'});
      break; // bounded failure; no retry fan-out on a source incident
    }
  }
  const readbackAt=new Date(now()).toISOString();
  const receipt=verifyCandleReadback(expected,rows,{read_role:'anon',db_readback_ok:errors.length===0,readback_at:readbackAt});
  const failed=[...errors,...receipt.failed_checks];
  return {...receipt,failed_checks:failed,first_blocker:failed[0]||null,exit_code:failed.length?1:0,
    candle_readback_verified:failed.length===0,status:failed.length?'BLOCKED':'CANDLE_READBACK_VERIFIED',
    checked_at:readbackAt,readback_at:readbackAt,evidence_checked_at:expected.checked_at,
    ready_requested_count:symbols.length,batches,source_data_gap_count:expected.items.filter(x=>x.status==='DATA_GAP').length};
}
module.exports={readbackCandles};
