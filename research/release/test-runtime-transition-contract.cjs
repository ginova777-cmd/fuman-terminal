'use strict';
const assert=require('assert/strict'),{plan}=require('./runtime-transition-contract.cjs');
const base={scope:'ISOLATED_REVIEW',owner:'a',observedOwner:'a',phase:'STOP',unknownPids:[],unknownLocks:[],schedulerReadbackVerified:true};
const cases=[['UNKNOWN_PID',{unknownPids:[1]}],['UNKNOWN_LOCK',{unknownLocks:['x']}],['OWNER_DRIFT',{observedOwner:'b'}],['PROCESS_NOT_EXITED',{phase:'RESTORE',oldPidsAlive:[1]}],['LEASE_NOT_RELEASED',{phase:'RESTORE',oldPidsAlive:[]}],['START_NOT_VERIFIED',{phase:'HANDBACK'}],['TASK_READBACK_UNVERIFIED',{schedulerReadbackVerified:false}],['FORMAL_EXECUTION_NOT_AUTHORIZED',{scope:'FORMAL'}]];
for(const [reason,p]of cases){const r=plan({...base,...p});assert.equal(r.reason,reason);assert.deepEqual(r.operations,[]);}
for(const phase of ['STOP','RESTORE','HANDBACK','ROLLBACK'])assert.equal(plan({...base,phase,writerLeaseReleased:true,oldPidsAlive:[],startsVerified:true}).status,'ISOLATED_PLAN_VALID');
console.log(JSON.stringify({status:'PASS',negative:cases.map(x=>x[0]),positive_phases:4,actual_formal_operations:0,coverage:'PLAN_CONTRACT_ONLY'}));
