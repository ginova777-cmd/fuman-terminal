'use strict';
function collect({identity,discovery,asOf}){
 if(discovery?.trade_date!==identity.trade_date||discovery.canonical_run_id!==identity.canonical_run_id||!Array.isArray(discovery.requested_symbols))throw Error('INDUSTRY_SOURCE_IDENTITY');
 const sources=new Map((discovery.source_rows||[]).map(r=>[r.symbol,r])),industries=new Map((discovery.industry_heatmap||[]).map(r=>[r.industry,r]));
 const plans={B06:[],B08:[]};
 for(const symbol of discovery.requested_symbols){
  const s=sources.get(symbol),flow=industries.get(s?.classification?.industry),ready=!!s&&!!flow&&flow.writer_run_id===identity.writer_run_id;
  const common={symbol,source:'Fugle.provider_reported_cumulative',source_contract:'daytrade_industry_flow_v1',source_updated_at:s?.event_at||discovery.updated_at,event_time:discovery.updated_at,
   is_synthetic:false,replay:false,look_ahead:false,industry:s?.classification?.industry||null,trade_value:s?.trade_value??null,trade_value_unit:'TWD',
   direction:s?s.change_percent>0?'UP':s.change_percent<0?'DOWN':'FLAT':null,proxy_flow:s?s.change_percent>0?s.trade_value:s.change_percent<0?-s.trade_value:0:null,
   industry_net_flow:flow?.net_flow_proxy??null,breadth_pct:flow?.breadth_percent??null,concentration_pct:flow?.flow_share_percent??null,flow_semantics:'DIRECTION_WEIGHTED_TRADE_VALUE_PROXY',
   status:ready?'READY':'DATA_GAP',data_gap_reason:ready?null:'INDUSTRY_SOURCE_MISSING'};
  plans.B06.push(common);
  const hotReady=ready&&flow.comparison?.comparable===true;
  plans.B08.push({...common,source_contract:'daytrade_industry_hot_inflow_v1',status:hotReady?'READY':'DATA_GAP',data_gap_reason:hotReady?null:'INDUSTRY_PRIOR_ROUND_NOT_COMPARABLE',
   top3_rank:flow?.flow_rank??null,sudden_rank:flow?.sudden_inflow_rank??null,ntd_threshold:500000000,
   persistent_inflow:flow?.persistent_large_inflow??null,sudden_inflow:flow?.sudden_large_inflow??null,
   volume_confirmation:flow?.industry_volume_expansion_confirmed??null,price_confirmation:flow?.industry_price_rise_continuing??null});
 }
 return Object.entries(plans).map(([module_id,rows])=>({...identity,module_id,created_at:asOf,requested_symbols:[...discovery.requested_symbols],source_evidence:{discovery},rows}));
}
module.exports={collect};
