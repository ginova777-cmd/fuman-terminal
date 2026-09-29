'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'a16-atomic-'));
const file=path.join(dir,'progress.json'),source=fs.readFileSync(path.join(__dirname,'../lib/mother-pool-a16-io.js'),'utf8');
try {
 for(const fault of ['write','flush','rename',null]){
  fs.writeFileSync(file,JSON.stringify({attempted:10}));const events=[];
  const fail=()=>{const e=new Error('injected '+fault);e.code='EIO';throw e;};
  const fake={...fs,writeFileSync:(fd,bytes)=>{events.push('write');if(fault==='write'){fs.writeSync(fd,bytes.slice(0,4));fail();}return fs.writeFileSync(fd,bytes);},fsyncSync:fd=>{events.push('flush');if(fault==='flush')fail();return fs.fsyncSync(fd);},renameSync:(a,b)=>{events.push('rename');if(fault==='rename')fail();return fs.renameSync(a,b);}};
  const mod={exports:{}};vm.runInNewContext(source,{require:n=>n==='node:fs'?fake:require(n),module:mod,process});
  if(fault){assert.throws(()=>mod.exports.atomic(file,{attempted:11}),/injected/);assert.deepEqual(JSON.parse(fs.readFileSync(file)),{attempted:10});}
  else{mod.exports.atomic(file,{attempted:11});assert.deepEqual(JSON.parse(fs.readFileSync(file)),{attempted:11});assert.deepEqual(events,['write','flush','rename']);}
  assert.deepEqual(fs.readdirSync(dir),['progress.json']);
 }
 console.log('PASS A16 progress: partial write, flush and rename failures preserve old JSON; flush precedes publication');
}finally{for(const name of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,name));fs.rmdirSync(dir);}
