'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const link=require('../lib/institution-origin-link.cjs');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture({formalAuthority=false}={}) {
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'institution-proof-fixture-')),file=path.join(tmp,'institution.json');
 const scriptPath=path.join(tmp,'run-institution.ps1');fs.writeFileSync(scriptPath,'# isolated fixture only\n');
 const authority=formalAuthority?link.loadAuthority():{sha:'a'.repeat(40),scriptPath,scriptSha256:digest(fs.readFileSync(scriptPath))};
 const r={runId:'institution-20261012-20261012130002',marketDate:'20261012',startedAt:'2026-10-12T13:00:02Z',finishedAt:'2026-10-12T13:20:00Z',status:'complete',complete:true,exitCode:0,total:2,scanned:2,triSurfaceStatus:'complete',recoveryReplay:false};
 for(const k of ['desktopRunId','mobileRunId','scorecardRunId'])r[k]=r.runId;
 const task='\\Fuman 買賣超 Cache 2100',instance='{isolated-instance}',exe='C:/Program Files/PowerShell/7/pwsh.exe';
 const observation={ok:true,runnerPid:1234,parentPid:1234,runnerStartedAt:'2026-10-12T13:00:01Z',runnerOwnerSid:'S-1-5-21-fixture',taskPrincipalSid:'S-1-5-21-fixture',executablePath:exe,commandLine:`pwsh -File "${authority.scriptPath}"`,taskName:task,actions:[{Execute:exe,Arguments:`-File "${authority.scriptPath}"`}],events:[{id:107,recordId:1,time:'2026-10-12T13:00:00Z',fields:{TaskName:task,InstanceId:instance}},{id:200,recordId:2,time:'2026-10-12T13:00:01Z',fields:{TaskName:task,TaskInstanceId:instance,EnginePID:'1234',ActionName:exe}}]};
 const assessment={naturalSlotComplete:true,recoveryReplay:false,naturalEvidenceStatus:'NATURAL_TRIGGER_VERIFIED',naturalTaskInstanceId:instance};
 const evidence={contract:'strategy-natural-trigger-v1',strategy:'institution',runId:r.runId,tradeDate:r.marketDate,checkedAt:'2026-10-12T13:20:01Z',release:{ok:true,...authority},observation,assessment};
 const naturalPath=path.join(tmp,'natural-origin','institution','fixture.json');fs.mkdirSync(path.dirname(naturalPath),{recursive:true});
 const proof={...assessment,naturalEvidencePath:naturalPath,naturalEvidenceSha256:''};
 function writeNatural(){const bytes=JSON.stringify(evidence,null,2)+'\n';fs.writeFileSync(naturalPath,bytes);proof.naturalEvidenceSha256=digest(bytes);}
 function writeLink(){fs.mkdirSync(path.dirname(link.proofPath(file,r)),{recursive:true});fs.writeFileSync(link.proofPath(file,r),JSON.stringify({contract:'institution-origin-link-v1',runId:r.runId,receiptSha256:link.hash(r),proof}));fs.writeFileSync(file,JSON.stringify(r));}
 writeNatural();fs.writeFileSync(file,JSON.stringify(r));
 return {tmp,file,r,authority,evidence,proof,naturalPath,writeNatural,writeLink};
}
module.exports={fixture};
