'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
test('Windows Job Object stops descendants before releasing the stage',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-job-test-'));
 const fixture=path.join(dir,'tree.cjs'),out=path.join(dir,'result.json');
 fs.writeFileSync(fixture,`const fs=require('fs'),cp=require('child_process');fs.appendFileSync(process.argv[2],process.pid+'\\n');if(Number(process.argv[3])>0)cp.spawn(process.execPath,[__filename,process.argv[2],String(Number(process.argv[3])-1)],{stdio:'ignore'});setInterval(()=>fs.appendFileSync(process.argv[2]+'.beat','x'),50);`);
 const pids=path.join(dir,'pids');
 const result=cp.spawnSync('pwsh.exe',['-NoProfile','-File',path.join(__dirname,'Invoke-CleanupProcess.ps1'),'-Executable',process.execPath,'-ArgumentsBase64',Buffer.from(JSON.stringify([fixture,pids,'2'])).toString('base64'),'-WorkingDirectory',dir,'-TimeoutMilliseconds','1500','-ResultFile',out],{encoding:'utf8',timeout:15000,windowsHide:true});
 assert.equal(result.status,124,result.stderr);const evidence=JSON.parse(fs.readFileSync(out,'utf8').replace(/^\uFEFF/,''));assert.equal(evidence.treeStopped,true);assert.equal(evidence.activeProcesses,0);assert.equal(evidence.timedOut,true);
 const ids=fs.readFileSync(pids,'utf8').trim().split(/\s+/).map(Number);assert.equal(ids.length,3);
 for(const pid of ids)assert.throws(()=>process.kill(pid,0));
 const before=fs.readFileSync(pids+'.beat','utf8');await new Promise(r=>setTimeout(r,300));assert.equal(fs.readFileSync(pids+'.beat','utf8'),before);
 console.log(JSON.stringify({scope:'isolated actual three-process tree',evidence:out,pids:ids}));
});
test('absolute deadline includes helper setup instead of starting a new budget',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-deadline-test-')),out=path.join(dir,'result.json'),marker=path.join(dir,'must-not-exist');
 const result=cp.spawnSync('pwsh.exe',['-NoProfile','-File',path.join(__dirname,'Invoke-CleanupProcess.ps1'),'-Executable',process.execPath,'-ArgumentsBase64',Buffer.from(JSON.stringify(['-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'unsafe')`])).toString('base64'),'-WorkingDirectory',dir,'-TimeoutMilliseconds','10000','-DeadlineEpochMilliseconds',String(Date.now()-1),'-ResultFile',out],{encoding:'utf8',timeout:15000,windowsHide:true});
 assert.notEqual(result.status,0);assert.equal(fs.existsSync(marker),false);assert.match(JSON.parse(fs.readFileSync(out,'utf8').replace(/^\uFEFF/,'')).error,/deadline_expired_before_spawn/);
});
test('unexpected supervisor termination closes the job and kills its children',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-supervisor-test-')),pids=path.join(dir,'pids'),fixture=path.join(dir,'tree.cjs');
 fs.writeFileSync(fixture,`const fs=require('fs'),cp=require('child_process');fs.appendFileSync(process.argv[2],process.pid+'\\n');if(process.argv[3]==='parent')cp.spawn(process.execPath,[__filename,process.argv[2],'child'],{stdio:'ignore'});setInterval(()=>fs.appendFileSync(process.argv[2]+'.beat','x'),30);`);
 const child=cp.spawn('pwsh.exe',['-NoProfile','-File',path.join(__dirname,'Invoke-CleanupProcess.ps1'),'-Executable',process.execPath,'-ArgumentsBase64',Buffer.from(JSON.stringify([fixture,pids,'parent'])).toString('base64'),'-WorkingDirectory',dir,'-TimeoutMilliseconds','10000','-ResultFile',path.join(dir,'result.json')],{windowsHide:true,stdio:'ignore'});
 const closed=new Promise(resolve=>child.once('close',resolve));let ids=[];
 try{const deadline=Date.now()+8000;while(Date.now()<deadline){if(fs.existsSync(pids))ids=fs.readFileSync(pids,'utf8').trim().split(/\s+/).map(Number);if(ids.length===2)break;await new Promise(r=>setTimeout(r,30));}assert.equal(ids.length,2);child.kill();await closed;const deadline2=Date.now()+3000;while(Date.now()<deadline2&&ids.some(pid=>{try{process.kill(pid,0);return true;}catch{return false;}}))await new Promise(r=>setTimeout(r,30));for(const pid of ids)assert.throws(()=>process.kill(pid,0));const before=fs.readFileSync(pids+'.beat','utf8');await new Promise(r=>setTimeout(r,150));assert.equal(fs.readFileSync(pids+'.beat','utf8'),before);
 }finally{child.kill();await closed;}
});
