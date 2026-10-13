'use strict';
// Isolated orchestration boundary. No filesystem, network, lease or runtime controls.
const crypto=require('node:crypto');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const fail=reason=>{throw Error(reason)};
const check=(ok,reason)=>{if(!ok)fail(reason)};
const time=x=>{const n=Date.parse(x);check(Number.isFinite(n),'TIME_INVALID');return n};
const day=x=>new Date(time(x)+28800000).toISOString().slice(0,10);
const SOURCES=Object.freeze(['volume_rank','turnover_rank','longyue_long','strategy3_v2','strategy4','strategy5','previous_stock_futures_strength']);
const MODULES=Object.freeze(Array.from({length:19},(_,i)=>'A'+String(i+1).padStart(2,'0')).filter(x=>x!=='A10'));
const keys=['trade_date','canonical_run_id','writer_run_id','generation_id','snapshot_generation','snapshot_sequence'];
function same(a,b){check(keys.every(k=>k==='snapshot_sequence'?Number.isInteger(a?.[k])&&a[k]>0&&a[k]===b?.[k]:typeof a?.[k]==='string'&&a[k].length>0&&a[k]===b?.[k]),'GENERATION_MISMATCH')}
function set(a){check(Array.isArray(a)&&a.every(x=>/^\d{4}$/.test(x)),'SYMBOLS_INVALID');return [...new Set(a)].sort()}
function equal(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b))}
function envelope(e,identity,asOf){same(e.identity,identity);check(time(e.available_at)<=time(asOf),'EVIDENCE_NOT_AVAILABLE');check(e.hash===hash(e.rows),'HASH_MISMATCH');check(e.complete===true,'INCOMPLETE_EVIDENCE')}
function union({bindings,sources,identity,asOf,previousTradeDate}){
 check(/^\d{4}-\d{2}-\d{2}$/.test(previousTradeDate)&&previousTradeDate<identity.trade_date,'PREVIOUS_DATE_UNBOUND');
 check(Object.keys(sources).every(k=>SOURCES.includes(k)),'UNAPPROVED_SOURCE');const audit=[],flags={};
 for(const name of SOURCES){const b=bindings[name],s=sources[name];
  check(b?.approved===true&&b.producer&&b.contract&&b.version&&b.owner,'SOURCE_BINDING_MISSING:'+name);
  check(s&&s.producer===b.producer&&s.contract===b.contract&&s.contract_version===b.version&&s.source_run_id,'SOURCE_IDENTITY:'+name);
  check(s.source_trade_date===previousTradeDate&&s.canonical_run_id===identity.canonical_run_id&&s.complete===true,'SOURCE_DATE_OR_COMPLETENESS:'+name);
  check(time(s.available_at)<=time(asOf)&&s.hash===hash(s.rows),'SOURCE_HASH_OR_TIME:'+name);
  check(Array.isArray(s.rows)&&Number.isInteger(s.original_count)&&s.original_count===s.rows.length,'SOURCE_COUNT:'+name);
  const accepted=[],rejected=[];for(const row of s.rows){if(/^\d{4}$/.test(row.symbol)&&row.accepted===true)accepted.push(row.symbol);else rejected.push(row)}
  check(!rejected.length,'SOURCE_REJECTED_ROWS:'+name);
  if(name==='previous_stock_futures_strength'){const m=s.near_month_mapping;check(m?.verified===true&&m.source_trade_date===previousTradeDate&&m.hash===hash(m.rows),'FUTURES_MAPPING_UNVERIFIED');for(const r of s.rows)check(m.rows.some(x=>x.symbol===r.symbol&&x.contract===r.contract&&x.contract_month===r.contract_month&&x.is_near_month===true),'FUTURES_MONTH_MISMATCH')}
  const symbols=set(accepted);audit.push({name,source_run_id:s.source_run_id,source_trade_date:s.source_trade_date,original_count:s.rows.length,deduplicated_count:symbols.length,duplicate_count:accepted.length-symbols.length,accepted:symbols,rejected});for(const symbol of symbols)(flags[symbol]||=[]).push(name);
 }return {symbols:Object.keys(flags).sort(),flags,audit,hash:hash(audit)};
}
function warmup({legacyStatus,historyVerified,liveDue,liveVerified,connectionOk,authenticationOk,identityOk,qualityOk}){
 const reason=!connectionOk?'CONNECTION_FAILED':!authenticationOk?'AUTHENTICATION_FAILED':!identityOk?'IDENTITY_FAILED':!qualityOk?'QUALITY_FAILED':null;
 return {legacy_status:legacyStatus,history_state:historyVerified?'HISTORY_READY':'DATA_GAP',live_state:reason?'BLOCKED':!liveDue?'LIVE_NOT_DUE':liveVerified?'LIVE_READY':'DATA_GAP',reason,formal_ready:false};
}
function refreshState(result,{preopen,liveDue,sourceEmptyVerified,transportHealthy,tradeDate}){
 check(result?.ok===true&&result.mode==='apply'&&result.trade_date===tradeDate,'REFRESH_FAILED');
 check(Number.isInteger(result.quotes_written)&&result.quotes_written>=0&&Number.isInteger(result.candles_written)&&result.candles_written>=0,'REFRESH_COUNTS_INVALID');
 if(result.quotes_written===0){check(preopen&&!liveDue&&sourceEmptyVerified&&transportHealthy,'ZERO_QUOTE_UNEXPLAINED');return {status:'LIVE_NOT_DUE',formal_ready:false,write_acknowledged:false}}
 return {status:'WRITTEN_PENDING_VERIFICATION',formal_ready:false,write_acknowledged:true};
}
function readbacks({plan,db,view,anon,identity,asOf}){
 envelope(plan,identity,asOf);const symbols=set(plan.symbols);check(symbols.length===plan.symbols.length,'PLAN_DUPLICATE');check(equal(set(plan.rows.map(x=>x.symbol)),symbols),'PLAN_SET_MISMATCH');check(plan.rows.length===symbols.length,'PLAN_ROWS_DUPLICATE');
 for(const e of [db,view,anon]){envelope(e,identity,asOf);check(e.rows.length===symbols.length&&equal(set(e.rows.map(x=>x.symbol)),symbols),'READBACK_SET_MISMATCH');check(equal([...e.rows].sort((a,b)=>a.symbol.localeCompare(b.symbol)),[...plan.rows].sort((a,b)=>a.symbol.localeCompare(b.symbol))),'READBACK_PAYLOAD_MISMATCH')}
 return {verified:true,hash:plan.hash,symbols};
}
function persistence({handoff,rounds,asOf}){
 const accepted=set(handoff.symbols),writers=new Set(),generations=new Set(),proof=[];
 for(const r of rounds){if(r.terminal?.success!==true)continue;const i=r.identity;
  check(i.trade_date===handoff.trade_date&&time(r.terminal.completed_at)>time(handoff.at)&&time(r.terminal.completed_at)<=time(asOf),'REFRESH_TIME_OR_DATE');
  same(r.terminal.identity,i);check(r.terminal.hash===hash(r.terminal.payload)&&r.terminal.payload.status==='SUCCESS','TERMINAL_PROOF');
  const p=readbacks({...r.readbacks,identity:i,asOf});check(accepted.every(s=>p.symbols.includes(s)),'HANDOFF_SYMBOL_LOST');
  check(r.candidate_set_unchanged===true,'CANDIDATE_UPGRADE');
  if(writers.has(i.writer_run_id)||generations.has(i.generation_id))continue;
  writers.add(i.writer_run_id);generations.add(i.generation_id);proof.push({identity:i,hash:p.hash});
 }check(proof.length>=2,'TWO_SUCCESSFUL_TERMINALS_REQUIRED');return {status:'PERSISTENCE_ACK',proof};
}
const slots=Object.freeze(['08:45','08:50','08:55','08:59']);
function trial({events,tradeDate,asOf,limits,scopeApproved,sourceContract,sourceVersion,symbols}){
 check(day(asOf)===tradeDate&&time(asOf)<time(tradeDate+'T09:00:00+08:00'),'FEATURE_CUTOFF');
 const requested=set(symbols);check(requested.length>0&&requested.length===symbols.length,'TRIAL_SCOPE');
 check(scopeApproved===true,'STORAGE_SCOPE_UNAPPROVED');check(Number.isInteger(limits?.maxEvents)&&limits.maxEvents>0&&Number.isInteger(limits.maxBytes)&&limits.maxBytes>0,'CAPACITY_UNBOUND');
 check(Array.isArray(events)&&events.length<=limits.maxEvents&&Buffer.byteLength(JSON.stringify(events))<=limits.maxBytes,'CAPTURE_LIMIT');
 const seen=new Set(),chains=new Map(),valid=[];
 for(const e of events){check(e.contract===sourceContract&&e.version===sourceVersion&&e.trade_date===tradeDate&&requested.includes(e.symbol)&&e.id&&e.natural===true&&e.synthetic!==true&&e.replay!==true,'TRIAL_IDENTITY');
  check(day(e.event_time)===tradeDate&&time(e.event_time)<=time(e.received_at)&&time(e.received_at)<=time(e.first_available_at)&&time(e.first_available_at)<=time(asOf),'TRIAL_AVAILABILITY');
  check(e.hash===hash(e.payload)&&Number.isFinite(e.payload.price)&&e.payload.price>0,'TRIAL_HASH_PRICE');
  check(Number.isInteger(e.revision)&&e.revision>=0,'REVISION_INVALID');const key=e.symbol+':'+e.id,unique=key+':'+e.revision;check(!seen.has(unique),'DUPLICATE_EVENT');seen.add(unique);
  const prior=chains.get(key);check(prior?e.revision===prior.revision+1&&e.previous_hash===prior.hash&&time(e.first_available_at)>=time(prior.first_available_at):e.revision===0&&!e.previous_hash,'REVISION_GAP');chains.set(key,e);valid.push(e);
 }
 const hm=new Date(time(asOf)+28800000).toISOString().slice(11,16),due=slots.filter(s=>s<=hm),bySymbol={};
 for(const symbol of requested){const points=slots.map(slot=>{const candidates=[...chains.values()].filter(e=>e.symbol===symbol&&new Date(time(e.event_time)+28800000).toISOString().slice(11,16)===slot).sort((a,b)=>time(a.event_time)-time(b.event_time));return candidates.at(-1)}).filter(Boolean);const missing=due.filter(s=>!points.some(e=>new Date(time(e.event_time)+28800000).toISOString().slice(11,16)===s));
  bySymbol[symbol]={points,missing,status:missing.length?'PENDING':due.length<4?'NOT_DUE':'PASS',changes:points.slice(1).map((e,i)=>({difference:e.payload.price-points[i].payload.price,percent:(e.payload.price/points[i].payload.price-1)*100,relative_previous_close:Number.isFinite(e.payload.previous_close)&&e.payload.previous_close>0?(e.payload.price/e.payload.previous_close-1)*100:null}))};}
 return {contract:'a17-isolated-backtest-v1-preparation',trade_date:tradeDate,as_of:asOf,granularity:'OBSERVED_EVENTS_ONLY',raw_events:valid,raw_hash:hash(valid),features:bySymbol,feature_hash:hash(bySymbol),feature_version:1,formal_ready:false};
}
function backtest(packet,labels){check(packet.raw_hash===hash(packet.raw_events)&&packet.feature_hash===hash(packet.features),'BACKTEST_HASH');for(const l of labels)check(day(l.event_time)===packet.trade_date&&time(l.event_time)>=time(packet.trade_date+'T09:00:00+08:00')&&time(l.available_at)>=time(l.event_time),'LABEL_TIME');return {features:structuredClone(packet),labels:structuredClone(labels),label_hash:hash(labels)}}
function calendarGate(e,tradeDate,asOf){check(e?.verified===true&&e.trade_date===tradeDate&&e.override!==true&&time(e.available_at)<=time(asOf)&&typeof e.is_trading_day==='boolean','CALENDAR_UNVERIFIED');return {status:e.is_trading_day?'DUE':'SKIPPED',formal_ready:false}}
function closure({moduleId,roleApproval,asOf,identity,parents,expectedSymbols}){
 check(roleApproval?.approved===true&&roleApproval.module_id===moduleId,'CLOSURE_ROLE_UNAPPROVED');
 const deps=moduleId==='A14'?MODULES.filter(x=>Number(x.slice(1))<=13):moduleId==='A18'?['A15','A16','A17']:moduleId==='A19'?MODULES.filter(x=>x!=='A19'):fail('MODULE_INVALID');
 if(time(asOf)<time(roleApproval.not_before))return {status:'NOT_DUE',formal_ready:false};
 for(const id of deps){const p=parents[id];check(p,'PARENT_MISSING:'+id);same(p.identity,identity);check(equal(set(p.symbols),set(expectedSymbols)),'PARENT_SET:'+id);check(p.hash===hash(p.payload),'PARENT_HASH:'+id);check(p.status==='PASS'&&p.verified===true,'PARENT_NOT_VERIFIED:'+id);if(id==='A17')check(p.payload.backtest_verified===true,'A17_HANDOFF_MISSING')}
 return {status:'PASS',identity,dependencies:deps,formal_ready:false};
}
function recovery({policy,identity,isolatedEvidence}){
 check(policy.trade_date===identity.trade_date&&policy.release_sha===identity.release_sha,'POLICY_IDENTITY_MISMATCH');
 check(policy.enabled.every(id=>MODULES.includes(id))&&new Set(policy.enabled).size===policy.enabled.length,'MODULE_SCOPE');
 for(const id of policy.enabled){const e=isolatedEvidence[id];check(e?.module_id===id&&e.release_sha===identity.release_sha&&e.integration_pass===true&&e.hash===hash(e.payload),'MODULE_ISOLATION_NOT_IMPLEMENTED:'+id)}
 return {isolated_allowed:[...policy.enabled],formal_enabled:[],formal_authorization:false};
}
async function execute(steps){const completed=[];try{for(const [name,run] of steps){completed.push({name,result:await run()})}return {status:'ISOLATED_CHAIN_PASS',completed,formal_ready:false}}catch(e){return {status:'STOP',first_blocker:e.message,completed,formal_ready:false}}}
module.exports={SOURCES,MODULES,hash,union,warmup,refreshState,readbacks,persistence,trial,backtest,closure,recovery,execute,calendarGate};
