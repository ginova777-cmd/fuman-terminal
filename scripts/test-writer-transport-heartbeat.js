'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const start=src.indexOf('async function writeFastWebSocketTransportHeartbeat('),end=src.indexOf('async function syncDailyVolumeMirror(',start);
const saved=[];const c={APPLY:true,readWebSocketStatusSummary:()=>({websocketHeartbeatAt:'2026-09-29T00:45:00Z',pipelineHealthy:true}),isFreshWebSocketQuote:q=>q?.fresh===true,normalizeCode:String,writeJson:(path,data)=>saved.push({path,data}),runtimePath:(...p)=>p.join('/'),taipeiDate:()=> '2026-09-29',nowIso:()=> '2026-09-29T00:45:10Z',supabaseGetPaged:()=>{throw Error('forbidden DB read')},supabaseUpsert:()=>{throw Error('forbidden DB write')}};
vm.createContext(c);vm.runInContext(src.slice(start,end)+';globalThis.run=writeFastWebSocketTransportHeartbeat;',c);
(async()=>{
 const result=await c.run({priorityRows:[{symbol:'2330'},{symbol:'2317'}],quoteMap:new Map([['2330',{fresh:true}]])});
 assert.equal(result.written,false);assert.equal(result.local_evidence_written,true);assert.equal(saved.length,1);
 assert.equal(saved[0].data.authoritative,false);assert.equal(saved[0].data.complete,false);assert.equal(saved[0].data.coverage,0.5);
 c.APPLY=false;await c.run({priorityRows:[{symbol:'2330'}],quoteMap:new Map()});assert.equal(saved.length,1);
 console.log('PASS actual Writer heartbeat: local transport evidence only, no source_status read/write, dry run respected');
})().catch(e=>{console.error(e);process.exitCode=1;});
