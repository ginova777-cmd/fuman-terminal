'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const {OfflineStore}=require('./offline-store.cjs'),{reclaim}=require('./recover-dead-owner.cjs');
if(process.argv[2]==='child'){
 const dir=process.argv[3],point=process.argv[4],store=new OfflineStore(dir);
 const write=fs.writeFileSync,rename=fs.renameSync,open=fs.openSync;let tmpfd;fs.openSync=function(file,...args){const fd=open.call(fs,file,...args);if(String(file)===store.rootFile+'.tmp')tmpfd=fd;return fd;};
 fs.writeFileSync=function(file,...args){const r=write.call(fs,file,...args);if(point==='TMP_WRITTEN'&&file===tmpfd)process.exit(77);return r;};
 fs.renameSync=function(a,b){const r=rename.call(fs,a,b);if(point==='ROOT_RENAMED'&&b===store.rootFile)process.exit(77);return r;};
 store.transaction(()=>({sequence:2,value:'new'}));process.exit(0);
}
const results=[];
for(const point of ['TMP_WRITTEN','ROOT_RENAMED']){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-death-')),store=new OfflineStore(dir);store.transaction(()=>({sequence:1,value:'old'}));const child=spawnSync(process.execPath,[__filename,'child',dir,point],{timeout:10000});assert.equal(child.status,77);assert(fs.existsSync(path.join(dir,'owner.lock')));const pid=Number(fs.readFileSync(path.join(dir,'owner.lock')));const r=reclaim(dir,'owner.lock',pid);assert.equal(store.root().sequence,point==='TMP_WRITTEN'?1:2);store.transaction(()=>({sequence:2,value:'new'}));assert.equal(store.root().sequence,2);results.push({point,status:'PASS',exit_code:child.status,recovery:r});}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-alive-'));fs.writeFileSync(path.join(dir,'owner.lock'),String(process.pid));assert.throws(()=>reclaim(dir,'owner.lock',process.pid),/OWNER_ALIVE/);results.push({point:'LIVE_OWNER_REFUSED',status:'PASS'});
fs.writeFileSync(path.join(__dirname,'process-death-tests.json'),JSON.stringify({status:'PASS',results,scope:'actual child exit without finally at root write/rename; not power loss, coordinator pending recovery remains separately tested'},null,2));console.log('3 process death/owner tests PASS');
