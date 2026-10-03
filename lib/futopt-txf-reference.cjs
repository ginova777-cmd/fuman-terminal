'use strict';
function validDate(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const ms=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value;
}
function selectReference(rows,{tradeDate,sourceHash,runId,observedAt,nowMs=Date.now()}) {
 const observed=Date.parse(observedAt||'');
 if(!validDate(tradeDate)||!/^([a-f0-9]{64})$/.test(sourceHash||'')||typeof runId!=='string'||!runId.trim()||!Number.isFinite(nowMs)||!Number.isFinite(observed)||observed>nowMs||new Date(observed+28800000).toISOString().slice(0,10)!==tradeDate)throw Error('TXF_CATALOGUE_PROVENANCE_INVALID');
 if(!Array.isArray(rows)||rows.some(r=>!r||typeof r!=='object'))throw Error('TXF_CATALOGUE_ROWS_INVALID');
 const candidates=rows.filter(r=>r.product==='TXF'&&/^TXF[A-L]\d$/.test(r.future_symbol||''));
 if(!candidates.length||candidates.some(r=>!validDate(r.end_date)))throw Error('TXF_EXPIRY_UNPROVEN');
 const valid=candidates.filter(r=>r.end_date>=tradeDate).sort((a,b)=>a.end_date.localeCompare(b.end_date)||a.future_symbol.localeCompare(b.future_symbol));
 if(!valid.length)throw Error('TXF_VALID_CONTRACT_MISSING');
 const chosen=valid[0];
 if(valid.some(r=>r.end_date===chosen.end_date&&r.future_symbol!==chosen.future_symbol))throw Error('TXF_NEAREST_CONTRACT_AMBIGUOUS');
 if(candidates.some(r=>r.future_symbol===chosen.future_symbol&&r.end_date!==chosen.end_date))throw Error('TXF_CONTRACT_EXPIRY_CONFLICT');
 return {contract:'fugle-txf-reference-v1',trade_date:tradeDate,future_symbol:chosen.future_symbol,expiry_date:chosen.end_date,selection_rule:'earliest_unexpired_verified_expiry',catalogue_run_id:runId,catalogue_source_hash:sourceHash,catalogue_observed_at:observedAt};
}
function createReader(runtime, dependencies={}) {
 const fs=dependencies.fs||require('fs'),path=require('path');
 const build=dependencies.build||require('./futopt-collector-catalogue').build;
 let cachedKey=null,cachedReference=null;
 return function readReference(eventAt, nowMs=Date.now()) {
  const eventMs=Date.parse(eventAt||'');
  if(!Number.isFinite(eventMs)||!Number.isFinite(nowMs)||eventMs>nowMs)return {txf_reference:null,txf_reference_status:'EVENT_TIME_INVALID'};
  const date=new Date(eventMs+28800000).toISOString().slice(0,10);
  const today=new Date(nowMs+28800000).toISOString().slice(0,10);
  if(date!==today)return {txf_reference:null,txf_reference_status:'EVENT_DATE_MISMATCH'};
  try {
   const file=path.join(runtime,'data','futures-catalogue',date+'.json');
   const stat=fs.statSync(file);
   const key=date+':'+stat.mtimeMs+':'+stat.size;
   if(key!==cachedKey) {
    const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
    const rows=build(snapshot,date,new Date(nowMs).toISOString());
    const ref=selectReference(rows,{tradeDate:date,sourceHash:snapshot.source_hash,runId:snapshot.run_id,observedAt:snapshot.observed_at,nowMs});
    cachedReference=ref;cachedKey=key;
   }
   return {txf_reference:{...cachedReference},txf_reference_status:'VERIFIED_CATALOGUE'};
  } catch(error) {
   cachedKey=null;cachedReference=null;
   return {txf_reference:null,txf_reference_status:'CATALOGUE_UNVERIFIED'};
  }
 };
}
module.exports={selectReference,createReader};
