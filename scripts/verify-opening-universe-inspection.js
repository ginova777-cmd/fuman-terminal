"use strict";
const fs=require('fs'),crypto=require('crypto');
function verify(report,rawBytes,symbols){
 const failed=[];const check=(ok,name)=>{if(!ok)failed.push(name);};
 const raw=JSON.parse(rawBytes.toString('utf8').replace(/^\uFEFF/,''));
 check(report.ok===true&&report.inspection_only===true,'inspection_contract');
 check(report.source_sha256===crypto.createHash('sha256').update(rawBytes).digest('hex'),'raw_readback_hash');
 check(report.trade_date===raw.trade_date,'trade_date');
 const rows=report.rows||[],codes=rows.map(r=>r.symbol).sort();
 check(JSON.stringify(codes)===JSON.stringify([...symbols].sort())&&new Set(codes).size===codes.length,'terminal_union_exact_coverage');
 check(report.symbol_count===symbols.length,'symbol_count');
 for(const row of rows){
  const source=raw.rows.find(r=>r.symbol===row.symbol);
  check(row.strategies?.length===10,`${row.symbol}:ten_rules`);
  const matches=[],gaps=[];
  for(let i=0;i<10;i++){
   const s=row.strategies?.[i];check(s?.no===i+1&&['MATCHED','NOT_MATCHED','DATA_GAP'].includes(s?.status),`${row.symbol}:rule_${i+1}`);
   if(s?.status==='MATCHED'){matches.push(i+1);check(source?.matched_strategy_numbers?.includes(i+1),`${row.symbol}:unsupported_match_${i+1}`);}
   if(s?.status==='DATA_GAP')gaps.push(i+1);
  }
  check(JSON.stringify(matches)===JSON.stringify(row.matched_strategy_numbers),`${row.symbol}:match_count`);
  check(JSON.stringify(gaps)===JSON.stringify(row.pending_strategy_numbers),`${row.symbol}:gap_count`);
 }
 check(report.summary?.length===10,'summary_ten_rules');
 for(let i=0;i<10;i++){
  const s=report.summary?.[i];
  check(s?.strategy===i+1&&s?.checked===symbols.length,'summary_identity');
  for(const [field,status]of [['matched','MATCHED'],['not_matched','NOT_MATCHED'],['data_gap','DATA_GAP']])check(s?.[field]===rows.filter(r=>r.strategies?.[i]?.status===status).length,`summary_${i+1}_${field}`);
 }
 return {ok:failed.length===0,contract:'opening_universe_inspection_verifier_v1',checked_at:new Date().toISOString(),symbol_count:symbols.length,failed_checks:failed,first_blocker:failed[0]||null};
}
module.exports={verify};
