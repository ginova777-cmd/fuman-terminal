const assert=require('assert/strict');const {fixture}=require('./institution-origin-test-fixture.cjs');const link=require('../lib/institution-origin-link.cjs');
let n=0;function test(name,fn,expected=false){const f=fixture();fn(f);f.writeNatural();f.writeLink();assert.equal(link.read(f.file,f.r,{authority:f.authority}).naturalSlotComplete,expected,name);console.log('PASS '+name);n++;}
test('nested 2110 natural process chain',()=>{},true);
test('missing scheduler',f=>delete f.evidence.observation.scheduler);
test('unrelated parent',f=>f.evidence.observation.scheduler.childParentPid=77);
test('reused parent PID after child',f=>f.evidence.observation.scheduler.startedAt='2026-10-12T13:10:03Z');
test('parent SID mismatch',f=>f.evidence.observation.scheduler.ownerSid='other');
test('parent executable mismatch',f=>f.evidence.observation.scheduler.executablePath='other');
test('parent script mismatch',f=>f.evidence.observation.scheduler.commandLine='pwsh -File fake.ps1 -Mode Complete');
test('parent Recovery mode',f=>f.evidence.observation.scheduler.commandLine=f.evidence.observation.scheduler.commandLine.replace('Complete','Recovery'));
test('parent Resume mode',f=>f.evidence.observation.scheduler.commandLine=f.evidence.observation.scheduler.commandLine.replace('Complete','ResumeVerification'));
test('child Resume rejected',f=>f.evidence.observation.commandLine+=' -ResumeVerificationRunId old');
test('scheduler hash mismatch',f=>f.evidence.release.schedulerScriptSha256='f'.repeat(64));
test('old task rejected',f=>f.evidence.observation.taskName='\\Fuman 買賣超 Cache 2100');
test('child PID cannot replace scheduler event PID',f=>f.evidence.observation.events[1].fields.EnginePID='1234');
test('task configured Recovery',f=>f.evidence.observation.actions[0].Arguments=f.evidence.observation.actions[0].Arguments.replace('Complete','Recovery'));
test('old 2100 slot rejected',f=>{f.evidence.observation.scheduler.startedAt='2026-10-12T13:00:00Z';for(const e of f.evidence.observation.events)e.time=e.time.replace('13:10:','13:00:');});
console.log(JSON.stringify({passed:n,isolated:true}));
