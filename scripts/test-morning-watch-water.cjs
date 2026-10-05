'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('  const openingReportWaterSeeds =');
const end=source.indexOf('  const fixedUserCasePrefix',start);
assert(start>=0&&end>start);
const code=source.slice(start,end)+'; openingReportCandlePrioritySymbols;';
function run(seeds){const formal=new Set(['1504']);const before=[...formal];const result=vm.runInNewContext(code,{activeSymbols:['1504','2383'],readOpeningReport0830PrioritySeeds:()=>({symbols:seeds}),normalizeCode:v=>String(v||''),priceEligibleSymbolSet:formal});assert.deepEqual([...formal],before);return Array.from(result);}
assert.deepEqual(run([{symbol:'1504'},{symbol:'2383'},{symbol:'2383'},{symbol:'invalid'}]),['1504','2383']);
assert.deepEqual(run([]),[]);
const membership=require('../lib/daytrade-published-membership');
const preservation=require('../lib/opening-report-writer-preservation');
const evidence={date:'2026-10-05',formal_candidate_allowed:false,forbidden_publish_guard:true};
const rows=[];preservation.preserveMorningWatchRows(rows,[{symbol:'2383',openingReport0830IndustryBias:evidence}],'2026-10-05','2026-10-05T00:50:00Z',60);
assert.equal(rows.length,1);assert.equal(membership.isPublishedMotherMember(rows[0]),false);
assert.deepEqual(run([{symbol:'2383',openingReport0830IndustryBias:evidence}]),['2383']);
const joined=source.slice(source.indexOf('  const daytradeCandlePrioritySymbols ='),source.indexOf('  const activeUniverseSymbols =',source.indexOf('  const daytradeCandlePrioritySymbols =')));
assert(joined.includes('...openingReportCandlePrioritySymbols'));
console.log('PASS: morning observation gets water priority without granting formal membership; empty verified handoff adds nothing; duplicates removed.');

const {mergeCurrentDayCandlePrioritySymbols:merge}=require('../lib/daytrade-candle-priority-persistence');
const oldSymbols=Array.from({length:359},(_,i)=>String(1000+i));
const morning=Array.from({length:31},(_,i)=>String(6000+i));
const mergeStart=source.indexOf('  const nextDaytradeCandlePrioritySymbols = mergeCurrentDayCandlePrioritySymbols({');
const mergeEnd=source.indexOf('  const motherPoolSnapshot =',mergeStart);
const result=Array.from(vm.runInNewContext(source.slice(mergeStart,mergeEnd)+';nextDaytradeCandlePrioritySymbols;',{
mergeCurrentDayCandlePrioritySymbols:merge,currentExisting:{tradeDate:'2026-10-05',canonicalRunId:'run',daytradeCandlePrioritySymbols:oldSymbols},tradeDate:'2026-10-05',canonicalRunId:'run',userCaseCandlePrioritySymbols:['9999'],openingReportCandlePrioritySymbols:morning,fiveMinutePriorityEvidence:{},fullTerminalWarmupSymbols:oldSymbols,daytradeCandlePrioritySymbols:morning,prependUnique:(a,b)=>[...new Set([...a,...b])] }));
assert.equal(result[0],'9999');for(const s of morning)assert(result.indexOf(s)<200);for(const s of oldSymbols)assert(result.includes(s));
console.log('PASS: retained 359-symbol manifest does not push morning water behind trade capacity; existing symbols retained.');
