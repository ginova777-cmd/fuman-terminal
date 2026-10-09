'use strict';
// A planner only. Never acquires/releases a formal lock or operates a task.
function plan(s){
 const reject=reason=>({status:'BLOCKED',reason,operations:[]});
 if(s.scope!=='ISOLATED_REVIEW')return reject('FORMAL_EXECUTION_NOT_AUTHORIZED');
 if(!s.owner||s.owner!==s.observedOwner)return reject('OWNER_DRIFT');
 if(s.unknownPids?.length)return reject('UNKNOWN_PID');
 if(s.unknownLocks?.length)return reject('UNKNOWN_LOCK');
 if(s.phase==='RESTORE'&&s.oldPidsAlive?.length)return reject('PROCESS_NOT_EXITED');
 if(s.phase==='RESTORE'&&s.writerLeaseReleased!==true)return reject('LEASE_NOT_RELEASED');
 if(s.phase==='HANDBACK'&&s.startsVerified!==true)return reject('START_NOT_VERIFIED');
 if(!s.schedulerReadbackVerified)return reject('TASK_READBACK_UNVERIFIED');
 const operations={STOP:['CAPTURE_TASK_XML','OWN_FENCE','QUIESCE_SCHEDULE','WAIT_WRITER_IDLE','IDENTITY_STOP_STOCK','IDENTITY_STOP_FUTURE','VERIFY_EXIT'],RESTORE:['VERIFY_RELEASE','START_FUTURE','START_STOCK','VERIFY_IDENTITIES'],HANDBACK:['RESTORE_EXACT_TASK_STATE','READBACK_TASKS','RELEASE_OWN_FENCE'],ROLLBACK:['STOP_ONLY_STARTED_IDENTITIES','VERIFY_EXIT','VERIFY_ROLLBACK_RELEASE','RESTORE_PREVIOUS_IDENTITIES','READBACK_TASKS']};
 if(!operations[s.phase])return reject('PHASE_UNKNOWN');
 return {status:'ISOLATED_PLAN_VALID',operations:operations[s.phase],formal_callable:false};
}
module.exports={plan};
