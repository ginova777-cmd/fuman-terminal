'use strict';
const {inspect}=require('./mother-pool-strategy-bridge-rows');
const {sourceFields}=require('./terminal-strategy-morning-handoff');
const {hash}=require('./mother-pool-stock-module-write-set');
const SOURCES=Object.freeze(['strategy4','strategy5','institution']);
const unique=a=>[...new Set(a)].sort();
function sourceReceiptWithCount(key,run,rows,pages){
 if(key!=='strategy3'||Number.isInteger(run?.result_count)||Number.isInteger(run?.resultCount))return run;
 if(run?.strategy!=='strategy3_v2'||run?.contract!=='strategy3-v2-clean-chain-v1'||run?.complete!==true||!Array.isArray(rows)||!Array.isArray(pages)||!pages.length)throw Error('STRATEGY3_EXACT_COUNT_UNPROVEN');
 let total=null,offset=0;const collected=[];
 for(const p of pages){const m=/^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(p.content_range||'');
 if(!m||![200,206].includes(p.http_status)||p.offset!==offset||!Array.isArray(p.row_data)||p.rows!==p.row_data.length||p.rows>p.requested)throw Error('STRATEGY3_PAGE_INVALID');
 const n=Number(m[3]);if(total!==null&&total!==n)throw Error('STRATEGY3_COUNT_CHANGED');total=n;
 if(p.rows&&(Number(m[1])!==offset||Number(m[2])-offset+1!==p.rows))throw Error('STRATEGY3_RANGE_INVALID');
 if(!p.rows&&total!==0)throw Error('STRATEGY3_EMPTY_PAGE_INVALID');
 collected.push(...p.row_data);offset+=p.rows;}
 if(total!==rows.length||hash(collected)!==hash(rows))throw Error('STRATEGY3_PAGE_ROWS_MISMATCH');
 return {...run,result_count:total,mother_pool_count_evidence:{source:'POSTGREST_EXACT_COUNT',original_receipt_sha256:hash(run),pages_sha256:hash(pages)}};
}
function collect({bridge,tradeDate,asOf,sourceKeys=SOURCES}){
 if(!Array.isArray(sourceKeys)||!sourceKeys.length||new Set(sourceKeys).size!==sourceKeys.length||sourceKeys.some(k=>![...SOURCES,'strategy3'].includes(k)))throw Error('WARMUP_SOURCE_SCOPE_INVALID');
 const sources={},flags={};
 const validTime=Number.isFinite(Date.parse(asOf))&&Number.isFinite(Date.parse(bridge?.updatedAt))&&Date.parse(bridge.updatedAt)<=Date.parse(asOf);
 for(const key of sourceKeys){
  const g=bridge?.groups?.[key],h=g?.handoff,r=sourceFields(g?.sourceReceipt),failures=[];
  if(bridge?.tradeDate!==tradeDate||!validTime)failures.push('BRIDGE_IDENTITY_OR_TIME_INVALID');
  if(g?.status!=='ready'||h?.ok!==true||!Array.isArray(h?.failed_checks)||h.failed_checks.length||h.handoff_trade_date!==tradeDate||h.strategy_source_date!==bridge?.previousSourceDate||h.previous_completed_trade_date!==bridge?.previousSourceDate||h.source_run_id!==g?.runId)failures.push('SOURCE_HANDOFF_INVALID');
  if(!r.complete||r.runId!==g?.runId||r.sourceDate!==bridge?.previousSourceDate||!Number.isFinite(r.checkedAt)||r.checkedAt>Date.parse(asOf))failures.push('SOURCE_RECEIPT_INVALID');
  let counted=g?.sourceReceipt;try{counted=sourceReceiptWithCount(key,counted,g?.sourceRows,g?.pages)}catch(e){failures.push(e.message)}
  const checked=inspect({run:counted,rows:g?.sourceRows,runId:g?.runId,sourceDate:bridge?.previousSourceDate});failures.push(...checked.failed_checks);
  const rows=Array.isArray(g?.sourceRows)?g.sourceRows:[],excluded=[];
  const eligible=unique(rows.filter(row=>{const q=String(row.quality_status||'').toLowerCase();const ok=row.complete!==false&&(!q||['complete','recovery_replay_complete','ok','ready','pass','a'].includes(q));if(!ok)excluded.push({symbol:String(row.code||row.symbol||''),reason:'SOURCE_ROW_QUALITY_NOT_ACCEPTED'});return ok;}).map(row=>String(row.code||row.symbol||'')));
  if(JSON.stringify(unique(g?.symbols||[]))!==JSON.stringify(eligible))failures.push('SOURCE_SYMBOL_SET_MISMATCH');
  const blacklist=require('./mother-pool-blacklist.cjs');
  for(const symbol of eligible.filter(blacklist.blocked))excluded.push({symbol,reason:blacklist.reason});
  const accepted=failures.length?[]:eligible.filter(s=>!blacklist.blocked(s));
  for(const symbol of accepted)(flags[symbol]||=[]).push(key);
  sources[key]={status:failures.length?'BLOCKED':'READ_VERIFIED',source_run_id:g?.runId||null,source_date:r.sourceDate||null,source_receipt_sha256:hash(g?.sourceReceipt),rows_sha256:hash(rows),expected_count:checked.expected_count,read_count:rows.length,accepted_symbols:accepted,excluded,failed_checks:unique(failures)};
 }
 return {contract:sourceKeys===SOURCES?'mother_pool_three_strategy_warmup_v1':'mother_pool_checked_strategy_warmup_v1',trade_date:tradeDate,checked_at:asOf,scope:[...sourceKeys],sources,symbols:Object.keys(flags).sort(),source_flags:flags,read_complete:sourceKeys.every(k=>sources[k].status==='READ_VERIFIED'),warmup_complete:false,formal_a03_complete:false};
}
function admission(source,warmupSymbols,candlePrioritySymbols){
 const warm=new Set(warmupSymbols),candles=new Set(candlePrioritySymbols);
 const rows=source.symbols.map(symbol=>({symbol,sources:source.source_flags[symbol],warmup_requested:warm.has(symbol),candle_requested:candles.has(symbol),status:warm.has(symbol)&&candles.has(symbol)?'ADMITTED_PENDING_DATA':'ADMISSION_MISSING',warmup_complete:false}));
 return {...source,rows,admission_complete:source.read_complete&&rows.every(r=>r.status==='ADMITTED_PENDING_DATA'),warmup_complete:false,formal_a03_complete:false};
}
module.exports={SOURCES,collect,admission,sourceReceiptWithCount};
