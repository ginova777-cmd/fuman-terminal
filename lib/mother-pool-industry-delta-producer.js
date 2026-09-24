'use strict';
const {compare}=require('./mother-pool-industry-round-delta');
function collect({identity,discovery,asOf}){
 if(discovery?.trade_date!==identity.trade_date||discovery.canonical_run_id!==identity.canonical_run_id||!Array.isArray(discovery.requested_symbols))throw Error('INDUSTRY_DISCOVERY_IDENTITY');
 const requested=discovery.requested_symbols;if(!requested.length||new Set(requested).size!==requested.length)throw Error('INDUSTRY_REQUESTED_SET');
 const sources=new Map((discovery.source_rows||[]).map(r=>[r.symbol,r]));
 const industries=new Map((discovery.industry_heatmap||[]).map(r=>[r.industry,r]));
 const rows=requested.map(symbol=>{
  const source=sources.get(symbol),industry=industries.get(source?.classification?.industry);
  const current=industry?Object.fromEntries(['trade_date','canonical_run_id','writer_run_id','updated_at','symbols','formula_version','net_flow_proxy'].map(k=>[k,industry[k]])):null;
  const previous=industry?.previous_round_evidence||null;
  const computed=compare({current,previous,tradeDate:identity.trade_date,canonicalRunId:identity.canonical_run_id,asOf});
  const ready=computed.comparable&&current.writer_run_id===identity.writer_run_id&&current.symbols.includes(symbol);
  return {symbol,status:ready?'READY':'DATA_GAP',data_gap_reason:ready?null:computed.reason||'INDUSTRY_WRITER_IDENTITY',source:'MotherPool.industry_flow_proxy',source_contract:'daytrade_industry_delta_v1',
   source_updated_at:source?.event_at||discovery.updated_at,event_time:discovery.updated_at,is_synthetic:false,replay:false,look_ahead:false,
   industry:source?.classification?.industry||null,current_industry:current,previous_industry:previous,...computed,comparison_status:computed.status,status:ready?'READY':'DATA_GAP'};
 });
 return {...identity,module_id:'B07',created_at:asOf,requested_symbols:[...requested],rows};
}
module.exports={collect};
