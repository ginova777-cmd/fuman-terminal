'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'total-index-')),date='2026-09-29',canonical='test-canonical';
const ids=[...Array.from({length:19},(_,i)=>'A'+String(i+1).padStart(2,'0')),...Array.from({length:24},(_,i)=>'B'+String(i+1).padStart(2,'0'))];
const item=path.join(runtime,'a01.json');fs.writeFileSync(item,JSON.stringify({module_id:'A01',trade_date:date,complete:false,status:'blocked'}));
const guard=path.join(runtime,'read-guard.cjs');fs.writeFileSync(guard,`const fs=require('fs'),path=require('path');const original=fs.readdirSync;fs.readdirSync=function(p,...args){if(path.resolve(p).startsWith(${JSON.stringify(runtime)}))throw Error('UNEXPECTED_HISTORY_SCAN');return original.call(this,p,...args);};`);
const index={trade_date:date,canonical_run_id:canonical,results:ids.map(module_id=>({module_id,complete:false,...(module_id==='A01'?{out:item}:{})}))};
function run(value,label){const input=path.join(runtime,label+'-index.json'),out=path.join(runtime,label+'-out.json');fs.writeFileSync(input,JSON.stringify(value));
 const p=spawnSync(process.execPath,['-r',guard,path.join(__dirname,'verify-daytrade-mother-pool-a01-b24-total.js'),'--runtime='+runtime,'--trade-date='+date,'--canonical='+canonical,'--module-results='+input,'--out='+out],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(p.error,undefined);assert.equal(p.status,1,p.stderr);return JSON.parse(fs.readFileSync(out));}
const good=run(index,'valid');assert.equal(good.item_count,43);assert.equal(good.complete,false);assert.equal(good.items[0].status,'EVIDENCE_FOUND');assert(!good.failed_checks.includes('MODULE_RESULT_INDEX_INVALID'));
const wrong=run({...index,trade_date:'2026-09-28'},'wrong-date');assert(wrong.failed_checks.includes('MODULE_RESULT_INDEX_INVALID'));assert(wrong.items.every(x=>!x.evidence.length));
const duplicate=structuredClone(index);duplicate.results[1].module_id='A01';assert(run(duplicate,'duplicate').failed_checks.includes('MODULE_RESULT_INDEX_INVALID'));
console.log('PASS only indexed receipts read, no history traversal, 43-item scope retained, invalid date and duplicate module indexes rejected. No network.');
