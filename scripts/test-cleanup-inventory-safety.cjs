'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');const P=require('./cleanup-item-observation');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const base={contract:'cleanup-item-observation-v1',id:'C06',runId:'isolated',inventoryComplete:true,readbackComplete:true,before:[{key:'protected',sha256:sha('a')}],after:[{key:'protected',sha256:sha('a')},{key:'new',sha256:sha('b')}],candidates:[]};
assert.throws(()=>P.reconcile(base),/unexpected_new/);
const p={...base,preservedNewMembers:[base.after[1]]};assert.equal(P.reconcile(p).deleted,0);assert.equal(P.reconcile(p).preservedNewMembers.length,1);
assert.throws(()=>P.reconcile({...p,preservedNewMembers:[{key:'new',sha256:sha('wrong')}]}),/unexpected_new/);
assert.throws(()=>P.reconcile({...p,after:[{key:'protected',sha256:sha('changed')},base.after[1]]}),/protected_changed/);
const dir=fs.mkdtempSync(path.resolve(__dirname,'../../inventory-safety-')),file=path.join(dir,'file');fs.writeFileSync(file,'original');
assert.equal(P.files([file])[0].sha256,sha('original'));
const nativeRead=fs.readSync;let changed=false;
try{fs.readSync=function(...args){const n=nativeRead(...args);if(!changed){changed=true;fs.renameSync(file,file+'.old');fs.writeFileSync(file,'replaced');}return n;};assert.throws(()=>P.files([file]),/inventory_changed/);}finally{fs.readSync=nativeRead;}
const link=path.join(dir,'link');fs.symlinkSync(dir,link,'junction');assert.throws(()=>P.files([link]),/inventory_link/);
console.log(JSON.stringify({ok:true,checks:8,productionActions:false,fixture:dir}));
