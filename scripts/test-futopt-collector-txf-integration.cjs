'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const script=path.join(__dirname,'fugle-futopt-websocket-collector.js'),realRequire=createRequire(script);
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'txf-collector-integration-'));
let clock=Date.parse('2026-10-02T01:00:30Z'),socket,restRequests=0;
const pendingScenario=process.argv.includes('--pending-catalogue');
let catalogueReady=!pendingScenario,catalogueRequests=0,socketCount=0;
const intervals=[],sent=[];
const NativeDate=Date;
class ClockDate extends NativeDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
class Socket{
 static OPEN=1;
 constructor(){socketCount++;socket=this;this.readyState=1;this.handlers={};}
 addEventListener(name,fn){this.handlers[name]=fn;}
 send(text){sent.push(JSON.parse(text));}
 close(){this.readyState=3;}
 emit(name,value){this.handlers[name](name==='message'?{data:JSON.stringify(value)}:value);}
}
const readJson=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const ticker={future_symbol:'TXFJ6',product:'TXF',underlying_symbol:'TXF',end_date:'2026-10-21'};
function localRequire(name){
 if(name==='../lib/futopt-graceful-shutdown.cjs')return {createControl:()=>({quiescing:false,start(){}})};
 if(name==='fs')return {...fs,readFileSync:(file,...args)=>String(file).endsWith('fugle-api-key.txt')?'test-only':fs.readFileSync(file,...args)};
 if(name==='../lib/server-supabase-key')return {serverSupabaseKey:()=>'',serverSupabaseUrl:()=>''};
 if(name==='../lib/stock-future-standard-runtime.cjs')return {resolve:()=>({resolutions:[]}),refresh:async()=>{catalogueRequests++;if(!catalogueReady)throw Object.assign(Error('FUTURES_CATALOGUE_PROVIDER_DATE_PENDING'),{providerIdentity:{date:'2026-10-01'}});return {trade_date:'2026-10-02',run_id:'test'};}};
 if(name==='../lib/futopt-catalogue-retry.cjs')return {createCatalogueRetry:options=>realRequire(name).createCatalogueRetry({...options,now:()=>clock})};
 if(name==='../lib/futopt-collector-catalogue')return {build:()=>[ticker]};
 if(name==='../lib/futopt-txf-reference.cjs')return {createReader:()=>()=>({txf_reference:{future_symbol:'TXFJ6',trade_date:'2026-10-02'}})};
 if(name==='../lib/txf-candle-pipeline.cjs')return {createPipeline:options=>realRequire(name).createPipeline({...options,now:()=>clock,fetchImpl:async()=>{restRequests++;throw Error('offline test');}})};
 if(name==='../lib/futopt-stream-health.cjs')return {createHealth:options=>realRequire(name).createHealth({...options,now:()=>clock})};
 if(name==='../lib/fugle-futopt-websocket')return {
  FUGLE_FUTOPT_WS_CANDLES_FILE:path.join(runtime,'candles.json'),FUGLE_FUTOPT_WS_QUOTES_FILE:path.join(runtime,'quotes.json'),FUGLE_FUTOPT_WS_STATUS_FILE:path.join(runtime,'status/collector.json'),
  normalizeFutureSymbol:value=>String(value||''),normalizeFutoptCandle:()=>null,normalizeFutoptQuote:()=>null,readJson,writeJson
 };
 return realRequire(name);
}
(async()=>{
 vm.runInNewContext(fs.readFileSync(script,'utf8'),{__filename:script,require:localRequire,console,Date:ClockDate,Intl,WebSocket:Socket,AbortController,process:{pid:1,env:{FUMAN_RUNTIME_DIR:runtime},once(){},on(){},exit(){throw Error('unexpected exit');}},setInterval:(fn,ms)=>{const timer={fn,ms,unref(){}};intervals.push(timer);return timer;},clearInterval(){},setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}});
 await new Promise(setImmediate);assert.ok(socket);socket.emit('open');
 assert.equal(sent.filter(r=>r.event==='subscribe').length,0,'no pre-auth subscription');
 socket.emit('message',{event:'authenticated'});await new Promise(setImmediate);
 if(pendingScenario){
  assert.equal(sent.filter(r=>r.event==='subscribe').length,0);
  intervals.find(t=>t.ms===5000).fn();await new Promise(setImmediate);
  assert.equal(catalogueRequests,1,'backoff must not refetch pending catalogue');
  const pending=readJson(path.join(runtime,'status/collector.json'));
  assert.equal(pending.websocketAuthenticated,true);assert.equal(pending.formalReady,false);
  assert.equal(pending.formalReadyReason,'catalogue_waiting_verified_trade_date');
  assert.equal(restRequests,0,'no candle REST before verified catalogue');
  catalogueReady=true;clock+=60001;socket.emit('message',{event:'heartbeat'});
  intervals.find(t=>t.ms===5000).fn();await new Promise(setImmediate);
  assert.equal(socketCount,1,'catalogue recovery must reuse authenticated socket');assert.equal(catalogueRequests,2);
 }
 assert.equal(sent.filter(r=>r.event==='subscribe').length,3);
 for(const channel of ['trades','aggregates','candles'])socket.emit('message',{event:'subscribed',data:{channel,symbol:'TXFJ6'}});
 const data={symbol:'TXFJ6',date:'2026-10-02T09:00:00+08:00',open:20000,high:20002,low:19999,close:20001,volume:10};
 socket.emit('message',{event:'data',channel:'candles',data});
 for(let i=0;i<24;i++){clock+=30000;socket.emit('message',{event:'heartbeat'});intervals.find(t=>t.ms===5000).fn();assert.equal(socket.readyState,1,'quiet market with heartbeats must remain connected');}
 socket.emit('message',{event:'data',channel:'candles',data:{...data,date:'2026-10-02T09:12:00+08:00'}});
 intervals.find(t=>t.ms===30000).fn();
 const saved=readJson(path.join(runtime,'data/mother-pool/futures-1m/2026-10-02/REGULAR/TXFJ6.json'));
 assert.equal(saved.count,2);assert.equal(restRequests,1);
 const status=readJson(path.join(runtime,'status/collector.json'));
 assert.equal(status.transportHealth.subscriptions_ready,true);
 assert.equal(status.txfCandleArchive.rejected,0,'subscription ACK and heartbeat must not become invalid candles');
 clock+=121000;intervals.find(t=>t.ms===5000).fn();assert.equal(socket.readyState,3,'missing transport heartbeat must close');
 console.log('PASS actual collector harness: '+(pendingScenario?'pending catalogue transport, backoff and same-socket recovery; ':'')+'authenticated subscriptions, REST isolation, WS archive, >10 minute retention, heartbeat vs quiet market');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(runtime,{recursive:true,force:true}));
