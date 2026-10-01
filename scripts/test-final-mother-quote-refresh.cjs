'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {batches}=require('../lib/daytrade-write-batches');
const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const start=source.indexOf('  // Refresh every current mother-pool member'),end=source.indexOf('  let nextState =',start);
assert(start>0&&end>start);
const block=source.slice(start,end),at='2026-10-01T04:00:00Z';
async function run(failure){
 const fresh=Array.from({length:357},(_,i)=>({symbol:String(4000+i),trade_date:'2026-10-01',quote_seen_at:at,updated_at:at,last_trade_time:at,price:20+i,payload:{evidence:'原生'.repeat(300),native:true},age:1}));
 const stale={...fresh[0],symbol:'8000',age:121};
 const priorityRows=[...fresh,stale,{symbol:'8001'}].map(q=>({symbol:q.symbol}));
 const writes=[],ticks=[],quoteMap=new Map();
 const context={Buffer,Map,Math,priorityRows,quoteMap,DEEP_SCAN_POOL_MAX_SYMBOLS:60,SLOW_TABLE_BATCH_SIZE:300,WINDOW_SECONDS:120,
 mergeWebSocketQuoteCache:map=>[...fresh,stale,{...fresh[0],symbol:'9999'}].forEach(q=>map.set(q.symbol,q)),
 normalizeCode:x=>/^\d{4}$/.test(x)?x:'',effectiveQuoteAgeSeconds:q=>q.age,quoteTradeDateForWrite:q=>q.trade_date,
 normalizeTimestamp:x=>x,nowIso:()=>at,numberValue:x=>Number(x)||0,websocketQuoteReadthroughSync:{written:0},fetchResult:{errors:[]},tickStage:(s,v)=>ticks.push({s,...v}),
 supabaseUpsert:async(table,rows,key,options)=>{assert.equal(table,'fugle_daytrade_quotes_live');assert.equal(key,'symbol');if(failure)throw failure;writes.push({rows,options});}};
 try{await vm.runInNewContext('(async()=>{'+block+'})()',context);assert(!failure);}catch(e){assert.equal(e,failure);}
 if(failure){assert.equal(quoteMap.size,0);assert(!ticks.some(x=>x.s==='final_mother_quotes:complete'));return;}
 const {rows,options}=writes[0];assert.equal(rows.length,357);assert.equal(quoteMap.size,357);assert.equal(rows.at(-1).symbol,'4356');
 assert(!rows.some(x=>['8000','8001','9999'].includes(x.symbol)));
 assert.equal(options.maxBatchBytes,256*1024);assert.equal(options.batchSize,100);
 const groups=[...batches(rows,{maxRows:options.batchSize,maxBytes:options.maxBatchBytes})];
 assert.equal(groups.flatMap(x=>x.chunk).length,357);assert(groups.every(x=>Buffer.byteLength(x.body)<=256*1024&&x.chunk.length<=100));
 assert(rows.every(x=>x.quote_seen_at===at&&x.last_trade_time===at&&x.payload.native===true));
}
(async()=>{await run(null);await run(Object.assign(Error('unknown write'),{name:'TimeoutError'}));console.log('PASS actual final Writer refresh covers 357 beyond deep-scan 60; stale/missing/non-member excluded; native times retained; 256KiB/100-row batches; uncertain writes stop');})().catch(e=>{console.error(e);process.exitCode=1;});
