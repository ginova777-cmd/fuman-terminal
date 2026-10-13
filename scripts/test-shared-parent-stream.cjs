'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),assert=require('assert/strict');
const s=require('../lib/daytrade-shared-evidence.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'parent-stream-'));
const rounds=[1,2].map(n=>({module_id:'TEST',writer_run_id:'w'+n,rows:Array.from({length:3},()=>({text:'臺灣😀\\"'.repeat(300),n}))})),files=rounds.map((r,i)=>{const f=path.join(root,'round'+i+'.json');s.write(f,r,root);return f;});
const value={module_id:'TEST',rounds_verified:rounds,complete:true,text:'a😀b'},file=path.join(root,'result.json'),e=s.write(file,value,root,{roundFiles:files}),raw=JSON.stringify(value);
assert.equal(e.sha256,crypto.createHash('sha256').update(raw).digest('hex'));assert.equal(e.bytes,Buffer.byteLength(raw));assert.deepEqual(s.read(file,root),value);assert.equal(s.verifyProcessBytes(file,root,e.sha256).sha256,e.sha256);
rounds[0].writer_run_id='changed';assert.throws(()=>s.write(path.join(root,'wrong.json'),value,root,{roundFiles:files}),/PARENT_CHANGED/);
console.log('PASS parent stream equals complete JSON bytes/hash; independent readback; mutated verified object rejected');
