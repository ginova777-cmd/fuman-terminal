'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'api/terminal-fast-bundle.js'),'utf8');
const start=source.indexOf('function compactSnapshotEndpoints('),end=source.indexOf('\nfunction ',start+10);
const context={shapeTopPayload:require('../api/_http-cache').shapeTopPayload};
vm.runInNewContext(source.slice(start,end)+'\nthis.compact=compactSnapshotEndpoints;',context);
const rows=Array.from({length:127},(_,i)=>({code:String(2000+i),rankingBonusScore:i<23?10:0}));
for(const limit of [undefined,'20','80']){
 const request={query:{compact:'1',shell:'1',...(limit?{limit}:{})},url:'/api/terminal-fast-bundle?compact=1&shell=1'};
 const key='/api/institution-latest?canvas=1&limit=3000';
 const payload={ok:true,runId:'institution-20260918-test',rows,count:127};
 const result=context.compact(request,{[key]:payload,'/api/strategy5-latest':payload,'/api/stocks':payload});
 assert.strictEqual(result[key],payload);assert.strictEqual(result[key].rows.length,127);
 assert.deepStrictEqual(result[key].rows.map(r=>r.code),rows.map(r=>r.code));
 assert.strictEqual(result['/api/strategy5-latest'],payload);
 assert(result['/api/stocks'].rows.length<=80);
}
const table=fs.readFileSync(path.join(root,'terminal-chip-flow.js'),'utf8');
assert(!table.includes('const visibleRows = rows.slice(0, 80)'));
console.log('PASS: Institution 127 rows and ranking survive compact bundle limits; unrelated routes retain compaction; table paginates full list.');
