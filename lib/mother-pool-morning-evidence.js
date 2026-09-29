'use strict';
const {hash}=require('./mother-pool-module-write-set');
const stages=require('./opening-report-stage-contract');
const {validatePayload,validateBridge,validateDbRow,rejectedObservationPresent}=require('../scripts/verify-opening-report-0830-mother-pool-handoff-ack');
function verifyHandoffUnsafe(receipt,{tradeDate,stage,asOf}){
 const errors=[],need=(v,c)=>{if(!v)errors.push(c);},now=Date.parse(asOf),checked=Date.parse(receipt?.checked_at||'');
 need(receipt?.contract==='opening-report-0830-mother-pool-handoff-ack-v2'&&receipt.complete===true&&receipt.exitCode===0&&receipt.db_readback_ok===true,'HANDOFF_NOT_COMPLETE');
 need(receipt?.trade_date===tradeDate&&String(receipt?.report_run_id||'').includes(stage),'HANDOFF_IDENTITY');
 need(Number.isFinite(checked)&&checked<=now&&checked>=Date.parse(tradeDate+'T'+stages.stage(stage).time+':00+08:00'),'HANDOFF_TIME');
 const e=receipt?.source_evidence;
 if(e?.contract!=='opening_report_handoff_raw_evidence_v1'||e.stage!==stage||e.readback_role!=='anon')return [...errors,'HANDOFF_RAW_EVIDENCE_REQUIRED'];
 const payloads=e.industry_payloads,rows=e.rows,bridges=e.bridges;
 if(!Array.isArray(payloads)||!Array.isArray(rows)||!Array.isArray(bridges))return [...errors,'HANDOFF_RAW_ARRAYS_REQUIRED'];
 need(e.rows_sha256===hash(rows),'HANDOFF_ROW_HASH');
 errors.push(...require('./mother-pool-morning-universe').verifyUniverse(e,{tradeDate,stage,runId:receipt.report_run_id}));
 need(e.aggregate?.run_id===receipt.report_run_id&&e.aggregate.status==='BRIDGE_OK'&&e.aggregate.industry_count===payloads.length&&payloads.length<=3,'HANDOFF_AGGREGATE');
 // Empty industry scans need the original market scan evidence; a zero receipt
 // count by itself does not prove that the source scan completed.
 const zeroSource=payloads.length===0&&require('./mother-pool-morning-zero-source').completeZeroSource(e,{stage,checked});
 need(payloads.length>0||zeroSource,'ZERO_INDUSTRY_SCAN_SOURCE_REQUIRED');
 need(new Set(payloads.map(p=>p.industry)).size===payloads.length&&new Set(payloads.map(p=>p.priority_observation_rank)).size===payloads.length,'HANDOFF_DUPLICATE_INDUSTRY');
 const accepted=new Map(),received=new Set(),rejected=[];
 for(const p of payloads){
  errors.push(...validatePayload(p,tradeDate,receipt.report_run_id,stage));
  need(p.priority_observation_basis==='positive_industry_top3'?require('./mother-pool-morning-industry-source').validIndustrySource(p,{stage,checked}):Array.isArray(p.priority_overseas_leaders)&&p.priority_overseas_leaders.length>0&&p.priority_overseas_leaders.every(l=>stages.allowed(l.symbol,stage)&&Number(l.percent)>0&&Number.isFinite(Date.parse(l.source_time))&&Date.parse(l.source_time)<=checked),'HANDOFF_LEADER_SOURCE');
  need(p.stage===stage&&(!p.mapped_symbols_c||p.mapped_symbols_c.length===0)&&(p.mapped_symbols||[]).every(s=>['A','B'].includes(s.tier)),'HANDOFF_MAPPING_SCOPE');
  const matching=bridges.filter(b=>b.receipt?.run_id===p.run_id);need(matching.length===1,'HANDOFF_BRIDGE_COUNT');const b=matching[0]?.receipt;
  errors.push(...validateBridge(b,p));
  for(const s of p.mapped_symbols||[]){const symbol=String(s.symbol||s);received.add(symbol);if(b?.accepted_symbols?.includes(symbol))accepted.set(symbol,[...(accepted.get(symbol)||[]),p]);else rejected.push({symbol,p});}
 }
 need(bridges.length===payloads.length,'HANDOFF_EXTRA_BRIDGE');
 need(new Set(rows.map(r=>r.symbol)).size===rows.length&&rows.length===received.size&&rows.every(r=>received.has(r.symbol)),'HANDOFF_READBACK_SET');
 const bySymbol=new Map(rows.map(r=>[r.symbol,r]));for(const [symbol,p]of accepted)errors.push(...validateDbRow(bySymbol.get(symbol),p));
 for(const {symbol,p}of rejected)need(!rejectedObservationPresent(bySymbol.get(symbol),p),'HANDOFF_REJECTED_OBSERVATION');
 for(const name of ['accepted_symbols','accepted_readback_symbols'])need(Array.isArray(receipt[name])&&receipt[name].length===accepted.size&&new Set(receipt[name]).size===accepted.size&&receipt[name].every(s=>accepted.has(s)),'HANDOFF_ACCEPTED_SET');
 need((zeroSource&&rows.length===0&&Array.isArray(e.requests)&&e.requests.length===0)||Array.isArray(e.requests)&&e.requests.length===1&&e.requests[0].http_status===200&&e.requests[0].role==='anon'&&e.requests[0].row_count===rows.length,'HANDOFF_HTTP_EVIDENCE');
 return [...new Set(errors)];
}
function verifyHandoff(receipt,options){try{return verifyHandoffUnsafe(receipt,options);}catch{return ['HANDOFF_RAW_EVIDENCE_INVALID'];}}
module.exports={verifyHandoff};
