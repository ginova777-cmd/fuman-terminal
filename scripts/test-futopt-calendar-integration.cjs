'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createResolver,INDEX,ANNOUNCEMENTS,parseAnnouncements,sha}=require('../lib/taifex-regular-calendar.cjs');
const policy=require('../data/contracts/taifex-regular-calendar-2026.json');
const evidenceRoot=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('ISOLATED_EVIDENCE_DIRECTORY_REQUIRED');
const pdf=fs.readFileSync(path.join(evidenceRoot,'2026Calendar.pdf'));
const notices=fs.readFileSync(path.join(evidenceRoot,'announcement.html'));
const index=fs.readFileSync(path.join(evidenceRoot,'calendar-index.html'));
const html='證券代號 股票期貨<tr>'+['CA','南亞公司','1303','南亞','●','','','◎','','','','2000','',''].map(x=>'<td>'+x+'</td>').join('')+'</tr>';
const response=(body,url,status=200)=>new Response(body,{status,headers:{'Content-Type':'text/plain'}});
const cases=[];
async function test(name,fn){await fn();cases.push(name);console.log('PASS '+name);}

async function collector(scenario,date='2026-10-12'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'futopt-calendar-e2e-'));
 fs.mkdirSync(path.join(root,'secrets'),{recursive:true});fs.writeFileSync(path.join(root,'secrets/fugle-api-key.txt'),'isolated-key');
 let clock=Date.parse(date+'T01:00:00Z'),quiescing=false,ack=true,noticeBytes=notices;
 const intervals=[],timeouts=[],sockets=[],calls=[],errors=[],writes=[];
 const modules=new Map(),sourceRoot=path.resolve(__dirname,'..');
 class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 class Socket {
  static OPEN=1;
  constructor(){this.readyState=1;this.listeners={};this.sent=[];sockets.push(this);}
  addEventListener(name,fn){this.listeners[name]=fn;}
  emit(name,data){this.listeners[name]?.(name==='message'?{data:JSON.stringify(data)}:{});}
  send(text){const m=JSON.parse(text);this.sent.push(m);if(m.event==='auth')this.emit('message',{event:'authenticated'});
   if(m.event==='subscribe'&&ack)this.emit('message',{event:'subscribed',data:m.data.symbols.map(symbol=>({symbol,channel:m.data.channel}))});}
  close(){this.readyState=3;this.emit('close');}
 }
 const fetchMock=async url=>{
  calls.push(url);
  if(url===INDEX)return response(index,url);
  if(url===policy.source_url)return response(pdf,url);
  if(url===ANNOUNCEMENTS)return response(noticeBytes,url);
  if(url.includes('/intraday/tickers?'))return response(JSON.stringify({date:scenario==='stale'?'2026-10-08':scenario==='future'?'2026-10-13':date,type:'FUTURE',exchange:'TAIFEX',session:'REGULAR',data:[
   {symbol:scenario==='mapping'?'ZZFJ6':'CAFJ6',name:'南亞期貨106',contractType:'S',startDate:'2026-01-01',endDate:'2026-10-21',settlementDate:'2026-10-21'},
   {symbol:'TXFJ6',contractType:'I',startDate:'2026-01-01',endDate:'2026-10-21'},
  ]}),url);
  if(url==='https://www.taifex.com.tw/cht/2/stockLists')return response(html,url);
  if(url.includes('/intraday/products?'))return response(JSON.stringify({type:'FUTURE',exchange:'TAIFEX',session:'REGULAR',contractType:'S',data:[{
   symbol:'CAF',underlyingSymbol:'1303',type:'FUTURE',contractType:'S',underlyingType:'S',expiryType:'S',contractSize:2000,name:'南亞期貨',statusCode:'N',quoteAcceptable:true,startDate:'2026-01-01',
  }]}),url);
  if(url.includes('/intraday/candles/'))return response('{}',url,503);
  throw Error('UNEXPECTED_NETWORK:'+url);
 };
 const guardedFs=new Proxy(fs,{get(target,key){const fn=target[key];if(['writeFileSync','mkdirSync','renameSync','unlinkSync','rmSync','openSync'].includes(key))return (...args)=>{
   const paths=key==='renameSync'?args.slice(0,2):[args[0]];
   for(const p of paths)if(typeof p==='string'&&!path.resolve(p).startsWith(root+path.sep)&&path.resolve(p)!==root)throw Error('OUTSIDE_LAB_WRITE:'+p);
   writes.push(String(args[0]));return fn(...args);
  };return fn;}});
 const context=vm.createContext({Buffer,URL,Response,AbortSignal,TextDecoder,Date:Clock,Intl,JSON,Map,Set,Promise,performance,
  console:{log(){},error:(...x)=>errors.push(x.join(' '))},fetch:fetchMock,WebSocket:Socket,
  process:{env:{FUMAN_RUNTIME_DIR:root,FUMAN_CACHE_DIR:path.join(root,'cache'),FUMAN_STATE_DIR:path.join(root,'state')},pid:999,platform:'win32',execPath:process.execPath,on(){},exit(code){throw Error('TEST_EXIT:'+code);}},
  setInterval:(fn,ms)=>{const t={fn,ms,active:true,unref(){}};intervals.push(t);return t;},clearInterval:t=>{if(t)t.active=false;},
  setTimeout:(fn,ms)=>{const t={fn,ms,active:true};timeouts.push(t);return t;},clearTimeout:t=>{if(t)t.active=false;},
 });
 function load(file){
  if(modules.has(file))return modules.get(file).exports;
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
  const module={exports:{}};modules.set(file,module);
  function req(name){
   if(name==='fs'||name==='node:fs')return guardedFs;
   if(name.includes('server-supabase-key'))return {serverSupabaseKey:()=>'',serverSupabaseUrl:()=>''};
   if(name.includes('futopt-graceful-shutdown'))return {hash:sha,createControl:()=>({start(){},get quiescing(){return quiescing;}})};
   if(name.startsWith('.')){let f=path.resolve(path.dirname(file),name);if(!path.extname(f))f+='.js';return load(f);}
   if(['path','node:path','crypto','node:crypto','os','node:os'].includes(name))return require(name);
   throw Error('UNEXPECTED_IMPORT:'+name);
  }
  vm.runInContext('(function(require,module,exports,__filename,__dirname){'+fs.readFileSync(file,'utf8')+'\n})',context,{filename:file})(req,module,module.exports,file,path.dirname(file));
  return module.exports;
 }
 const pump=async()=>{for(let i=0;i<100;i++){await new Promise(r=>setImmediate(r));for(const t of timeouts.filter(t=>t.active&&t.ms<=200)){t.active=false;t.fn();}}};
 const status=()=>JSON.parse(fs.readFileSync(path.join(root,'state/fugle-futopt-websocket-status.json'),'utf8'));
 const tick=async()=>{for(const t of intervals.filter(t=>t.active&&t.ms===5000))t.fn();await pump();};
 try {
  ack=scenario!=='ack_failure';load(path.join(sourceRoot,'scripts/fugle-futopt-websocket-collector.js'));await pump();
  assert.equal(sockets.length,1,JSON.stringify(errors));const ws=sockets[0];ws.emit('open');await pump();
  const quote={event:'data',channel:'trades',data:{symbol:'TXFJ6',price:23000,size:1,serial:1,time:clock*1000}};
  ws.emit('message',quote);await tick();
  if(scenario==='closed'){
   assert.equal(status().formalReady,false);assert.equal(status().formalReadyReason,'taifex_regular_market_closed');
   assert.equal(status().selectedSymbols,0);assert.equal(status().transportHealth.subscriptions_ready,false);
   assert(!calls.some(x=>x.includes('api.fugle.tw')));
  }else if(['stale','future','mapping'].includes(scenario)){
   assert.equal(status().formalReady,false);assert.equal(status().selectedSymbols,0);assert(!ws.sent.some(m=>m.event==='subscribe'));
   assert(status().catalogueRetry.error.includes(scenario==='mapping'?'MAPPING':'PROVIDER_DATE'));
  }else{
   assert(ws.sent.some(m=>m.event==='subscribe'));assert.equal(status().formalReady,scenario!=='ack_failure',JSON.stringify(status()));
   if(scenario==='rollover'){
    clock=Date.parse('2026-10-13T00:00:00Z');ws.emit('message',quote);await tick();
    assert.equal(status().formalReady,false);assert.equal(status().selectedSymbols,0);assert.equal(ws.readyState,3);
   }
   if(scenario==='emergency'){
    const notice='<tr><td>2026/10/12</td><td><a href="newsDetail?newsType=1&idx=99999">因颱風，115年10月12日集中交易市場休市1日(包含一般交易時段及盤後交易時段)</a></td></tr>';
    noticeBytes=Buffer.from(notices.toString().replace('</thead>','</thead>'+notice));clock+=61000;await tick();
    assert.equal(status().formalReady,false);assert.equal(status().formalReadyReason,'taifex_regular_market_closed');assert.equal(ws.readyState,3);
   }
  }
  assert.equal(errors.length,0,errors.join('\n'));
  return {scenario,status:status().formalReadyReason,http_calls:calls.length,lab_writes:writes.length,real_network:false};
 }finally{quiescing=true;fs.rmSync(root,{recursive:true,force:true});}
}

(async()=>{
 assert.equal(sha(pdf),policy.source_sha256);
 await test('resolver_official_bytes_cache_expiry_backoff',async()=>{
  let clock=Date.parse('2026-10-11T02:00:00Z'),calls=0,fail=false;
  const saved=[];
  const resolver=createResolver({now:()=>clock,saveEvidence:(hash,evidence,raw)=>{
   assert.equal(sha(JSON.stringify(evidence)),hash);raw.forEach((b,i)=>assert.equal(sha(b),evidence.hashes[i]));saved.push(evidence);
  },fetchImpl:async url=>{calls++;if(fail)throw Error('OFFLINE_FAILURE');return response(url===INDEX?index:url===ANNOUNCEMENTS?notices:pdf,url);}});
  const input=()=>({date:'2026-10-11',asOf:new Date(clock).toISOString(),exchange:'TAIFEX',session:'REGULAR'});
  assert.equal((await resolver(input())).state,'CLOSED');assert.equal(calls,3);
  await resolver(input());assert.equal(calls,3);clock+=60000;fail=true;
  await assert.rejects(resolver(input()),/OFFLINE_FAILURE/);assert.equal(calls,4);
  await assert.rejects(resolver(input()),/BACKOFF/);assert.equal(calls,4);assert.equal(saved.length,1);
 });
 for(const fault of ['pdf_hash','index_version','empty_notice','new_ambiguous_notice','wrong_source','oversize','save_failure','year_boundary'])await test('resolver_'+fault,async()=>{
  const date=fault==='year_boundary'?'2027-01-01':'2026-10-11';let calls=0;
  const resolver=createResolver({now:()=>Date.parse(date+'T02:00:00Z'),saveEvidence:()=>{if(fault==='save_failure')throw Error('SAVE_FAILED');},fetchImpl:async url=>{
   calls++;let bytes=url===INDEX?index:url===ANNOUNCEMENTS?notices:pdf;
   if(fault==='pdf_hash'&&url===policy.source_url)bytes=Buffer.from('wrong');
   if(fault==='index_version'&&url===INDEX)bytes=Buffer.from('new version');
   if(fault==='empty_notice'&&url===ANNOUNCEMENTS)bytes=Buffer.from('<html>empty</html>');
   if(fault==='new_ambiguous_notice'&&url===ANNOUNCEMENTS)bytes=Buffer.from(notices.toString().replace('</thead>','</thead><tr><td>2026/10/11</td><td><a href="newsDetail?newsType=1&idx=77777">颱風影響開休市將另行公告</a></td></tr>'));
   if(fault==='oversize')bytes=Buffer.alloc(3*1024*1024);
   const r=response(bytes,url);if(fault==='wrong_source')Object.defineProperty(r,'url',{value:'https://example.com/'});return r;
  }});
  await assert.rejects(resolver({date,asOf:date+'T02:00:00Z',exchange:'TAIFEX',session:'REGULAR'}));
  assert(calls<=3);
 });
 await test('official_saved_announcement_schema',()=>assert.equal(parseAnnouncements(notices.toString()).length,245));
 for(const scenario of ['closed','open','stale','future','mapping','ack_failure','rollover','emergency'])await test('collector_'+scenario,async()=>{
  const r=await collector(scenario,scenario==='closed'?'2026-10-11':'2026-10-12');console.log(JSON.stringify(r));
 });
 console.log(JSON.stringify({status:'COLLECTOR_CALENDAR_ISOLATED_E2E_PASS',cases,formal_execution:false,
  boundaries:'VM fake clock/timers, HTTP and WS; OS shutdown controller and DB credential source stubbed. Candidate Collector/resolver/catalogue/mapping/ACK/cache logic executed unchanged.'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
