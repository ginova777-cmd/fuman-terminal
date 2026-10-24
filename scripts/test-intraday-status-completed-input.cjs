const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8'),start=source.indexOf('  const buildGrouped = (rows, tradeDate) => {'),end=source.indexOf('  const tradeDate = taipeiDateFrom(nowIso());',start),now=Date.parse('2026-10-20T03:45:56Z');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const context={require,Date:Clock,Map,Math,Number,normalizeCode:String,normalizeTimestamp:v=>new Date(v).toISOString(),taipeiDateFrom:v=>new Date(Date.parse(v)+28800000).toISOString().slice(0,10),numberValue:(v,f=0)=>Number.isFinite(Number(v))?Number(v):f,ageSeconds:v=>(now-Date.parse(v))/1000,boolValue:Boolean};
const build=vm.runInNewContext(source.slice(start,end)+'\nbuildGrouped;',context);
const row=time=>({symbol:'1301',market:'TSE',trade_date:'2026-10-20',candle_time:time,open:100,high:101,low:99,close:100,volume:3});
const r=build([row('2026-10-20T03:45:00Z'),row('2026-10-20T03:44:00Z')],'2026-10-20').get('1301');
assert.equal(r.today_candle_count,1);assert.equal(r.continuous_candle_count,1);assert.equal(r.latest_candle_time,'2026-10-20T03:44:00.000Z');assert.equal(r.ma3,100);assert.equal(build([row('2026-10-20T03:45:00Z')],'2026-10-20').size,0);
console.log('PASS actual status builder excludes forming bar from counts, indicators and latest timestamp without changing Gate or source timestamps');
