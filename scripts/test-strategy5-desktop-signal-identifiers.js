'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../terminal-desktop-fast-shell.js'),'utf8');
const start=source.indexOf('  function normalizeSignalRows('),end=source.indexOf('  function signalSummary(',start);
assert(start>=0&&end>start);
const context={isStrategy4Route:()=>false,isStrategy5Route:r=>r==='strategy|策略5',compactText:(v,n)=>String(v).slice(0,n)};
vm.createContext(context);vm.runInContext(source.slice(start,end)+';this.normalize=normalizeSignalRows',context);
const ids=['margin_up_price_up_institutional_continuous_buy','margin_down_price_up_institutional_continuous_buy','w_bottom_rebound_ma3_ma5_ma10_institution_two_day_buy'];
for(const id of ids){const [row]=context.normalize([{id,label:id}],'strategy|策略5');assert.equal(row.id,id,'machine strategy IDs must remain intact for exact counts and filters');}
console.log('PASS Strategy5 47/49/53-character signal IDs survive desktop normalization');
