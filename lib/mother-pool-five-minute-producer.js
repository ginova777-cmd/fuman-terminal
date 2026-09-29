'use strict';
const {isEffectiveRow}=require('../scripts/daytrade-intraday-5m-coverage-contract');
const {fiveMinuteAligned}=require('./daytrade-mother-pool-snapshot');
const BRANCHES=['rsi3_cross_rsi6_up_5m','kd_5_3_golden_cross_5m','macd_3_9_3_golden_cross_5m','ma5_cross_ma10_up_5m','ma10_cross_ma20_up_5m','ma5_cross_ma20_up_5m'];
function envelopeOk(receipt,snapshot,asOf){
 const now=Date.parse(asOf),checked=Date.parse(receipt?.verified_at);
 return receipt?.contract==='daytrade_intraday_5m_runner_verifier_receipt_v4'&&receipt.strategy_version==='golden-cross-any-macd-3-9-3-v4'&&receipt.calculation_version==='five-minute-indicators-macd-3-9-3-v4'&&receipt.classification_contract==='daytrade_intraday_5m_branch_independent_strict_wait_v1'&&receipt.complete===true&&receipt.status==='complete'&&receipt.exit_code===0&&receipt.first_blocker===null&&Array.isArray(receipt.failed_checks)&&!receipt.failed_checks.length&&receipt.anon_http_status===200&&receipt.ssl_ok===true&&typeof receipt.run_id==='string'&&!!receipt.run_id&&Number.isFinite(checked)&&checked<=now&&now-checked<=600000&&fiveMinuteAligned(receipt,snapshot);
}
function collect({identity,snapshot,receipt,history,asOf}){
 if(snapshot.trade_date!==identity.trade_date||snapshot.canonical_run_id!==identity.canonical_run_id||snapshot.mother_pool_run_id!==identity.mother_pool_run_id||snapshot.snapshot_sequence!==identity.snapshot_sequence||snapshot.generation!==identity.snapshot_generation)throw Error('FIVE_MINUTE_SNAPSHOT_IDENTITY');
 const ok=envelopeOk(receipt,snapshot,asOf),requested=receipt?.requested_symbols||[];
 const rows=snapshot.symbols.map(symbol=>{
  const bars=(Array.isArray(history)?history:[]).filter(r=>r.symbol===symbol).sort((a,b)=>Date.parse(a.bar_start)-Date.parse(b.bar_start)),last=bars.at(-1);
  const duplicate=new Set(bars.map(b=>b.bar_start)).size!==bars.length;
  const ready=ok&&!duplicate&&requested.includes(symbol)&&isEffectiveRow(last,{tradeDate:identity.trade_date,runId:receipt?.run_id,asOfMs:Date.parse(asOf),maxStaleSeconds:600});
  return {symbol,status:ready?'READY':'DATA_GAP',data_gap_reason:ready?null:!ok?'FIVE_MINUTE_RECEIPT_INVALID':duplicate?'FIVE_MINUTE_DUPLICATE_BAR':'FIVE_MINUTE_SOURCE_NOT_EFFECTIVE',
   source:'fugle_stock_intraday_candles_timeframe_5',source_contract:'daytrade_technical_5m_context_v1',source_updated_at:receipt?.verified_at||asOf,event_time:last?.bar_end||asOf,is_synthetic:false,replay:false,look_ahead:false,
   five_minute_run_id:receipt?.run_id||null,bar_end:last?.bar_end||null,quality_status:ready?last.trend_5m_status:'DATA_GAP_5M',
   kd:{k:last?.kd_k_5m??null,d:last?.kd_d_5m??null},rsi:{rsi3:last?.rsi3_5m??null,rsi6:last?.rsi6_5m??null},macd:{dif:last?.macd_3_9_3_dif_5m??null,dea:last?.macd_3_9_3_dea_5m??null,histogram:last?.macd_3_9_3_histogram_5m??null},
   branches:Object.fromEntries(BRANCHES.map(k=>[k,last?.[k]??null])),bonus_eligible:ready&&last.trend_5m_status==='CONFIRMED_STRONG_5M',formal_candidate_allowed:false,source_history:bars};
 });
 return {...identity,module_id:'B15',created_at:asOf,requested_symbols:[...snapshot.symbols],rows,source_evidence:{receipt,snapshot}};
}
module.exports={collect,envelopeOk,BRANCHES};
