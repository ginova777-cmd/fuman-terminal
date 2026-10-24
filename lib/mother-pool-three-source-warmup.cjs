'use strict';
const {inspect}=require('./mother-pool-strategy-bridge-rows');
const {sourceFields}=require('./terminal-strategy-morning-handoff');
const {hash}=require('./mother-pool-stock-module-write-set');
const SOURCES=Object.freeze(['strategy4','strategy5','institution']);
const unique=a=>[...new Set(a)].sort();
function collect({bridge,tradeDate,asOf}){
 const sources={},flags={};
 const validTime=Number.isFinite(Date.parse(asOf))&&Number.isFinite(Date.parse(bridge?.updatedAt))&&Date.parse(bridge.updatedAt)<=Date.parse(asOf);
 for(const key of SOURCES){
  const g=bridge?.groups?.[key],h=g?.handoff,r=sourceFields(g?.sourceReceipt),failures=[];
  if(bridge?.tradeDate!==tradeDate||!validTime)failures.push('BRIDGE_IDENTITY_OR_TIME_INVALID');
  if(g?.status!=='ready'||h?.ok!==true||!Array.isArray(h?.failed_checks)||h.failed_checks.length||h.handoff_trade_date!==tradeDate||h.strategy_source_date!==bridge?.previousSourceDate||h.previous_completed_trade_date!==bridge?.previousSourceDate||h.source_run_id!==g?.runId)failures.push('SOURCE_HANDOFF_INVALID');
  if(!r.complete||r.runId!==g?.runId||r.sourceDate!==bridge?.previousSourceDate||!Number.isFinite(r.checkedAt)||r.checkedAt>Date.parse(asOf))failures.push('SOURCE_RECEIPT_INVALID');
  const checked=inspect({run:g?.sourceReceipt,rows:g?.sourceRows,runId:g?.runId,sourceDate:bridge?.previousSourceDate});failures.push(...checked.failed_checks);
  const rows=Array.isArray(g?.sourceRows)?g.sourceRows:[],excluded=[];
  const eligible=unique(rows.filter(row=>{const q=String(row.quality_status||'').toLowerCase();const ok=row.complete!==false&&(!q||['complete','recovery_replay_complete','ok','ready','pass','a'].includes(q));if(!ok)excluded.push({symbol:String(row.code||row.symbol||''),reason:'SOURCE_ROW_QUALITY_NOT_ACCEPTED'});return ok;}).map(row=>String(row.code||row.symbol||'')));
  if(JSON.stringify(unique(g?.symbols||[]))!==JSON.stringify(eligible))failures.push('SOURCE_SYMBOL_SET_MISMATCH');
  const blacklist=require('./mother-pool-blacklist.cjs');
  for(const symbol of eligible.filter(blacklist.blocked))excluded.push({symbol,reason:blacklist.reason});
  const accepted=failures.length?[]:eligible.filter(s=>!blacklist.blocked(s));
  for(const symbol of accepted)(flags[symbol]||=[]).push(key);
  sources[key]={status:failures.length?'BLOCKED':'READ_VERIFIED',source_run_id:g?.runId||null,source_date:r.sourceDate||null,source_receipt_sha256:hash(g?.sourceReceipt),rows_sha256:hash(rows),expected_count:checked.expected_count,read_count:rows.length,accepted_symbols:accepted,excluded,failed_checks:unique(failures)};
 }
 return {contract:'mother_pool_three_strategy_warmup_v1',trade_date:tradeDate,checked_at:asOf,scope:SOURCES,sources,symbols:Object.keys(flags).sort(),source_flags:flags,read_complete:SOURCES.every(k=>sources[k].status==='READ_VERIFIED'),warmup_complete:false,formal_a03_complete:false};
}
function admission(source,warmupSymbols,candlePrioritySymbols){
 const warm=new Set(warmupSymbols),candles=new Set(candlePrioritySymbols);
 const rows=source.symbols.map(symbol=>({symbol,sources:source.source_flags[symbol],warmup_requested:warm.has(symbol),candle_requested:candles.has(symbol),status:warm.has(symbol)&&candles.has(symbol)?'ADMITTED_PENDING_DATA':'ADMISSION_MISSING',warmup_complete:false}));
 return {...source,rows,admission_complete:source.read_complete&&rows.every(r=>r.status==='ADMITTED_PENDING_DATA'),warmup_complete:false,formal_a03_complete:false};
}
module.exports={SOURCES,collect,admission};
