'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const mobile=fs.readFileSync(path.join(root,'api/mobile-fragment.js'),'utf8');
const start=mobile.indexOf('function normalizeRows('),end=mobile.indexOf('\nfunction ',start+10);
const ctx={arrayAt:p=>p.matches,isValidBusinessRow:r=>/^\d{4}$/.test(r?.code)};
vm.runInNewContext(mobile.slice(start,end),ctx);
for(const count of [0,20,60,140,190,194,2000]){
 const rows=Array.from({length:count},(_,i)=>({code:String(1000+i),score:110-i/100}));
 const result=ctx.normalizeRows({matches:rows},'strategy5');
 assert.deepEqual(Array.from(result,r=>r.code),rows.map(r=>r.code),'full mobile set '+count);
}
assert.equal(ctx.normalizeRows({matches:[{code:'1234'},{code:'bad'}]},'strategy5').length,1);
const desktop=fs.readFileSync(path.join(root,'terminal-desktop-fast-shell.js'),'utf8');
assert(desktop.includes('"strategy|策略5": { limit: 2000,'));
assert(!desktop.includes('isStrategy5Route(route) ? 140 : 120'));
assert(mobile.includes('["strategy5", "chip"].includes(tab) ? 2000 : 60'));
assert(fs.readFileSync(path.join(root,'lib/desktop-route-snapshot-builder.js'),'utf8').includes('strategy5Latest, liveCompactQuery(2000)'));
console.log('PASS: full Strategy5 visible sets, order and invalid-row filtering; API/snapshot budgets aligned');
