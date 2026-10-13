'use strict';
const crypto=require('node:crypto');
const names=['volume_rank','turnover_rank','longyue_long','strategy3_v2','strategy4','strategy5','previous_stock_futures_strength'];
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function verify(input={}){
 try{return verifyChecked(input);}catch{return {ok:false,failed_checks:["MALFORMED_INPUT"]};}
}
function verifyChecked({bindings,sources,identity,previousTradeDate,asOf}){
 const errors=[],need=(v,e)=>{if(!v)errors.push(e);},now=Date.parse(asOf),local=Number.isFinite(now)?new Date(now+28800000).toISOString():'';
 need(/^\d{4}-\d{2}-\d{2}$/.test(previousTradeDate||'')&&previousTradeDate<identity?.trade_date,'PREVIOUS_DATE_INVALID');
 need(local.slice(0,10)===identity?.trade_date&&local.slice(11,16)>='06:00'&&local.slice(11,16)<'09:00','PREOPEN_AS_OF_REQUIRED');
 need(typeof identity?.canonical_run_id==='string'&&identity.canonical_run_id===`fugle_daytrade_source:${String(identity.trade_date).replaceAll('-','')}:canonical`,'CANONICAL_INVALID');
 need(sources&&Object.keys(sources).every(k=>names.includes(k)),'UNAPPROVED_SOURCE');
 for(const name of names){const b=bindings?.[name],s=sources?.[name];
  need(b?.approved===true&&b.owner&&b.approval_id&&b.producer&&b.contract&&b.version,name+':BINDING_MISSING');
  if(!s){errors.push(name+':SOURCE_MISSING');continue;}
  need(s.producer===b?.producer&&s.contract===b?.contract&&s.contract_version===b?.version&&typeof s.source_run_id==='string'&&s.source_run_id.length>0,name+':IDENTITY');
  need(s.source_trade_date===previousTradeDate&&s.canonical_run_id===identity?.canonical_run_id,name+':DATE_OR_CANONICAL');
  need(s.complete===true&&Number.isInteger(s.original_count)&&Array.isArray(s.rows)&&s.original_count===s.rows.length,name+':INCOMPLETE_ROWS');
  need(Number.isFinite(Date.parse(s.available_at))&&Date.parse(s.available_at)<=now,name+':UNAVAILABLE');
  need(Array.isArray(s.rows)&&s.hash===hash(s.rows),name+':HASH');
  need(Array.isArray(s.rows)&&s.rows.every(r=>/^\d{4}$/.test(r.symbol||'')&&r.accepted===true),name+':REJECTED_ROWS');
  if(name==='previous_stock_futures_strength'){
   const m=s.near_month_mapping;need(m?.verified===true&&m.source_trade_date===previousTradeDate&&Array.isArray(m.rows)&&m.hash===hash(m.rows),name+':MAPPING_UNVERIFIED');
   for(const r of s.rows||[]){const match=(m?.rows||[]).filter(x=>x.symbol===r.symbol&&x.is_near_month===true);need(match.length===1&&match[0].contract===r.contract&&match[0].contract_month===r.contract_month,name+':AMBIGUOUS_OR_WRONG_CONTRACT');}
  }
 }
 return {ok:errors.length===0,failed_checks:errors};
}
// List types are review vocabulary, NOT additions to the production registry.
const LIST_TYPES=Object.freeze(['morning_second','longyue_long','longyue_short','institution','strategy4','strategy5']);
const dateValid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(s)?Date.parse(s):NaN;
function verifyIndependent(input={}){
 try{return independentChecked(input);}catch{return {ok:false,failed_checks:['MALFORMED_INPUT']};}
}
function independentChecked({listType,source,binding,context,mode}){
 const errors=[],need=(v,e)=>{if(!v)errors.push(e);};
 need(mode==='isolated_candidate','ISOLATION_REQUIRED');
 need(LIST_TYPES.includes(listType),'UNKNOWN_LIST_TYPE');
 const c=context||{},s=source||{},b=binding||{},r=s.receipt||{},v=s.verifier||{};
 const now=stamp(c.as_of),local=Number.isFinite(now)?new Date(now+28800000).toISOString():'';
 need(dateValid(c.trade_date)&&local.slice(0,10)===c.trade_date&&local.slice(11,16)>='06:00'&&local.slice(11,16)<'09:00','PREOPEN_CONTEXT');
 // Caller supplies a trusted completed-session calendar, never calendar-day - 1.
 const cal=c.calendar,dates=cal?.completed_sessions;
 const validCalendar=cal?.verified===true&&typeof cal.evidence_id==='string'&&cal.evidence_id.length>0&&Array.isArray(dates)&&dates.length>0&&dates.every(dateValid)&&new Set(dates).size===dates.length&&dateValid(c.previous_trade_date)&&[...dates].filter(d=>d<c.trade_date).sort().at(-1)===c.previous_trade_date;
 need(validCalendar,'TRADING_CALENDAR_REQUIRED');
 need(b.approved===true&&b.approval_id&&b.owner&&b.list_type===listType&&b.producer&&b.contract&&b.version&&['code','symbol','stock_id'].includes(b.symbol_field),'BINDING_REQUIRED');
 need(s.producer===b.producer&&s.contract===b.contract&&s.version===b.version&&typeof s.run_id==='string'&&s.run_id.length>0,'SOURCE_IDENTITY');
 const expected=listType==='morning_second'?c.trade_date:c.previous_trade_date;
 need(s.source_trade_date===expected&&s.delivery_date===c.trade_date,'SOURCE_DATE');
 const direction=listType==='longyue_long'?'long':listType==='longyue_short'?'short':'observation';
 need(s.direction===direction,'DIRECTION');
 const rows=s.rows,rowsOk=Array.isArray(rows)&&rows.every(x=>x&&typeof x[b.symbol_field]==='string'&&/^\d{4}$/.test(x[b.symbol_field]));
 need(rowsOk&&new Set(rows.map(x=>x[b.symbol_field])).size===rows.length,'FULL_SYMBOL_ROWS');
 need(Number.isInteger(s.original_count)&&s.original_count>=0&&Array.isArray(rows)&&rows.length===s.original_count,'FULL_COUNT');
 const digest=Array.isArray(rows)?hash(rows):null;
 need(typeof digest==='string'&&s.rows_hash===digest,'ROWS_HASH');
 // Upstream receipts must independently identify and cover THIS full list.
 // A bridge/handoff ACK or a Mother Pool snapshot is never a completion proof.
 need(r.scope==='upstream_scan'&&r.complete===true&&r.quality_pass===true&&r.run_id===s.run_id&&r.source_trade_date===expected&&r.version===s.version&&r.list_type===listType&&r.count===s.original_count&&r.rows_hash===digest,'UPSTREAM_RECEIPT');
 need(v.scope==='upstream_source'&&v.ok===true&&Array.isArray(v.failed_checks)&&v.failed_checks.length===0&&v.run_id===s.run_id&&v.list_type===listType&&v.source_trade_date===expected&&v.version===s.version&&v.count===s.original_count&&v.rows_hash===digest,'UPSTREAM_VERIFIER');
 const finish=stamp(r.finished_at),checked=stamp(v.checked_at),published=stamp(s.published_at),available=stamp(s.available_at);
 need([finish,checked,published,available,now].every(Number.isFinite)&&finish<=checked&&checked<=published&&published<=available&&available<=now&&finish>=Date.parse(expected+'T00:00:00+08:00'),'AVAILABILITY');
 need(rowsOk&&rows.every(x=>![x.synthetic,x.is_synthetic,x.replay,x.look_ahead].includes(true)),'NONPRODUCTION_ROWS');
 if(listType==='morning_second')need(s.stage==='asia_0850'&&r.stage===s.stage&&v.stage===s.stage&&finish>=Date.parse(c.trade_date+'T08:50:00+08:00'),'SECOND_ROUND_NOT_COMPLETE');
 return {ok:errors.length===0,failed_checks:errors,expected_source_date:expected,direction,rows_hash:digest};
}
function verifySavedSource(input={}){
 try{return savedChecked(input);}catch{return {ok:false,failed_checks:['MALFORMED_SAVED_SOURCE'],data_checks:{}};}
}
function savedChecked({kind,bridge,completion,readback,binding,mapping,delivery,context}){
 const errors=[],data={},need=(v,k)=>{data[k]=!!v;if(!v)errors.push(k);};
 const expected={institution:['v_institution_latest_complete_run/institution_scan_results','institution-run-id-complete-v1'],strategy5:['v_strategy5_latest_complete_run/strategy5_scan_results','strategy5-run-id-complete-v1']}[kind];
 if(!expected)return {ok:false,failed_checks:['UNSUPPORTED_RAW_PRODUCER'],data_checks:{}};
 const g=bridge?.groups?.[kind],r=g?.sourceReceipt,rows=g?.sourceRows,c=context||{},h=g?.handoff;
 need(r?.strategy===kind&&r?.schema_version===expected[1]&&typeof r?.run_id==='string'&&r.run_id===g?.runId,'RAW_IDENTITY');
 need(r?.scan_date===c.previous_trade_date,'RAW_SOURCE_DATE');
 need(r?.complete===true&&r.status==='complete'&&r.quality_status==='complete','RAW_COMPLETION');
 need(Array.isArray(rows)&&Number.isInteger(r?.result_count)&&r.result_count===rows.length&&rows.every(x=>x&&/^\d{4}$/.test(x.code)&&x.run_id===r.run_id&&x.scan_date===r.scan_date&&x.complete===true&&x.quality_status==='complete'&&![x.synthetic,x.is_synthetic,x.replay,x.look_ahead].includes(true))&&new Set(rows.map(x=>x.code)).size===rows.length,'RAW_FULL_ROWS');
 const digest=Array.isArray(rows)?hash(rows):null;
 need(g?.reconciliation?.ok===true&&g.reconciliation.expected_count===rows?.length&&g.reconciliation.readback_count===rows?.length&&Array.isArray(g.reconciliation.failed_checks)&&g.reconciliation.failed_checks.length===0,'RAW_RECONCILIATION');
 let verifiedAt=null;
 if(kind==='institution'){
  const v=completion?.run_quality_at_publish;
  need(completion?.strategy===kind&&completion.runId===r?.run_id&&completion.marketDate===c.previous_trade_date?.replaceAll('-','')&&completion.complete===true&&completion.exitCode===0&&completion.qualityStatus==='complete'&&completion.matches===rows?.length&&completion.verifiedResultCount===rows?.length&&completion.triSurfaceStatus==='complete'&&completion.desktopRunId===r?.run_id&&completion.mobileRunId===r?.run_id&&completion.scorecardRunId===r?.run_id&&v?.resultCount===rows?.length&&v?.readbackCount===rows?.length&&v?.evidenceStatus==='complete','RAW_SOURCE_VERIFIER');
  verifiedAt=completion?.triSurfaceVerifiedAt;
 }else{
  const rb=Array.isArray(readback?.rows)?new Map(readback.rows.map(x=>[x.code,x])):new Map();
  need(readback?.ok===true&&readback.runId===r?.run_id&&readback.tradeDate===r?.scan_date&&readback.resultCount===rows?.length&&readback.readbackCount===rows?.length&&readback.technicalFreshReadback===true&&Array.isArray(readback.issues)&&!readback.issues.length&&Array.isArray(readback.rows)&&readback.rows.length===rows?.length&&rb.size===rows?.length&&rows.every(x=>{const y=rb.get(x.code);return y&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&hash(x[k])===hash(y[k]));}),'RAW_FULL_READBACK');
  need(completion?.contract==='strategy-runner-verifier-receipt-v1'&&completion.strategy===kind&&completion.complete===true&&completion.exitCode===0&&completion.runId===r?.run_id&&completion.tradeDate===r?.scan_date&&completion.count===rows?.length&&completion.triSurfaceStatus==='complete'&&Array.isArray(completion.issues)&&!completion.issues.length,'RAW_SOURCE_VERIFIER');
  verifiedAt=completion?.checkedAt;
 }
 need(binding?.approved===true&&binding.owner&&binding.approval_id&&binding.producer===expected[0]&&binding.contract===kind&&binding.version===expected[1]&&binding.list_type===kind&&binding.symbol_field==='code','APPROVED_BINDING_REQUIRED');
 need(h?.source_run_id===r?.run_id&&h?.strategy_source_date===r?.scan_date&&typeof h?.source_canonical_run_id==='string'&&mapping?.approved===true&&mapping.approval_id&&mapping.binding_approval_id===binding?.approval_id&&mapping.source_run_id===r?.run_id&&mapping.source_canonical_run_id===h.source_canonical_run_id&&mapping.target_canonical_run_id===c.target_canonical_run_id&&mapping.raw_rows_hash===digest&&c.target_canonical_run_id===`fugle_daytrade_source:${String(c.trade_date).replaceAll('-','')}:canonical`,'APPROVED_IDENTITY_MAPPING_REQUIRED');
 // Never derive availability from file mtime, schedule, source finish or today's bridge refresh.
 need(delivery?.verified===true&&delivery.evidence_id&&delivery.source_run_id===r?.run_id&&delivery.source_trade_date===r?.scan_date&&delivery.delivery_date===c.trade_date&&delivery.rows_hash===digest&&delivery.source_canonical_run_id===h?.source_canonical_run_id,'PREOPEN_DELIVERY_EVIDENCE_REQUIRED');
 need([r?.finished_at,verifiedAt,delivery?.published_at,delivery?.available_at,c.as_of].map(stamp).every(Number.isFinite)&&stamp(r.finished_at)<=stamp(verifiedAt)&&stamp(verifiedAt)<=stamp(delivery.published_at)&&stamp(delivery.published_at)<=stamp(delivery.available_at)&&stamp(delivery.available_at)<=stamp(c.as_of),'VERIFIED_AVAILABILITY_REQUIRED');
 return {ok:errors.length===0,failed_checks:errors,data_checks:data,producer:expected[0],version:expected[1],raw_rows_hash:digest,original_count:rows?.length??null,source_run_id:r?.run_id,source_trade_date:r?.scan_date,source_canonical_run_id:h?.source_canonical_run_id,source_canonical_basis:'saved handoff; not asserted as a field on original source receipt',source_verified_at:verifiedAt,available_at:delivery?.available_at??null,bridge_observed_at:bridge?.updatedAt};
}
module.exports={verify,verifyIndependent,verifySavedSource,LIST_TYPES};
