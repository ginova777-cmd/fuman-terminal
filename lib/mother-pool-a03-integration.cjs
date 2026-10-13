'use strict';
const adapter=require('./mother-pool-a03-seven-source-adapter.cjs');
const {hash}=adapter;
const {reconcile,identityFields}=require('./mother-pool-stock-module-write-set');
const {verifySnapshotReadback}=require('./mother-pool-snapshot-readback');
const equal=(a,b)=>hash(a)===hash(b);
function collect(input={}){
 try{return collectChecked(input);}catch{return {status:'BLOCKED',formal_ready:false,failed_checks:['MALFORMED_INTEGRATION_INPUT'],plan:null};}
}
function collectChecked(input){
 const {legacy,independent,identity,policy,asOf}=input,errors=[];
 const requireCheck=(v,e)=>{if(!v)errors.push(e);};
 requireCheck(input.mode==='isolated_candidate','ISOLATION_REQUIRED');
 requireCheck(policy?.approved===true&&policy.owner&&policy.approval_id&&policy.version&&policy.mode==='seven_plus_independent_all_required','COEXISTENCE_POLICY_UNAPPROVED');
 requireCheck(identityFields.every(k=>identity?.[k]!=null&&identity[k]!=='')&&Number.isInteger(identity?.snapshot_sequence)&&identity.snapshot_sequence>0,'ROUND_IDENTITY');
 requireCheck(legacy?.asOf===asOf&&independent?.context?.as_of===asOf&&legacy?.identity?.trade_date===identity?.trade_date&&legacy?.identity?.canonical_run_id===identity?.canonical_run_id&&independent?.context?.trade_date===identity?.trade_date,'CONTEXT_IDENTITY');
 const l=adapter.union(legacy||{}),i=adapter.independentUnion(independent||{});
 requireCheck(l.status==='READY_FOR_ISOLATED_UNION','LEGACY_BLOCKED');requireCheck(i.status==='ACCEPTED_ISOLATED','INDEPENDENT_BLOCKED');
 const aliases=adapter.proposeAliases({legacy:legacy?.sources,independent:i.envelopes||{}});
 for(const pair of aliases.proposals){const approval=policy?.aliases?.[pair.legacy];requireCheck(pair.status==='EXACT_IDENTITY_PROPOSAL'&&approval?.approved===true&&approval.approval_id&&approval.producer===legacy?.sources?.[pair.legacy]?.producer&&approval.source_run_id===legacy?.sources?.[pair.legacy]?.source_run_id&&approval.raw_rows_hash===legacy?.sources?.[pair.legacy]?.raw_rows_hash,'ALIAS_UNAPPROVED_OR_DRIFT:'+pair.legacy);}
 if(errors.length)return {status:'BLOCKED',formal_ready:false,failed_checks:errors,source_results:{legacy:l.status,independent:i.results},plan:null};
 const flags={},add=(symbol,flag)=>{(flags[symbol]||=[]).push(flag);};
 for(const name of adapter.SOURCES)for(const row of legacy.sources[name].rows)add(row.symbol,{channel:'legacy',source:name,direction:name==='longyue_long'?'long':'observation',source_run_id:legacy.sources[name].source_run_id,source_trade_date:legacy.sources[name].source_trade_date});
 for(const [name,e] of Object.entries(i.envelopes))for(const row of e.rows)add(row.symbol,{channel:'independent',source:name,direction:e.direction,source_run_id:e.source_run_id,source_trade_date:e.source_trade_date});
 const symbols=Object.keys(flags).sort(),sourceHash=hash({legacy:legacy.sources,independent:independent.sources});
 const evidence={contract:'a03_isolated_integration_evidence_v1',input:structuredClone(input),source_hash:sourceHash,aliases,production_authorized:false};
 const plan={...identity,module_id:'A03',created_at:asOf,requested_symbols:symbols,source_evidence:evidence,rows:symbols.map(symbol=>({symbol,status:'READY',source:'a03-independent-and-seven-source',source_contract:'a03_isolated_integration_evidence_v1',source_updated_at:asOf,event_time:asOf,is_synthetic:false,replay:false,look_ahead:false,source_hash:sourceHash,source_flags:flags[symbol],in_warmup_union:true,union_count:symbols.length,formal_candidate_allowed:false}))};
 return {status:'READY_FOR_ISOLATED_WRITE',formal_ready:false,failed_checks:[],plan};
}
// Uses supplied readbacks; never executes upstream, DB or Writer from a verifier.
function verifyRound(input={}){
 try{return verifyRoundChecked(input);}catch{return {ok:false,formal_ready:false,failed_checks:['MALFORMED_ROUND']};}
}
function verifyRoundChecked({writeSet,db,anon,snapshot,snapshotRows,pages}){
 const failed=[],need=(v,e)=>{if(!v)failed.push(e);};
 const archived=writeSet?.plan?.source_evidence?.input,rebuilt=collect(archived),identity=archived?.identity;
 need(rebuilt.status==='READY_FOR_ISOLATED_WRITE','SOURCE_REVERIFY');
 if(!identity||!rebuilt.plan)return {ok:false,formal_ready:false,failed_checks:failed};
 need(equal(writeSet.plan.rows,rebuilt.plan.rows)&&equal(writeSet.plan.source_evidence,rebuilt.plan.source_evidence)&&equal(writeSet.plan.requested_symbols,rebuilt.plan.requested_symbols),'PLAN_REBUILD_DRIFT');
 failed.push(...reconcile(writeSet,db,anon,identity,'A03').failed_checks);
 need(snapshot.trade_date===identity.trade_date&&snapshot.canonical_run_id===identity.canonical_run_id&&snapshot.run_id===identity.mother_pool_run_id&&snapshot.mother_pool_run_id===identity.mother_pool_run_id&&snapshot.snapshot_sequence===identity.snapshot_sequence&&snapshot.generation===identity.snapshot_generation,'SNAPSHOT_ROUND_IDENTITY');
 need(rebuilt.plan.requested_symbols.every(s=>snapshot.symbols.includes(s)),'WARMUP_SYMBOLS_MISSING_FROM_SNAPSHOT');
 need(Number.isFinite(Date.parse(snapshot.generated_at))&&Date.parse(snapshot.generated_at)<=Date.parse(writeSet.ack.committed_at),'SNAPSHOT_ANCHOR_TIME');
 const checked=verifySnapshotReadback(snapshot,snapshotRows,{role:'anon',pages});failed.push(...checked.failed_checks);
 need(Array.isArray(pages)&&pages.length>0,'PAGE_EVIDENCE_REQUIRED');
 let offset=0;const joined=[];
 for(let n=0;n<(pages||[]).length;n++){const page=pages[n];need(page.role==='anon'&&Date.parse(page.retrieved_at)>=Date.parse(writeSet.ack.committed_at)&&identityFields.every(k=>page[k]===identity[k])&&page.offset===offset&&page.cursor===(n===0?null:pages[n-1].next_cursor)&&page.next_cursor===(n===pages.length-1?null:String(offset+page.rows.length))&&page.count===page.rows.length&&page.rows_hash===hash(page.rows),'PAGE_IDENTITY_CURSOR_HASH');joined.push(...page.rows);offset+=page.rows.length;}
 need(equal(joined,snapshotRows),'PAGE_ROWS_DRIFT');
 return {ok:failed.length===0,formal_ready:false,failed_checks:[...new Set(failed)],module:'A03',snapshot_verifier:checked,identity};
}
function dispatchForWriter({legacyCollect,candidateInput,isolated=false,identity,asOf,snapshotSymbols}){
 if(!isolated)return legacyCollect();
 if(!candidateInput||!equal(candidateInput.identity,identity)||candidateInput.asOf!==asOf)throw Error('A03_ISOLATED_INPUT_IDENTITY');
 const result=collect(candidateInput);
 if(!result.plan)throw Error('A03_ISOLATED_SOURCE_BLOCKED:'+result.failed_checks.join(','));
 if(!Array.isArray(snapshotSymbols)||!result.plan.requested_symbols.every(s=>snapshotSymbols.includes(s)))throw Error('A03_PRIORITY_NOT_IN_FIXED_SNAPSHOT');
 return result.plan;
}
module.exports={collect,verifyRound,dispatchForWriter};
