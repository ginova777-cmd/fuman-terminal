'use strict';
const DECISION='MP-A04-OWNER-DECISION-20261013';
const UNKNOWN_REASON='HISTORICAL_PRICE_RULE_CONTRACT_REQUIRED';
function compose(volume,price,source){
 const validVolume=source.ok&&volume.status==='READY',validPrice=source.ok&&price.status==='READY';
 const conditions={
  volume_2x:{state:validVolume?'VERIFIED':'DATA_GAP',matched_dates:validVolume?volume.volume_2x_dates:[]},
  volume_2_5x:{state:validVolume?'VERIFIED':'DATA_GAP',matched_dates:validVolume?volume.volume_2_5x_dates:[]},
  close_return_7pct:{state:validPrice?'VERIFIED':'DATA_GAP',matched_dates:validPrice?price.matched_dates:[]},
  limit_up:{state:'UNKNOWN',matched_dates:[],reason:UNKNOWN_REASON},
  near_limit_up:{state:'UNKNOWN',matched_dates:[],reason:UNKNOWN_REASON,max_legal_ticks:2},
 };
 const hits=Object.entries(conditions).flatMap(([condition,c])=>c.state==='VERIFIED'?c.matched_dates.map(trade_date=>({condition,trade_date})):[]);
 return {owner_decision:DECISION,conditions,hits,warmup_eligible:hits.length>0,
  warmup_state:hits.length?'WARMUP_ELIGIBLE':Object.values(conditions).some(c=>c.state==='DATA_GAP')?'DATA_GAP':'NO_VERIFIED_HIT',
  module_complete:false,complete:false,formal_candidate_allowed:false,publish_allowed:false,
  source_hash:source.source_hash,source_proof_hash:source.proof_hash,binding_sha256:source.binding_sha256};
}
module.exports={compose,DECISION};
