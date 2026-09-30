const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'),writer=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
(async()=>{
const fn=writer.slice(writer.indexOf('async function prioritizeIntradayFiveMinuteStrong(rows)'),writer.indexOf('function ensureDailyStockMasterComplete()'));
const rows=[{symbol:'6531',score:1},{symbol:'2330',score:9}];
const result=await vm.runInNewContext(fn+';prioritizeIntradayFiveMinuteStrong(rows)',{rows,require(){throw Error('unexpected I/O dependency')}});
assert.equal(result,rows);assert.deepEqual(rows.map(x=>x.symbol),['6531','2330']);assert.equal(result.fiveMinutePriorityEvidence.status,'DISABLED');
assert(!writer.includes("require('../lib/mother-pool-five-minute-source')"));assert(!writer.includes("require('../lib/mother-pool-five-minute-producer')"));
for(const name of ['run-daytrade-intraday-5m-writer.js','run-daytrade-intraday-5m-complete.js']){const r=spawnSync(process.execPath,[path.join(__dirname,name),'--symbols=6531'],{encoding:'utf8',env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});assert.equal(r.status,0);const receipt=JSON.parse(r.stdout);assert.equal(receipt.status,'DISABLED');assert.equal(receipt.database_writes,0);assert.equal(receipt.api_calls,0);assert.equal(receipt.complete,false);}
const inventory=require('./verify-mother-pool-wiring-inventory').verify(root);assert(inventory.ok,JSON.stringify(inventory));assert(inventory.excluded.includes('B15'));
console.log('PASS: retired entrypoints make no I/O; writer preserves order; B15 explicitly excluded; remaining module wiring valid');
})();
