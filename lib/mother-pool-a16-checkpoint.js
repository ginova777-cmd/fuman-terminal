'use strict';
const {hash,compact}=require('./mother-pool-a16-io');
// Reuse completed dual reads even when the immutable baseline has sample gaps. This is historical
// readback evidence, not a claim that a new DB request ran during this resume.
function retainable(previous,receipt,generation,mode,asOf){
 const db=previous?.db,now=Date.parse(asOf),calculated=Date.parse(receipt?.calculated_at||'');
 if(previous?.generation!==generation||previous.mode!==mode||previous.verifier?.verification_passed!==true||!Number.isFinite(now)||!Number.isFinite(calculated))return false;
 if(db?.readback_contract!=='a16_db_anon_v2'||db.db_readback_ok!==true||db.anon_readback_ok!==true||db.written_count!==1084||db.readback_count!==1084||db.payload_sha256!==hash(compact(receipt)))return false;
 const evidence=db.readback_evidence;
 if(!Array.isArray(evidence)||evidence.length!==2||new Set(evidence.map(e=>e.role)).size!==2)return false;
 return ['DB','ANON'].every(role=>{const e=evidence.find(e=>e.role===role),t=Date.parse(e?.checked_at||'');
  return e&&e.row_count===1&&e.trade_date===receipt.trade_date&&e.canonical_run_id===receipt.canonical_run_id&&e.symbol===receipt.symbol&&e.generation===generation&&e.payload_sha256===db.payload_sha256&&Number.isFinite(t)&&t>=calculated&&t<=now&&new Date(t+28800000).toISOString().slice(0,10)===receipt.trade_date;
 });
}
module.exports={retainable};
