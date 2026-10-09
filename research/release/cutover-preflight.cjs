'use strict';
const {sha}=require('./producer-handoff.cjs');
function verify(config,observed,now=Date.now()){
 const checks={scope:config.scope==='ISOLATED_REVIEW',flags_off:['FUMAN_CHANGE_EVIDENCE_PHASE1','MP_PHASE2_ENABLED','MP_PHASE3_ENABLED','MP_PHASE4_ENABLED','MP_RELEASE_PREP_PUBLISHER'].every(k=>config.flags?.[k]==='0'),identity:/^[a-f0-9]{40}$/.test(config.target||'')&&config.target===observed.candidate&&config.expected===observed.production&&config.rollback===config.expected&&observed.authority===config.expected,clean:observed.clean===true,manifest:sha(observed.manifest)===config.manifest_hash,approval:config.approval?.target===config.target&&Date.parse(config.approval.not_before)<=now&&now<Date.parse(config.approval.expires_at),owner:observed.owner_verified===true,resources:observed.available_bytes>=1073741824&&observed.rss_bytes<=536870912,locks:observed.unknown_locks===0};
 const failures=Object.keys(checks).filter(k=>!checks[k]);return {status:failures.length?'BLOCKED':'ISOLATED_WHATIF_PASS',checks,failures,apply_supported:false};
}
async function cutover(ports){
 if(ports.scope!=='ISOLATED_REVIEW'||ports.formal!==false)throw Error('FORMAL_PORTS_NOT_AUTHORIZED');
 const log=[];let fenced=false,stopped=false,deployed=false;
 try{await ports.preflight();log.push('PREFLIGHT');fenced=true;await ports.fence();log.push('FENCE');await ports.writerIdle();stopped=true;await ports.stopStock();await ports.stopFuture();await ports.assertNoUsers();log.push('STOPPED');deployed=true;await ports.deploy();await ports.verifyRelease();await ports.startFuture();await ports.startStock();await ports.verifyStarts();await ports.handback();fenced=false;log.push('HANDBACK');return {status:'ISOLATED_CUTOVER_PASS',log};}
 catch(e){try{if(stopped){await ports.stopStarted();await ports.assertNoUsers();if(deployed)await ports.rollback();await ports.restoreOld();}if(fenced)await ports.restoreTasks();return {status:'RECOVERED_OR_UNCHANGED',error:e.message,log};}catch(r){await ports.retainFence();return {status:'MANUAL_RECOVERY_REQUIRED',error:e.message,recovery_error:r.message,log};}}
}
module.exports={verify,cutover};
