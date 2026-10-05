'use strict';
const {hash}=require('./core.cjs');
const pick=(x,keys)=>Object.fromEntries(keys.filter(k=>x?.[k]!==undefined).map(k=>[k,x[k]]));
function compactView(view){return {...view,projection:'COMPACT_WITH_ARCHIVED_EVIDENCE',full_view_sha256:hash(view),signals:view.signals.map(s=>{
 const result=pick(s,['signal_id','run_id','strategy_id','strategy_version','source_mode','run_type','symbol','name','signal_date','signal_time','direction','candidate_status','original_candidate_status','reference_price','reference_price_type','holding_horizon','success_rule','eligible','eligibility_reason','score','ranking','matched_scripts','veto_flags','data_quality','data_snapshot_hash','strategy_code_hash']);
 result.evidence_reference={full_signal_sha256:hash(s),run_id:s.run_id,signal_id:s.signal_id,detail_availability:'FULL_DETAILS_IN_SHARED_ARCHIVE_NOT_INCLUDED_IN_WEB_PAYLOAD'};
 if(s.original_candidate){const c=s.original_candidate;result.candidate_evidence=pick(c,['base_date','source_asof','asof_status','source_snapshot_sha256','score','rank','menu_label']);result.candidate_features=pick(c.original_entry,['price_attack_score','previous_close','overheat_score','shape','bollinger','pattern_label','pattern_code','volume_gate']);}
 if(s.outcome){result.outcome=pick(s.outcome,['signal_id','status','reason','engine_version','evaluated_at','horizon','metrics','first_hit','time_to_target']);const o=s.outcome.original_research;if(o){result.outcome.original_research=pick(o,['evaluation_type','actual_entry_price','first_hit','finality','source_asof_verified','status','OHLC','reference_price','reference_price_type','metrics']);result.outcome.original_research.source=pick(o.source,['sha256','provider','cache_updated_at']);}}
 return result;
})};}
module.exports={compactView};
