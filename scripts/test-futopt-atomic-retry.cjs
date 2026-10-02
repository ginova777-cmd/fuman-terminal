'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'futopt-atomic-')),'cache.json');
const source=fs.readFileSync(path.join(__dirname,'../lib/fugle-futopt-websocket.js'),'utf8');
const body=source.slice(source.indexOf('function writeJson('),source.indexOf('\nfunction normalizeFutureSymbol('));
function run(code,failures){
 fs.writeFileSync(file,JSON.stringify({old:true}));let calls=0,sleeps=[];
 const mock={...fs,renameSync(a,b){calls++;assert.deepEqual(JSON.parse(fs.readFileSync(file)),{old:true});if(calls<=failures)throw Object.assign(Error('injected lock'),{code});fs.renameSync(a,b);}};
 const ctx={fs:mock,path,process,Date,SharedArrayBuffer,Int32Array,Atomics:{wait:(_a,_b,_c,ms)=>sleeps.push(ms)}};
 vm.runInNewContext(body,ctx);let error;try{ctx.writeJson(file,{new:true,rows:[1,2,3]});}catch(e){error=e;}
 return {calls,sleeps,error,value:JSON.parse(fs.readFileSync(file)),temps:fs.readdirSync(path.dirname(file)).filter(n=>n!==path.basename(file))};
}
for(const code of ['EPERM','EACCES','EBUSY']){const r=run(code,2);assert.equal(r.error,undefined);assert.equal(r.calls,3);assert.deepEqual(r.sleeps,[10,20]);assert.deepEqual(r.value,{new:true,rows:[1,2,3]});assert.equal(r.temps.length,0);}
let r=run('EPERM',99);assert.equal(r.error.code,'EPERM');assert.equal(r.calls,5);assert.equal(r.sleeps.reduce((a,b)=>a+b,0),150);assert.deepEqual(r.value,{old:true});assert.equal(r.temps.length,0);
r=run('ENOSPC',99);assert.equal(r.calls,1);assert.equal(r.sleeps.length,0);assert.deepEqual(r.value,{old:true});
console.log('PASS: transient Windows locks recover; permanent/error failures retain old JSON; bounded 150 ms; no partial overwrite or temporary leak');
