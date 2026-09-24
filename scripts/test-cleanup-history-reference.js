'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {parseArgs,isoCutoff,dateCutoff}=require('./cleanup-supabase-vercel-history');
const context=require('./cleanup-maintenance-context');
test('authorized apply and later readback use one cutoff across an expiry boundary',()=>{
  const now=Date.now(),file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-history-reference-')),'authorization.json');
  const authorization={contract:'cleanup-maintenance-authorization-v1',scope:'five-stage-cleanup',authorizedBy:'user',date:context.date(),authorizationText:'Test fixture only',runId:'cleanup-history-reference-test',keepDays:15,preserveWorkdaySchedule:true,sourceRoot:context.ROOT,runtimeRoot:context.RUNTIME,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+3600000).toISOString()};
  fs.writeFileSync(file,JSON.stringify(authorization));
  const apply=parseArgs(['--apply','--maintenance-authorization='+file]);
  const originalNow=Date.now;
  try {
    Date.now=()=>now+20*60000;
    const readback=parseArgs(['--dry-run','--maintenance-authorization='+file]);
    assert.equal(readback.referenceMs,apply.referenceMs);
    for(const days of [14,30,37,45,60]){
      assert.equal(isoCutoff(days,readback.referenceMs),isoCutoff(days,apply.referenceMs));
      assert.equal(dateCutoff(days,readback.referenceMs),dateCutoff(days,apply.referenceMs));
    }
    const crossedExpiry=now-45*86400000+10*60000;
    assert(crossedExpiry<Date.now()-45*86400000);
    assert(!(crossedExpiry<Date.parse(isoCutoff(45,readback.referenceMs))));
    const ordinary=parseArgs(['--dry-run']);assert.equal(ordinary.referenceMs,Date.now());
    const auth=context.authorization(file);
    const receipt={maintenanceRunId:auth.runId,maintenanceAuthorizationSha256:auth.sha256,retentionReferenceTime:auth.issuedAt};
    assert.doesNotThrow(()=>context.assertRetiredReference(receipt,auth));
    assert.throws(()=>context.assertRetiredReference({...receipt,retentionReferenceTime:new Date(Date.now()).toISOString()},auth),/reference_mismatch/);
    assert.throws(()=>context.assertRetiredReference({...receipt,maintenanceAuthorizationSha256:'wrong'},auth),/reference_mismatch/);
  } finally {Date.now=originalNow;fs.unlinkSync(file);}
});
