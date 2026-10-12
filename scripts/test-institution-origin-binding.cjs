'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const link=require('../lib/institution-origin-link.cjs');
const {finalize}=require('./verify-institution-natural-origin.cjs');
const {fixture}=require('./institution-origin-test-fixture.cjs');
let passed=0;
function check(name,mutate,expected=false,after){
 const f=fixture();mutate(f);f.writeNatural();f.writeLink();if(after)after(f);
 assert.equal(link.read(f.file,f.r,{authority:f.authority}).naturalSlotComplete,expected,name);
 passed++;console.log('PASS '+name);
}
check('complete original bytes and institution trigger',()=>{},true);
check('missing original',()=>{},false,f=>fs.unlinkSync(f.naturalPath));
check('modified raw bytes',()=>{},false,f=>fs.appendFileSync(f.naturalPath,' '));
check('wrong claimed hash',f=>{},false,f=>{f.proof.naturalEvidenceSha256='0'.repeat(64);f.writeLink();});
check('missing natural path',f=>delete f.proof.naturalEvidencePath);
check('malformed original',()=>{},false,f=>fs.writeFileSync(f.naturalPath,'{'));
check('oversized original',()=>{},false,f=>fs.writeFileSync(f.naturalPath,' '.repeat(4*1024*1024+1)));
check('path outside natural institution directory',()=>{},false,f=>{const other=path.join(f.tmp,'outside.json');fs.copyFileSync(f.naturalPath,other);f.proof.naturalEvidencePath=other;f.writeLink();});
check('wrong contract with matching hash',f=>f.evidence.contract='other');
check('wrong strategy with matching hash',f=>f.evidence.strategy='strategy5');
check('wrong run with matching hash',f=>f.evidence.runId='institution-20261012-20261012130003');
check('wrong date with matching hash',f=>f.evidence.tradeDate='20261008');
check('receipt date conflict',f=>f.r.tradeDate='20261008');
check('invalid check timestamp',f=>f.evidence.checkedAt='invalid');
check('unapproved release',f=>f.evidence.release.sha='b'.repeat(40));
check('wrong script hash',f=>f.evidence.release.scriptSha256='0'.repeat(64));
check('wrong runner file',f=>{const p=path.join(f.tmp,'wrong.ps1');fs.writeFileSync(p,'wrong');f.evidence.release.scriptPath=p;});
check('release success flag cannot override identity',f=>f.evidence.release.ok=false);
check('manual event',f=>f.evidence.observation.events[0].id=110);
check('ambiguous manual and scheduled event',f=>f.evidence.observation.events.push({...f.evidence.observation.events[0],id:110,recordId:3}));
check('wrong task instance',f=>f.evidence.observation.events[1].fields.TaskInstanceId='other');
check('wrong process',f=>f.evidence.observation.events[1].fields.EnginePID='999');
check('wrong parent',f=>f.evidence.observation.parentPid=999);
check('wrong SID',f=>f.evidence.observation.runnerOwnerSid='other');
check('missing SID',f=>delete f.evidence.observation.runnerOwnerSid);
check('wrong executable',f=>f.evidence.observation.executablePath='C:/other.exe');
check('recovery command',f=>f.evidence.observation.commandLine+=' -Recovery');
check('receipt recovery',f=>f.r.recoveryReplay=true);
check('proof recovery',f=>f.proof.recoveryReplay=true);
check('assessment recovery',f=>f.evidence.assessment.recoveryReplay=true);
check('wrong assessment instance',f=>f.evidence.assessment.naturalTaskInstanceId='other');
check('wrong proof instance',f=>f.proof.naturalTaskInstanceId='other');
check('forged true flag without events',f=>f.evidence.observation.events=[]);
check('incomplete receipt',f=>f.r.complete=false);
check('changed receipt cannot borrow link',()=>{},false,f=>f.r.matches=3);
{
 const f=fixture();f.writeLink();fs.unlinkSync(f.naturalPath);
 const before=fs.readFileSync(link.proofPath(f.file,f.r),'utf8');
 const result=finalize({file:f.file,run:f.r.runId,root:f.tmp,runtime:f.tmp,authority:f.authority,collect:()=>f.proof});
 assert.equal(result.naturalSlotComplete,false);assert.notEqual(result.reused,true);
 assert.equal(result.naturalEvidenceStatus,'ORIGIN_PROOF_UNVERIFIED');
 assert.equal(fs.readFileSync(link.proofPath(f.file,f.r),'utf8'),before);
 assert.ok(result.evidencePath.includes('institution-origin-attempts'));
 passed++;console.log('PASS invalidated existing success is not reused or overwritten');
}
{
 const f=fixture();fs.unlinkSync(f.naturalPath);
 const result=finalize({file:f.file,run:f.r.runId,root:f.tmp,runtime:f.tmp,authority:f.authority,collect:()=>f.proof});
 assert.equal(result.naturalSlotComplete,false);assert.equal(fs.existsSync(link.proofPath(f.file,f.r)),false);
 passed++;console.log('PASS initial invalid proof stays non-consumable');
}
console.log(JSON.stringify({passed,scope:'isolated synthetic fixtures; no formal natural acceptance'}));
