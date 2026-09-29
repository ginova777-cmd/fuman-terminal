'use strict';
const {evaluateVolume}=require('./daytrade-volume-value-ranking');
const {evaluateTradeValue}=require('./daytrade-trade-value-evidence');
function collect({identity,symbols,volumeValue,turnover,asOf}){
 if(!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length)throw Error('REQUESTED_UNIVERSE_REQUIRED');
 for(const source of [volumeValue,turnover])if(source?.trade_date!==identity.trade_date||source.canonical_run_id!==identity.canonical_run_id)throw Error('LIQUIDITY_SOURCE_IDENTITY');
 const amounts=new Map((volumeValue.rows||[]).map(r=>[r.symbol,r]));
 const turns=new Map([...(turnover.rows||[]),...(turnover.data_gaps||[])].map(r=>[r.symbol,r]));
 const plans={B02:[],B03:[],B21:[]};
 for(const symbol of symbols){
  const raw=amounts.get(symbol)||{},volume=evaluateVolume(raw.volume,identity.trade_date,Date.parse(asOf)),amount=evaluateTradeValue(raw.amount,identity.trade_date,Date.parse(asOf));
  const ready=volume.status==='ready'&&amount.status==='ready';
  const common={symbol,source:'Fugle.provider_reported_cumulative',source_contract:'daytrade_volume_value_ranking_v1',source_updated_at:volume.event_at||amount.event_at||asOf,
   source_missing:!amounts.has(symbol),event_time:volume.event_at||null,is_synthetic:false,replay:false,look_ahead:false,
   volume:volume.value??null,volume_unit:volume.unit||null,trade_value:amount.trade_value_twd,trade_value_unit:'TWD',
   volume_evidence:volume,trade_value_evidence:amount,volume_event_at:volume.event_at||null,trade_value_event_at:amount.event_at||null};
  plans.B02.push({...common,status:ready?'READY':'DATA_GAP',data_gap_reason:ready?null:[...volume.reasons,...amount.reasons].join('|'),
   volume_rank:volumeValue.volume_ranking?.find(r=>r.symbol===symbol)?.rank??null,value_rank:volumeValue.value_ranking?.find(r=>r.symbol===symbol)?.rank??null});
  const sameMoment=volume.event_at===amount.event_at,vwapReady=ready&&sameMoment&&volume.volume_shares>0;
  plans.B21.push({...common,status:vwapReady?'READY':'DATA_GAP',data_gap_reason:vwapReady?null:'VWAP_CUMULATIVE_SOURCE_GAP_OR_TIME_MISMATCH',
   vwap:vwapReady?amount.trade_value_twd/volume.volume_shares:null});
  const t=turns.get(symbol),turnReady=t?.status==='ready'&&t.volume_event_at===volume.event_at&&t.cumulative_volume===volume.value&&t.volume_unit===volume.unit&&volume.status==='ready';
  plans.B03.push({...common,status:turnReady?'READY':'DATA_GAP',data_gap_reason:turnReady?null:(t?.reasons?.length?t.reasons:['TURNOVER_SOURCE_MISSING_OR_MISMATCH']).join('|'),
   source_contract:'daytrade_intraday_turnover_v1',issued_common_shares:t?.issued_common_shares??null,issued_shares_source_date:t?.shares_source_date??null,
   shares_source:t?.shares_source??null,shares_synced_at:t?.shares_synced_at??null,stock_master_run_id:t?.stock_master_run_id??null,
   turnover_pct:t?.turnover_pct??null,rank:t?.rank??null,turnover_evidence:t||null});
 }
 return Object.entries(plans).map(([module_id,rows])=>({...identity,module_id,created_at:asOf,requested_symbols:[...symbols],rows}));
}
module.exports={collect};
