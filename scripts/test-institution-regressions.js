const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path'),{createRequire}=require('module');
const root=process.argv[2]||path.resolve(__dirname,'..');
const source=path.join(root,'api/institution.js');const ctx={require:createRequire(source),module:{exports:{}},process,console,fetch,URL,Date,AbortController,setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(source,'utf8')+'\nmodule.exports={parseTwseRow};',ctx);
const parsed=ctx.module.exports.parseTwseRow(['證券代號','證券名稱','外陸資買賣超股數(不含外資自營商)','外資自營商買賣超股數','投信買賣超股數','自營商買賣超股數','三大法人買賣超股數'],['2330','台積電','100','0','20','-30','90']);
assert.equal(parsed.dealer,-30);assert.equal(parsed.total,parsed.foreign+parsed.trust+parsed.dealer);
const scanner=require(path.join(root,'scripts/scan-institution-cache'));assert.equal(scanner.buildFieldCompleteness([{code:'2330',name:'台積電',foreign:0,trust:20,dealer:-30,total:-10}]).blankTotal,0);assert(scanner.buildFieldCompleteness([{code:'2330',name:'台積電',foreign:0,trust:20,total:20}]).blankTotal>0);
const row={code:'2330',name:'台積電',foreign:100,trust:20,dealer:-30,total:90,foreignStreak:3,trustStreak:0,jointStreak:0,foreignTrustVolumePct:2,fiveDayAvgVolume:6000,runId:'institution-test',tradeDate:'2026-09-11',source:'TWSE T86',direction:'buy',dataContractSource:'institution-cache'};
const shaped=require(path.join(root,'api/_http-cache')).shapeTopPayload({query:{compact:'1',limit:'60'}},{rows:[row]});for(const key of Object.keys(row))assert.deepEqual(shaped.rows[0][key],row[key],key+' lost in compact bundle');
console.log('PASS official dealer exact header, source field quality incl zero/missing, all Institution bundle fields');
const todaySource={sourceDates:{twse:'20260911',tpex:'20260911'},usedDate:'2026-09-11',errors:[]};
assert.deepEqual(scanner.institutionSourceDateIssues(todaySource,'2026-09-11'),[]);
assert(scanner.institutionSourceDateIssues({...todaySource,sourceDates:{twse:'20260911',tpex:'20260910'}},'2026-09-11').includes('tpex_source_date_not_today'));
assert(scanner.institutionSourceDateIssues({...todaySource,sourceDates:{}},'2026-09-11').includes('twse_source_date_not_today'));
assert(scanner.institutionSourceDateIssues({...todaySource,errors:['terminated']},'2026-09-11').includes('official_source_history_incomplete'));
console.log('PASS both markets same-day and complete official history gate');

assert(scanner.institutionSourceDateIssues({...todaySource,sourceHealth:{warnings:["tpex 5-day metrics failed"]}},"2026-09-11").includes("five_day_metric_history_incomplete"));
console.log("PASS missing metric history blocks publication");
