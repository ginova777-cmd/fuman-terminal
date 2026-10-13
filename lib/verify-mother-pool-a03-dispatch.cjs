'use strict';
// Preserve legacy verification; the new isolated contract must rebuild its full source evidence.
function verify(rows,round){
 const evidence=round?.writer_write_set?.plan?.source_evidence;
 if(evidence?.contract!=='a03_isolated_integration_evidence_v1')return require('./mother-pool-warmup-union').verify(rows,round);
 try{
  const {hash}=require('./mother-pool-a03-seven-source-adapter.cjs'),{identityFields}=require('./mother-pool-module-write-set');
  const input=evidence.input,plan=round.writer_write_set.plan;
  if(input?.mode!=='isolated_candidate'||evidence.production_authorized!==false||input.asOf!==round.observed_at||!identityFields.every(k=>input.identity?.[k]===round[k]))return false;
  const rebuilt=require('./mother-pool-a03-integration.cjs').collect(input);
  if(rebuilt.status!=='READY_FOR_ISOLATED_WRITE'||hash(rebuilt.plan.rows)!==hash(plan.rows)||hash(rebuilt.plan.source_evidence)!==hash(evidence)||hash(rebuilt.plan.requested_symbols)!==hash(plan.requested_symbols))return false;
  if(!Array.isArray(rows)||rows.length!==rebuilt.plan.rows.length)return false;
  const expected=new Map(rebuilt.plan.rows.map(r=>[r.symbol,r]));
  return new Set(rows.map(r=>r.symbol)).size===rows.length&&rows.every(row=>{const original=expected.get(row.symbol);return original&&Object.keys(original).every(k=>hash(row[k])===hash(original[k]));});
 }catch{return false;}
}
module.exports={verify};
