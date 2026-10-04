'use strict';
// Pure selection. Inputs must retain the catalogue and product observation evidence.
const POLICY='standard-stock-current-then-next-month-v1';
const day=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const nextMonth=s=>{const [y,m]=s.split('-').map(Number);return `${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}`;};
function select(candidates,{tradeDate,asOf,expiryEvidence={}}) {
 const now=Date.parse(asOf);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!Number.isFinite(now)||day(now)!==tradeDate||!Array.isArray(candidates))throw Error('SELECTION_CONTEXT_INVALID');
 const current=tradeDate.slice(0,7),next=nextMonth(current),groups=new Map();
 for(const c of candidates){if(!/^\d{4}$/.test(c.underlying_symbol||''))throw Error('UNDERLYING_INVALID');const group=groups.get(c.underlying_symbol)||[];group.push(c);groups.set(c.underlying_symbol,group);}
 return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([symbol,all])=>{
  const answer={symbol,policy:POLICY,trade_date:tradeDate,as_of:asOf,status:'MISSING_EVIDENCE',selected:null,candidates:all,target_month:current,reason:null};
  const relevant=all.filter(c=>[current,next].includes(c.contract_month));
  // Unknown products could be an additional standard candidate: never silently discard them.
  if(relevant.some(c=>c.classification_verified!==true||c.evidence_trade_date!==tradeDate||!Number.isFinite(Date.parse(c.evidence_observed_at))||Date.parse(c.evidence_observed_at)>now)){answer.reason='SAME_DAY_PRODUCT_CLASSIFICATION_UNVERIFIED';return answer;}
  const standards=relevant.filter(c=>c.classification==='STANDARD');
  if(standards.some(c=>!Number.isFinite(Date.parse(c.valid_from))||!Number.isFinite(Date.parse(c.valid_until))||Date.parse(c.valid_from)>=Date.parse(c.valid_until))){answer.reason='CONTRACT_VALIDITY_UNVERIFIED';return answer;}
  const monthRows=standards.filter(c=>c.contract_month===current);
  // Absence alone does not prove this month's expiry. Catalogue must supply expiry evidence.
  const prior=expiryEvidence[symbol];
  if(!monthRows.length&&!(prior?.verified===true&&prior.contract_month===current&&prior.catalogue_run_id&&/^[a-f0-9]{64}$/.test(prior.catalogue_source_hash||'')&&Number.isFinite(Date.parse(prior.valid_until))&&Date.parse(prior.valid_until)<=now)){answer.reason='CURRENT_MONTH_EXPIRY_EVIDENCE_MISSING';return answer;}
  const eligible=monthRows.filter(c=>Date.parse(c.valid_from)<=now&&now<Date.parse(c.valid_until));
  let targets=eligible;
  if(!eligible.length){
   if(!monthRows.every(c=>now>=Date.parse(c.valid_until))){answer.reason='CURRENT_MONTH_NOT_YET_VALID';return answer;}
   if(!monthRows.length)answer.rollover_evidence=prior;
   answer.target_month=next;
   targets=standards.filter(c=>c.contract_month===next&&Date.parse(c.valid_from)<=now&&now<Date.parse(c.valid_until));
  }
  if(targets.length===1){answer.status='UNIQUE';answer.selected=targets[0].future_symbol;}
  else {answer.status=targets.length?'MULTIPLE':'NO_MATCH';answer.reason=targets.length?'MULTIPLE_STANDARD_CONTRACTS':'NEXT_MONTH_STANDARD_UNAVAILABLE';}
  return answer;
 });
}
module.exports={select,POLICY,nextMonth};
