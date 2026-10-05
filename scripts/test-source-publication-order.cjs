'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),realRequire=createRequire(path.join(__dirname,'run-daytrade-source-writer.js'));
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const begin=source.indexOf("  const sourceStatusJournal=require('../lib/daytrade-source-status-journal');",source.indexOf('async function writeStatusAndScorecard'));
const end=source.indexOf("  console.log(JSON.stringify({stage:'source_status_ack'",begin);
assert(begin>0&&end>begin);
const code='(async()=>{'+source.slice(begin,end)+'return sourceStatusAck;})()';
async function scenario({mismatch=false,diagnosticError=false,readError=false,saveError=false}={}){
 const events=[],records=[];let stored;
 const row={source_name:'fixture',trade_date:'2026-10-05',updated_at:'2026-10-05T04:44:39.729Z',payload:{trade_date:'2026-10-05',canonical_run_id:'canonical',writer_run_id:'writer',generation_id:'generation'}};
 const ctx={require:n=>n==='../lib/daytrade-source-status-journal'?{prepare:()=>{events.push('prepared');return {}},confirm:()=>events.push('confirmed')}:realRequire(n),
 sourceRow:row,scorecardRow:{},result:{payload:{}},nonFatalWriteErrors:[],tradeDate:'2026-10-05',writerTickIdentity:row.payload,
 nowIso:()=>row.updated_at,runtimePath:(...s)=>s.join('/'),console:{log:()=>{},error:()=>{}},
 traceStatusWrite:async(s,f)=>f(),
 supabaseUpsert:async()=>{events.push('write');stored=JSON.parse(JSON.stringify(row))},
 supabaseGet:async()=>{events.push('read');if(readError)throw Error('READ_FAILED');if(mismatch)stored.payload.generation_id='wrong';return [stored]},
 supabaseInsert:async()=>{events.push('diagnostic');if(diagnosticError)throw Error('DIAGNOSTIC_FAILED')},
 writeJsonAtomic:(file,receipt)=>{events.push('failure_saved');if(saveError)throw Error('DISK_FAILED');records.push({file,receipt})}};
 let value,error;try{value=await vm.runInNewContext(code,ctx)}catch(e){error=e}
 return {events,records,value,error};
}
(async()=>{
 const ok=await scenario();assert.ifError(ok.error);assert.deepEqual(ok.events,['prepared','write','read','confirmed','diagnostic']);assert(ok.value.independent_readback);
 for(const opts of [{mismatch:true},{readError:true}]){const r=await scenario(opts);assert(r.error);assert(!r.events.includes('diagnostic'));assert(!r.events.includes('confirmed'));}
 const d=await scenario({diagnosticError:true});assert.ifError(d.error);assert.equal(d.records.length,1);assert.equal(d.records[0].receipt.complete,false);assert.equal(d.records[0].receipt.status,'DIAGNOSTIC_FAILED_AFTER_CORE_ACK');assert.equal(d.records[0].receipt.writer_run_id,'writer');
 const disk=await scenario({diagnosticError:true,saveError:true});assert.match(disk.error.message,/DISK_FAILED/);
 console.log('PASS actual Writer publication block: normal independent readback, wrong generation/read failure block diagnostic, diagnostic failure receipt, receipt write failure is not success');
})().catch(e=>{console.error(e);process.exitCode=1});
