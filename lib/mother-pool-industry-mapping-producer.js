'use strict';
const {evaluate}=require('./verify-mother-pool-industry-mapping');
function collect({identity,discovery,asOf}){
 if(discovery?.trade_date!==identity.trade_date||discovery.canonical_run_id!==identity.canonical_run_id||!Array.isArray(discovery.requested_symbols))throw Error('INDUSTRY_MAPPING_IDENTITY');
 const sources=new Map((discovery.mapping_rows||[]).map(r=>[r.symbol,r.classification]));
 const rows=discovery.requested_symbols.map(symbol=>{const classification=sources.get(symbol)||null,r=evaluate({symbol,classification,tradeDate:identity.trade_date,asOf});return {symbol,...r,classification,status:r.failed_checks.length?'DATA_GAP':'READY',data_gap_reason:r.failed_checks.join('|')||null,source:'MOPS+approved_local_industry_mapping',source_contract:'daytrade_industry_mapping_v1',source_updated_at:classification?.officialEvidence?.fetched_at||asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false};});
 return {...identity,module_id:'B05',created_at:asOf,requested_symbols:[...discovery.requested_symbols],rows};
}
module.exports={collect};
