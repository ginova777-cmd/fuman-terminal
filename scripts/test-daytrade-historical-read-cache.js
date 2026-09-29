'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const cache=require('../lib/daytrade-historical-read-cache');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-cache-')),file=path.join(dir,'cache.json');
const scope={tradeDate:'2026-09-29',source:'view',query:'fixed',sessionDates:['2026-09-24']},rows=[{symbol:'2330',trade_date:'2026-09-24',volume_lots:100}],at='2026-09-29T00:00:00Z',now=Date.parse(at);
try{
 assert.equal(cache.load(file,scope,now),null);
 cache.save(file,scope,rows,at);
 const child=spawnSync(process.execPath,['-e',`const c=require(${JSON.stringify(require.resolve('../lib/daytrade-historical-read-cache'))});console.log(JSON.stringify(c.load(process.argv[1],JSON.parse(process.argv[2]),Number(process.argv[3]))))`,file,JSON.stringify(scope),String(now+1000)],{encoding:'utf8',windowsHide:true});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{rows,readAt:at,cacheHit:true});
 assert.equal(cache.load(file,scope,now+1800001),null);assert.equal(cache.load(file,scope,now-1),null);
 for(const change of [{tradeDate:'2026-09-30'},{query:'changed'},{source:'other'},{sessionDates:['2026-09-23']}])assert.equal(cache.load(file,{...scope,...change},now),null);
 const e=JSON.parse(fs.readFileSync(file));e.rows[0].volume_lots=999;fs.writeFileSync(file,JSON.stringify(e));assert.equal(cache.load(file,scope,now),null);
 fs.writeFileSync(file,'{"partial":');assert.equal(cache.load(file,scope,now),null);
 assert.equal(cache.save(file,scope,[],at),false);
 console.log('PASS cross-process historical cache, original timestamp, expiration, future time, scope drift, corruption and incomplete JSON');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
