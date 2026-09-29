'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {client,readSide}=require('../lib/mother-pool-a16-io');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'a16-io-test-')),original=global.fetch;
 fs.mkdirSync(path.join(dir,'secrets'));for(const role of ['anon','service-role'])fs.writeFileSync(path.join(dir,'secrets','supabase-'+role+'-key.txt'),role);
 try{
  const receipt={trade_date:'2026-09-29',canonical_run_id:'c',symbol:'1301',rows:[{minute:'09:00',value:1,samples:[1]}]};
  for(const mode of ['ok','timeout','bad-db','bad-anon','bad-identity','missing','http']){
   let stored,calls=[];
   global.fetch=async(url,opt)=>{
    calls.push({url,method:opt.method,key:opt.headers.apikey});
    if(opt.method==='POST'){
     stored=JSON.parse(opt.body)[0];
     if(mode==='timeout')throw Object.assign(Error('timeout'),{name:'TimeoutError'});
     if(mode==='http')return {ok:false,status:403,text:async()=>''};
     return {ok:true,text:async()=>''};
    }
    const row=JSON.parse(JSON.stringify(stored)),service=opt.headers.apikey==='service-role';
    if((mode==='bad-db'&&service)||(mode==='bad-anon'&&!service))row.payload.rows[0].value=9;
    if(mode==='bad-identity')row.generation='other';
    return {ok:true,text:async()=>JSON.stringify(mode==='missing'?[]:[row])};
   };
   if(['ok','timeout'].includes(mode)){
    const result=await client(dir).writeReadback(receipt,'g');assert.equal(result.db_readback_ok,true);assert.equal(result.anon_readback_ok,true);
    assert.equal(calls.length,3);assert.equal(calls[1].key,'service-role');assert.match(calls[1].url,/\/mother_pool_a16_baselines\?/);assert.equal(calls[2].key,'anon');assert.match(calls[2].url,/\/v_mother_pool_a16_baselines\?/);
    if(mode==='timeout')assert.equal(result.write_ack,'exact_readback_after_timeout');
   }else await assert.rejects(client(dir).writeReadback(receipt,'g'),/MISMATCH|HTTP_403/);
   assert.equal(calls.filter(c=>c.method==='POST').length,1);
   if(['bad-db','bad-identity','missing'].includes(mode)){assert.equal(calls.length,2);assert.equal(calls.some(c=>c.key==='anon'),false,'DB failure must stop before anon');}
  }
  for(const kind of ['provider-trade-journal','provider-side-journal']){const folder=path.join(dir,'data',kind,'2026-09-24');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'1301.jsonl'),'{}\n\u0000\n');}
  assert.throws(()=>readSide(dir,'1301',['2026-09-24']),/A16_JOURNAL_JSON_INVALID:.*1301.jsonl:line=2/);
  console.log('PASS: independent DB and anon, payload/identity/count rejection, timeout without replay, corrupt journal context');
 }finally{global.fetch=original;fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
