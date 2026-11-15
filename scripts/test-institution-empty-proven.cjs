const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const s=fs.readFileSync(path.join(__dirname,'../terminal-desktop-fast-shell.js'),'utf8');
const start=s.indexOf('  function institutionZeroResultProven('),end=s.indexOf('\n  function ',start+10),ctx={};
assert(start>=0&&end>start);vm.runInNewContext(s.slice(start,end),ctx);
const good={ok:true,runId:'institution-20261113-20261113132516',resultCount:0,evidenceStatus:'complete',publishAllowed:true};
assert.equal(ctx.institutionZeroResultProven(good),true);
for(const m of [null,{}, {...good,ok:false},{...good,runId:''},{...good,resultCount:84},{...good,resultCount:null},{...good,evidenceStatus:'pending'},{...good,publishAllowed:false},{...good,runId:'strategy5-20261113-20261113130254'},{ok:false,error:'protected_strategy_api_timeout'}])assert.equal(ctx.institutionZeroResultProven(m),false);
assert(s.includes('isChipTradeRoute(route) && !rows.length && !allRows.length && !institutionZeroResultProven(payloadMeta)'));
console.log('PASS: only authoritative complete zero can render no-results; loading, timeout, blocked, missing identity and original84 cannot');
