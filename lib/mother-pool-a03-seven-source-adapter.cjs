'use strict';
const crypto=require('node:crypto');
const SOURCES=Object.freeze(['volume_rank','turnover_rank','longyue_long','strategy3_v2','strategy4','strategy5','previous_stock_futures_strength']);
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const iso=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'');
function strategy5(input={}){
 try{return strategy5Checked(input);}catch{return {status:"BLOCKED",safe_for_a03:false,failed_checks:["MALFORMED_INPUT"],envelope:null};}
}
function strategy5Checked({bridge,readback,completion,binding,mapping,context}){
 const errors=[],need=(v,r)=>{if(!v)errors.push(r);},g=bridge?.groups?.strategy5,r=g?.sourceReceipt,h=g?.handoff,rows=g?.sourceRows;
 need(binding?.approved===true&&binding.approval_id&&binding.owner&&binding.producer==='v_strategy5_latest_complete_run/strategy5_scan_results'&&binding.contract==='strategy5'&&binding.version==='strategy5-run-id-complete-v1','APPROVED_BINDING_REQUIRED');
 need(iso(context?.trade_date)&&iso(context?.previous_trade_date)&&context.previous_trade_date<context.trade_date&&context.canonical_run_id===`fugle_daytrade_source:${context.trade_date.replaceAll('-','')}:canonical`,'TARGET_IDENTITY_INVALID');
 const now=Date.parse(context?.as_of),local=Number.isFinite(now)?new Date(now+28800000).toISOString():'';
 need(local.slice(0,10)===context?.trade_date&&local.slice(11,16)>='06:00'&&local.slice(11,16)<'09:00','PREOPEN_AS_OF_REQUIRED');
 need(r?.complete===true&&r?.status==='complete'&&r?.schema_version===binding?.version&&g?.status==='ready'&&g?.runId===r?.run_id&&r?.scan_date===context?.previous_trade_date,'SOURCE_RUN_OR_DATE_INVALID');
 need(h?.ok===true&&h.contract==='terminal_strategy_morning_handoff_v1'&&Array.isArray(h.failed_checks)&&!h.failed_checks.length&&h.source_run_id===r?.run_id&&h.source_strategy_version===r?.schema_version&&h.strategy_source_date===context?.previous_trade_date&&h.previous_completed_trade_date===context?.previous_trade_date&&h.handoff_trade_date===context?.trade_date,'HANDOFF_INVALID');
 need(bridge?.tradeDate===context?.trade_date&&bridge?.canonicalRunId===context?.canonical_run_id,'BRIDGE_IDENTITY_INVALID');
 need(Array.isArray(rows)&&Number.isInteger(r?.result_count)&&rows.length===r.result_count,'FULL_ROWS_REQUIRED');
 const quality=new Set(['complete','ok','ready','pass','a']);
 need(Array.isArray(rows)&&rows.every(x=>typeof x.code==='string'&&/^\d{4}$/.test(x.code)&&x.run_id===r.run_id&&x.scan_date===context.previous_trade_date&&x.complete!==false&&quality.has(String(x.quality_status||'').toLowerCase())&&![x.synthetic,x.is_synthetic,x.look_ahead,x.replay].includes(true)),'SOURCE_ROW_QUALITY_INVALID');
 need(Array.isArray(rows)&&new Set(rows.map(x=>x.code)).size===rows.length,'DUPLICATE_SOURCE_SYMBOL');
 need(g?.reconciliation?.ok===true&&g.reconciliation.expected_count===rows?.length&&g.reconciliation.readback_count===rows?.length&&Array.isArray(g.reconciliation.failed_checks)&&!g.reconciliation.failed_checks.length,'ROW_RECONCILIATION_REQUIRED');
 need(readback?.ok===true&&readback.runId===r?.run_id&&readback.tradeDate===context?.previous_trade_date&&readback.resultCount===rows?.length&&readback.readbackCount===rows?.length&&readback.technicalFreshReadback===true&&Array.isArray(readback.issues)&&!readback.issues.length&&Array.isArray(readback.rows)&&readback.rows.length===rows?.length,'VERIFIED_READBACK_REQUIRED');
 // The full readback may expose additional fields. Compare each shared source
 // field instead of substituting UI visibleRows or fabricating missing fields.
 const rb=new Map((readback?.rows||[]).map(x=>[x.code,x]));
 need(rb.size===rows?.length&&Array.isArray(rows)&&rows.every(x=>{const y=rb.get(x.code);return y&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&hash(x[k])===hash(y[k]));}),'READBACK_CONTENT_MISMATCH');
 need(completion?.contract==='strategy-runner-verifier-receipt-v1'&&completion.strategy==='strategy5'&&completion.complete===true&&completion.exitCode===0&&completion.runId===r?.run_id&&completion.tradeDate===context?.previous_trade_date&&completion.count===rows?.length&&completion.triSurfaceStatus==='complete'&&Array.isArray(completion.issues)&&!completion.issues.length,'COMPLETION_VERIFIER_REQUIRED');
 const rawHash=Array.isArray(rows)?hash(rows):null;
 need(mapping?.approved===true&&mapping.approval_id&&mapping.binding_approval_id===binding?.approval_id&&mapping.source_run_id===r?.run_id&&mapping.source_canonical_run_id===h?.source_canonical_run_id&&typeof mapping.source_canonical_run_id==='string'&&mapping.source_canonical_run_id.length>0&&mapping.target_canonical_run_id===context?.canonical_run_id&&mapping.raw_rows_hash===rawHash,'APPROVED_IDENTITY_MAPPING_REQUIRED');
 const stamps=[r?.finished_at,h?.checked_at,bridge?.updatedAt,readback?.checkedAt,completion?.checkedAt].map(Date.parse);
 need(stamps.every(t=>Number.isFinite(t)&&t<=now),'EVIDENCE_UNAVAILABLE_AS_OF');
 if(errors.length)return {status:'BLOCKED',safe_for_a03:false,failed_checks:errors,envelope:null};
 const normalized=rows.map(x=>({symbol:x.code,accepted:true,source_row:JSON.parse(JSON.stringify(x))}));
 return {status:'READY_FOR_ISOLATED_UNION',safe_for_a03:true,failed_checks:[],envelope:{producer:binding.producer,contract:binding.contract,contract_version:binding.version,source_run_id:r.run_id,source_trade_date:r.scan_date,canonical_run_id:context.canonical_run_id,original_source_canonical_run_id:h.source_canonical_run_id,identity_mapping_approval_id:mapping.approval_id,available_at:new Date(Math.max(...stamps)).toISOString(),original_count:rows.length,rows:normalized,hash:hash(normalized),raw_rows_hash:rawHash,complete:true}};
}
function union({bindings,sources,identity,previousTradeDate,asOf}){
 const verify=require('./verify-mother-pool-a03-seven-source.cjs').verify;
 const check=verify({bindings,sources,identity,previousTradeDate,asOf});if(!check.ok)return {status:'BLOCKED',symbols:[],flags:{},failed_checks:check.failed_checks};
 const flags={};for(const name of SOURCES)for(const r of sources[name].rows){if(!flags[r.symbol])flags[r.symbol]=[];if(!flags[r.symbol].includes(name))flags[r.symbol].push(name);}
 return {status:'READY_FOR_ISOLATED_UNION',symbols:Object.keys(flags).sort(),flags,failed_checks:[],formal_ready:false};
}
function receiveIndependent(input={}){
 const check=require('./verify-mother-pool-a03-seven-source.cjs').verifyIndependent(input);
 if(!check.ok)return {status:'BLOCKED',formal_ready:false,failed_checks:check.failed_checks,envelope:null};
 const {source:s,listType,binding}=input;
 const result={status:'ACCEPTED_ISOLATED',formal_ready:false,failed_checks:[],envelope:{list_type:listType,producer:s.producer,contract:s.contract,version:s.version,source_run_id:s.run_id,source_trade_date:s.source_trade_date,delivery_date:s.delivery_date,available_at:s.available_at,original_count:s.original_count,raw_rows_hash:check.rows_hash,binding_approval_id:binding.approval_id,direction:check.direction,rows:s.rows.map(row=>({symbol:row[binding.symbol_field],source_label:listType,direction:check.direction,source_row:structuredClone(row)})),source_evidence:structuredClone(s)}};
 result.envelope.hash=hash(result.envelope.rows);return result;
}
function independentUnion(input={}){
 const {LIST_TYPES}=require('./verify-mother-pool-a03-seven-source.cjs');
 const {sources={},bindings={},context,mode}=input;
 const results={},failures=[],flags={},envelopes={};
 if(Object.keys(sources).some(x=>!LIST_TYPES.includes(x)))failures.push('UNKNOWN_LIST_TYPE');
 for(const type of LIST_TYPES){const r=receiveIndependent({listType:type,source:sources[type],binding:bindings[type],context,mode});results[type]={status:r.status,failed_checks:r.failed_checks};
  if(!r.envelope){failures.push(...r.failed_checks.map(x=>type+':'+x));continue;}
  envelopes[type]=r.envelope;
  for(const row of r.envelope.rows)(flags[row.symbol]||=[]).push({list_type:type,direction:row.direction,source_run_id:r.envelope.source_run_id,raw_rows_hash:r.envelope.raw_rows_hash});
 }
 // Coexistence policy is deliberately NOT applied to the legacy seven-source union.
 if(failures.length)return {status:'BLOCKED',formal_ready:false,symbols:[],flags:{},results,failed_checks:failures};
 return {status:'ACCEPTED_ISOLATED',formal_ready:false,symbols:Object.keys(flags).sort(),flags,envelopes,results,failed_checks:[]};
}
function receiveSavedSource(input={}){
 const checked=require('./verify-mother-pool-a03-seven-source.cjs').verifySavedSource(input);
 if(!checked.ok)return {status:'BLOCKED',formal_ready:false,envelope:null,evidence_check:checked,failed_checks:checked.failed_checks};
 const {kind,bridge,completion,readback,delivery,binding,context,mapping}=input,g=bridge.groups[kind],r=g.sourceReceipt;
 // A derived local normalization is labelled as such; original receipts remain intact.
 const common={normalization:'LOCAL_DERIVED_FROM_VERIFIED_RAW_NOT_NEW_PRODUCER_RECEIPT',run_id:r.run_id,source_trade_date:r.scan_date,version:r.schema_version,list_type:kind,count:g.sourceRows.length,rows_hash:checked.raw_rows_hash};
 const source={producer:checked.producer,contract:kind,version:r.schema_version,run_id:r.run_id,source_trade_date:r.scan_date,delivery_date:context.trade_date,direction:'observation',rows:g.sourceRows,original_count:g.sourceRows.length,rows_hash:checked.raw_rows_hash,published_at:delivery.published_at,available_at:delivery.available_at,receipt:{...common,scope:'upstream_scan',complete:true,quality_pass:true,finished_at:r.finished_at},verifier:{...common,scope:'upstream_source',ok:true,failed_checks:[],checked_at:checked.source_verified_at},raw_evidence:structuredClone({source_receipt:r,completion,readback,reconciliation:g.reconciliation,handoff:g.handoff,delivery,mapping})};
 const accepted=receiveIndependent({mode:input.mode,listType:kind,source,binding,context});
 return {...accepted,evidence_check:checked};
}
function proposeAliases({legacy={},independent={}}={}){
 const overlap=['longyue_long','strategy4','strategy5'];
 return {registry_change_approved:false,legacy_sources:[...SOURCES],proposals:overlap.map(name=>{
  const a=legacy[name],b=independent[name];
  const complete=x=>x&&['producer','source_run_id','source_trade_date','raw_rows_hash'].every(k=>typeof x[k]==='string'&&x[k].length>0);
  // Legacy envelopes use contract_version; independent envelopes use version.
  // An unchanged row hash cannot authorize a different schema or algorithm.
  const versions=x=>['contract_version','version'].filter(k=>x&&Object.hasOwn(x,k)&&x[k]!==undefined).map(k=>x[k]);
  const av=versions(a),bv=versions(b),declared=[...av,...bv];
  const invalid=declared.some(v=>typeof v!=='string'||!v.length);
  const versionConflict=invalid||new Set(declared).size>1;
  const contractConflict=a?.contract!=null&&b?.contract!=null&&a.contract!==b.contract;
  const metadataConflict=versionConflict||contractConflict;
  const exact=complete(a)&&complete(b)&&['producer','source_run_id','source_trade_date','raw_rows_hash'].every(k=>a[k]===b[k]);
  return {legacy:name,list_type:name,status:metadataConflict?'CONFLICT':!complete(a)||!complete(b)?'UNKNOWN':exact?'EXACT_IDENTITY_PROPOSAL':'CONFLICT',version_status:versionConflict?'CONFLICT':av.length&&bv.length?'MATCH':'UNKNOWN',contract_status:contractConflict?'CONFLICT':a?.contract!=null&&b?.contract!=null?'MATCH':'UNKNOWN',approval_required:true};
 })};
}
function previewCoexistence({legacy={},independent={}}={}){
 // Review-only set operation. This never declares overall A03 readiness or enables an alias.
 const flags={},errors=[];
 for(const [channel,records] of Object.entries({legacy,independent}))for(const [name,e] of Object.entries(records)){
  if(!e||!Array.isArray(e.rows)||e.original_count!==e.rows.length||e.hash!==hash(e.rows)){errors.push(channel+':'+name+':INVALID_ENVELOPE');continue;}
  for(const row of e.rows){if(!/^\d{4}$/.test(row.symbol||'')){errors.push(channel+':'+name+':INVALID_SYMBOL');continue;}(flags[row.symbol]||=[]).push({channel,source:name,direction:row.direction||e.direction||'observation',source_run_id:e.source_run_id});}
 }
 return {status:errors.length?'BLOCKED':'REVIEW_ONLY',formal_ready:false,registry_change_approved:false,symbols:errors.length?[]:Object.keys(flags).sort(),flags:errors.length?{}:flags,failed_checks:errors,aliases:proposeAliases({legacy,independent})};
}
module.exports={SOURCES,hash,strategy5,union,receiveIndependent,independentUnion,receiveSavedSource,proposeAliases,previewCoexistence};
