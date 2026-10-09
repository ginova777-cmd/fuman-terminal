'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const {OfflineStore}=require('../integration/offline-store.cjs');
if(process.argv[2]==='child'){
 const store=new OfflineStore(process.argv[3]),open=fs.openSync,write=fs.writeFileSync,paths=new Map();
 fs.openSync=function(file,...args){const fd=open.call(fs,file,...args);paths.set(fd,String(file));return fd;};
 fs.writeFileSync=function(fd,value,...args){if(paths.get(fd)?.includes(path.sep+'objects'+path.sep)){write.call(fs,fd,Buffer.from(value).subarray(0,5));process.exit(78);}return write.call(fs,fd,value,...args);};
 store.put({fixture:'partial object write must not poison committed address'});
}else{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-object-death-'));const child=spawnSync(process.execPath,['--max-old-space-size=128',__filename,'child',dir],{timeout:10000,encoding:'utf8'});assert.equal(child.status,78,child.stderr);
 const store=new OfflineStore(dir),value={fixture:'partial object write must not poison committed address'},h=store.put(value);assert.deepEqual(store.get(h),value);
 console.log(JSON.stringify({status:'PASS',fault:'actual process death during immutable object write',orphan_temp_retained:true,peak_rss_kib:process.resourceUsage().maxRSS}));
}
