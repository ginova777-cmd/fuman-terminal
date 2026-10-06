'use strict';
const {verifyLoaded,isCurrent}=require('./mother-shared-water-consumer.cjs');
// Revalidate saved raw bytes at each independently recorded readback time.
// This proves evidence continuity only. Calendar/session and live acquisition
// provenance must be verified separately before claiming natural acceptance.
function verifySeries(samples,{expected,minimumDurationMs=600000}={}){
 if(!Array.isArray(samples)||samples.length<2||samples.length>128||minimumDurationMs<600000||!Number.isFinite(minimumDurationMs))throw Error('SERIES_RANGE_INVALID');
 const rows=[],failures=[],seen=new Set();let previousTime=null,previousUntil=null;
 for(let index=0;index<samples.length;index++){
  const sample=samples[index],at=Date.parse(sample.readback_at);
  const run=sample.loaded?.diagnostics?.run_id;
  if(!Number.isFinite(at)||previousTime!==null&&at<=previousTime){failures.push('READBACK_TIME_INVALID:'+index);continue;}
  let result;
  try{result=verifyLoaded(sample.loaded,{expected:{...expected,verification_run_id:run},nowMs:at});}
  catch{result={water_gate_pass:false,first_blocker:'RAW_EVIDENCE_INVALID'};}
  const current=isCurrent(result,at);
  const gap=previousUntil===null?null:Math.max(0,at-previousUntil);
  if(!current)failures.push('ROUND_UNVERIFIED:'+index);
  if(gap>0)failures.push('PUBLICATION_GAP:'+index);
  if(typeof run!=='string'||!run)failures.push('PUBLICATION_ID_MISSING:'+index);
  else seen.add(run);
  rows.push({index,readback_at:sample.readback_at,verification_run_id:run||null,receipt_sha256:sample.loaded?.diagnostics?.receipt_sha256||null,water_gate_pass:current,valid_until:result.valid_until||null,gap_ms:gap,first_blocker:result.first_blocker||null});
  previousTime=at;previousUntil=current?Date.parse(result.valid_until):at;
 }
 const duration=rows.length>1?Date.parse(rows.at(-1).readback_at)-Date.parse(rows[0].readback_at):0;
 if(duration<minimumDurationMs)failures.push('OBSERVATION_DURATION_INSUFFICIENT');
 if(seen.size<2)failures.push('DISTINCT_PUBLICATIONS_INSUFFICIENT');
 return {contract:'mother-shared-water-series-verification-v1',evidence_continuity_verified:failures.length===0,natural_acceptance:false,formal_entry_authorization:false,observed_duration_ms:duration,distinct_publications:seen.size,rows,failed_checks:failures,first_blocker:failures[0]||null};
}
module.exports={verifySeries};
