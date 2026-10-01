'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
process.env.FUMAN_RUNTIME_DIR=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'gate-reader-'));
function reader(name,fetch){
 const file=path.resolve(__dirname,'../lib',name+'.js');
 const context={require:createRequire(file),module:{exports:{}},__dirname:path.dirname(file),process,console,URL,URLSearchParams,AbortSignal,setTimeout,fetch};
 vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.testReadRows=readRows;',context);
 return context.module.exports.testReadRows;
}
(async()=>{
 for(const name of ['daytrade-canonical-water-reader','strategy3-canonical-water-reader']){
  for(const target of ['v_fugle_daytrade_canonical_gate','v_fugle_daytrade_unattended_gate_status']){
   let calls=0;
   const read=reader(name,async()=>{calls++;return {ok:false,status:503,text:async()=>''};});
   const key=name+target;
   await assert.rejects(read(key,target,{select:'*',limit:1}),e=>e.status===503 && Number.isFinite(e.retry_at));
   assert.equal(calls,1,'gate must not immediately retry');
   await assert.rejects(read(key,target,{select:'*',limit:1}),e=>e.code==='GATE_READ_BACKOFF');
   assert.equal(calls,1);
  }
  let calls=0;const read=reader(name,async()=>{calls++;return {ok:false,status:403,text:async()=>''};});
  await assert.rejects(read(name+'permission','v_fugle_daytrade_canonical_gate'),e=>e.status===403);assert.equal(calls,1);
  let attempts=0;const ordinary=reader(name,async()=>{if(++attempts===1)throw new DOMException('timeout','TimeoutError');return {ok:true,json:async()=>[{symbol:'2330'}]};});
  const rows=await ordinary('test','quotes');assert.equal(rows[0].symbol,'2330');assert.equal(attempts,2);
 }
 // Both readers share one in-flight gate request with identical identity.
 let release,calls=0;const wait=new Promise(resolve=>release=resolve);
 const fetch=async()=>{calls++;await wait;return {ok:true,json:async()=>[{formal_entry_allowed:false}]};};
 const a=reader('daytrade-canonical-water-reader',fetch),b=reader('strategy3-canonical-water-reader',fetch);
 const one=a('shared','v_fugle_daytrade_canonical_gate'),two=b('shared','v_fugle_daytrade_canonical_gate');
 release();const results=await Promise.all([one,two]);assert.equal(calls,1);assert.equal(results[0][0].formal_entry_allowed,false);
 console.log('PASS: both real readers issue one gate attempt, respect persisted cooldown, preserve permissions and non-gate behavior, and share in-flight requests.');
})().catch(e=>{console.error(e);process.exitCode=1;});
