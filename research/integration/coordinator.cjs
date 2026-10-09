'use strict';
// Autonomous OFFLINE coordinator. Immutable input intent + one published root.
const {mark}=require('./profile.cjs');
const fs=require('fs'),path=require('path');
const {OfflineStore,hash,bytes}=require('./offline-store.cjs');
const {CandleLifecycle}=require('../phase2/candle-lifecycle.cjs');
const {mapQuotes}=require('../phase2/quote-adapter.cjs');
const {derive}=require('../phase3/candle-derived.cjs');
const {IncrementalDiscovery}=require('../phase3/incremental-discovery.cjs');
const {createOracle}=require('../phase3/original-oracle.cjs');
const volumeDetector=require('../../lib/telegram-detectors/volume-detector.cjs');
const priceDetector=require('../../lib/telegram-detectors/price-detector.cjs');
const indicatorCalculator=require('../../lib/telegram-detectors/level-cross-indicators.cjs');
const {bind}=require('./routing-contract.cjs'),{evaluate}=require('./evaluate-routed.cjs');
const RESOURCES=new Set(['dailyVolumeMap','capitalMap','chipMap','marginChangeMap','stockFutureInitialMap','stockGroupContractMap','preopenReferencePriceMap']);
const DATA_RESOURCES=new Set(['technical','atr','levelInput']);
const {verifyResource}=require('./resource-provenance.cjs');
const digest=x=>hash(bytes(x));
function checkBars(rows,s,date,history=false){
 if(!Array.isArray(rows)||rows.length>(history?5420:271))throw Error('BAR_LIMIT');const seen=new Set();
 for(const b of rows){const ms=Date.parse(b.timestamp);if(b.stock_id!==s||!Number.isFinite(ms)||ms%60000||new Date(ms+28800000).toISOString().slice(0,10)!==b.trade_date||(history?b.trade_date>=date:b.trade_date!==date)||seen.has(ms))throw Error('BAR_IDENTITY');seen.add(ms);}
}
function toBar(r){return {stock_id:r.symbol,trade_date:r.trade_date,timestamp:r.candle_time,open:r.open,high:r.high,low:r.low,close:r.close,volume_raw:r.volume,volume_raw_unit:r.payload.volume_unit.toUpperCase(),complete:true,volume_strategy_usable:r.volume_strategy_usable,price_strategy_usable:true,is_synthetic:r.synthetic,source:r.source,available_at:r.updated_at};}
function derivedRows(item){return item.data.current.filter(b=>b.volume_strategy_usable!==false).map(b=>({symbol:b.stock_id,trade_date:b.trade_date,candle_time:b.timestamp,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume_raw})).reverse();}
class Coordinator{
 constructor(directory){this.directory=path.resolve(directory);this.store=new OfflineStore(this.directory);this.pending=path.join(this.directory,'pending.json');this.baseFile=path.join(this.directory,'baseline.json');}
 initialize({snapshot,items,proof}){
  if(fs.existsSync(this.baseFile)||this.store.root())throw Error('BASELINE_ALREADY_PRESENT');
  if(proof?.mode!=='OFFLINE_FROZEN_INPUT'||proof.sha256!==digest({snapshot,items}))throw Error('BASELINE_PROOF');
  const itemRefs={};for(const [symbol,item] of Object.entries(items))itemRefs[symbol]=this.store.putItem(item);
  return this.initializeReferences({snapshot,itemRefs,proof:{mode:'OFFLINE_FROZEN_REFERENCES',sha256:digest({snapshot,itemRefs})}});
 }
 initializeReferences({snapshot,itemRefs,proof}){
  if(fs.existsSync(this.baseFile)||this.store.root())throw Error('BASELINE_ALREADY_PRESENT');
  if(proof?.mode!=='OFFLINE_FROZEN_REFERENCES'||proof.sha256!==digest({snapshot,itemRefs}))throw Error('BASELINE_PROOF');
  const active=snapshot.activeSymbols.map(x=>x.symbol);if(new Set(active).size!==active.length||active.length>2500)throw Error('UNIVERSE');
  const refs={};for(const s of active){const item=this.store.getItem(itemRefs[s]);if(!item||item.symbol!==s||item.trade_date!==snapshot.tradeDate||item.verified!==true)throw Error('BASELINE_ITEM');checkBars(item.data.current,s,snapshot.tradeDate);checkBars(item.data.history,s,snapshot.tradeDate,true);refs[s]=itemRefs[s];}
  const binding=bind({trade_date:snapshot.tradeDate,epoch:snapshot.epoch,activeSymbols:active,prioritySymbols:[],sourceAnchors:{baseline:{epoch:snapshot.epoch,trade_date:snapshot.tradeDate,sequence:0,commit_hash:proof.sha256}}});
  const d=new IncrementalDiscovery({oracle:createOracle({memoize:true})});d.baseline(snapshot);
  const b={binding,symbols:refs,phase3:this.store.put(d.checkpoint()),baseline_sha256:proof.sha256};const h=this.store.put(b);fs.writeFileSync(this.baseFile,JSON.stringify({hash:h}),{flag:'wx'});return b;
 }
 baseline(){return this.store.get(JSON.parse(fs.readFileSync(this.baseFile)).hash);}
 async run(frame,{fault,recovery,continuous}={}){
  const lock=path.join(this.directory,'coordinator.lock');let fd;
  try{fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,scope:'OFFLINE_ONLY'}));try{return await this.runOwned(frame,{fault,recovery,continuous});}catch(e){if(e.code==='RECOVERY_YIELD')return {status:'RECOVERY_PAUSED',stage:e.stage,published:false};throw e;}}
  finally{if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
 }
 async runOwned(frame,{fault,recovery,continuous}={}){
  const b=this.baseline(),prior=this.store.root();
  if(frame.epoch!==b.binding.payload.epoch||frame.trade_date!==b.binding.payload.trade_date||frame.status!=='OFFLINE_FIXED_SEGMENT')throw Error('SOURCE_IDENTITY_OR_GAP');
  if(!Array.isArray(frame.events)||frame.events.length>5000||bytes(frame).length>4*1024*1024||!Number.isFinite(Date.parse(frame.asOf)))throw Error('INPUT_LIMIT');
  const intentHash=digest(frame);
  if(prior?.sequence===frame.sequence){if(prior.sourceCursor.intent_hash!==intentHash)throw Error('REPLAY_CONFLICT');if(fs.existsSync(this.pending)){if(JSON.parse(fs.readFileSync(this.pending)).hash!==intentHash)throw Error('PENDING_CONFLICT');fs.renameSync(this.pending,path.join(this.directory,'ack-'+frame.sequence+'.json'));}return {status:'REPLAY_DEDUP',root:prior};}
  if(frame.sequence!==(prior?.sequence||0)+1)throw Error('SEQUENCE_GAP');
  if(fs.existsSync(this.pending)){if(JSON.parse(fs.readFileSync(this.pending)).hash!==intentHash)throw Error('PENDING_CONFLICT');}else{this.store.put(frame);const fd=fs.openSync(this.pending,'wx');try{fs.writeFileSync(fd,JSON.stringify({hash:intentHash}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  if(fault==='AFTER_INTENT')throw Error('CRASH_AFTER_INTENT');
  if(!recovery)return this.execute(frame,b,prior,{fault,continuous});
  const {RecoveryCheckpoint}=require('../release/recovery-checkpoint.cjs');
  const sourceVersion=require('../release/algorithm-identity.cjs').algorithmIdentity();
  const cp=new RecoveryCheckpoint(this.store,{intentHash,baseline:digest(b),prior:digest(prior),sourceVersion},recovery);
  try{if(!cp.get('R0'))cp.save('R0',{intentHash,baseline:digest(b),prior:digest(prior),sourceVersion});
   const {project}=require('./history-dependency.cjs');
   const sourceRefs={...b.symbols,...prior?.symbols};
   for(const symbol of Object.keys(sourceRefs).sort())if(!cp.get('R1:'+symbol)){
    const item=this.store.getItem(sourceRefs[symbol],false);
    if(item.historyRef)project(this.store,item.historyRef,symbol,frame.trade_date,item.data.current,frame.asOf,{source_version:item.source_version??null,historyBinding:item.historyBinding??null});
    cp.save('R1:'+symbol,{ref:sourceRefs[symbol],historyRef:item.historyRef??null});
   }
   return await this.execute(frame,b,prior,{fault,checkpoint:cp});
  }finally{cp.close();}
 }
 async recover(options={}){if(!fs.existsSync(this.pending))return {status:'NO_PENDING'};const h=JSON.parse(fs.readFileSync(this.pending)).hash;return this.run(this.store.get(h),options);}
 async execute(frame,b,prior,{fault,checkpoint:cp,continuous}){
  const changedMinutes=[];
  mark('Phase2');const refs={...b.symbols,...(prior?.symbols||{})},meta=prior?.coordinator||{lifecycle:{},due:{},asOf:null,revisionAudits:{}},nextMeta={lifecycle:{...meta.lifecycle},due:{...meta.due},asOf:frame.asOf,revisionAudits:{...meta.revisionAudits}};
  if(meta.asOf&&Date.parse(frame.asOf)<Date.parse(meta.asOf))throw Error('CLOCK_REGRESSION');
  const active=new Set(b.binding.payload.active),changed={},candles=new Set(),resourceEvents=[],rawBySymbol=new Map(),revisions=new Map();
  const savedP2=cp?.get('R2');
  const item=s=>{if(!active.has(s))throw Error('OUTSIDE_UNIVERSE');if(typeof changed[s]==='string')changed[s]=this.store.getItem(changed[s],false);return changed[s]||(changed[s]=this.store.getItem(refs[s],false));};
  const flush=s=>{if(changed[s]&&typeof changed[s]!=='string')changed[s]=this.store.putItem(changed[s]);};
  const earliest=(s,t)=>revisions.set(s,Math.min(revisions.get(s)??Infinity,t));
  if(!savedP2){
  for(const e of frame.events){
   if(!active.has(e.symbol)||e.payload_sha256!==digest(e.payload))throw Error('EVENT_IDENTITY_OR_HASH');
   const x=e.type==='CANDLE'?null:item(e.symbol);
   if(e.type==='CANDLE'){if(!rawBySymbol.has(e.symbol))rawBySymbol.set(e.symbol,[]);rawBySymbol.get(e.symbol).push(e.payload);}
   else if(e.type==='QUOTE'){
    const old=x.rawQuote,raw=e.payload;if(String(raw.symbol||raw.code)!==e.symbol||raw.trade_date!==frame.trade_date)throw Error('QUOTE_IDENTITY');
    const time=Date.parse(raw.lastTradeTime||raw.exchangeTime),oldTime=old?Date.parse(old.lastTradeTime||old.exchangeTime):-Infinity;
    if(!Number.isFinite(time)||time>Date.parse(frame.asOf)||time<oldTime)throw Error('QUOTE_TIME_ORDER');
    if(old?.tradeSerial!=null&&raw.tradeSerial!=null&&BigInt(raw.tradeSerial)<BigInt(old.tradeSerial))throw Error('QUOTE_SERIAL_ORDER');
    const mapped=mapQuotes({rawRows:[raw],previousRows:[{symbol:e.symbol,...x.data.quote}],prioritySymbols:[],nowMs:Date.parse(frame.asOf),cacheUpdatedAt:frame.asOf}).mergedRows.find(r=>r.symbol===e.symbol);
    x.rawQuote=structuredClone(raw);x.data.quote=mapped;resourceEvents.push({resource:'quoteMap',symbol:e.symbol,value:mapped});
   }else if(e.type==='SUPPLEMENTAL'){
    if(!RESOURCES.has(e.resource)||e.trade_date!==frame.trade_date||e.epoch!==frame.epoch)throw Error('SUPPLEMENTAL_IDENTITY');resourceEvents.push({resource:e.resource,symbol:e.symbol,value:e.payload});
   }else if(e.type==='DATA_RESOURCE'){
    if(!DATA_RESOURCES.has(e.resource)||e.trade_date!==frame.trade_date||e.epoch!==frame.epoch)throw Error('DATA_RESOURCE_IDENTITY');x.resourceEvidence={...(x.resourceEvidence||{}),[e.resource]:verifyResource(e,frame)};x.data[e.resource]=structuredClone(e.payload);
   }else if(e.type==='HISTORY_REPLACE'){checkBars(e.payload,e.symbol,frame.trade_date,true);x.data.history=structuredClone(e.payload);candles.add(e.symbol);earliest(e.symbol,-Infinity);}
   else throw Error('EVENT_TYPE');
   flush(e.symbol);
  }
  for(const [s,due]of Object.entries(meta.due))if(due<=Date.parse(frame.asOf)&&!rawBySymbol.has(s))rawBySymbol.set(s,[]);
  for(const [s,raw]of rawBySymbol){
   const x=item(s),dir=path.join(this.directory,'attempts',String(frame.sequence),s);fs.mkdirSync(dir,{recursive:true});
   const lifecycleFile=path.join(dir,'lifecycle.json');
   // Always rebuild the disposable attempt from the last COMMITTED state.
   const previous=meta.lifecycle[s]?this.store.get(meta.lifecycle[s]):{tradeDate:frame.trade_date,epoch:frame.epoch,sequence:0,lastClock:0,rows:{},outbox:[]};
   fs.writeFileSync(lifecycleFile,JSON.stringify({payload:previous,sha256:digest(previous)}));
   const life=new CandleLifecycle({directory:dir,tradeDate:frame.trade_date,epoch:frame.epoch,maxRows:271,maxBytes:8*1024*1024});
   const events=life.apply({sequence:previous.sequence+1,rows:raw,nowMs:Date.parse(frame.asOf)});
   const map=new Map(x.data.current.map(v=>[Date.parse(v.timestamp),v]));
   for(const e of events){if(continuous)changedMinutes.push({symbol:s,key:e.key,kind:e.kind,event_id:e.event_id,payload_sha256:digest(e.payload)});const t=Date.parse(e.key.slice(e.key.indexOf('|')+1));if(map.has(t))earliest(s,t);if(e.kind==='INVALIDATE'){map.delete(t);earliest(s,t);}else map.set(t,toBar(e.payload));candles.add(s);}
   x.data.current=[...map.values()].sort((a,c)=>Date.parse(a.timestamp)-Date.parse(c.timestamp));checkBars(x.data.current,s,frame.trade_date);
   const committedLife=structuredClone(life.state);committedLife.outbox=[];nextMeta.lifecycle[s]=this.store.put(committedLife);
   const due=Object.values(committedLife.rows).filter(r=>r.status==='PENDING').map(r=>r.due);if(due.length)nextMeta.due[s]=Math.min(...due);else delete nextMeta.due[s];
   if(events.length)resourceEvents.push({resource:'intradayMap',symbol:s,value:derive(derivedRows(x),frame.trade_date,frame.asOf)[0]?.[1]||null});flush(s);
  }
  if(cp)cp.save('R2',{changed,nextMeta,candles:[...candles],resourceEvents,revisions:[...revisions].map(([s,t])=>[s,Number.isFinite(t)?t:null])});
  }else{Object.assign(changed,savedP2.changed);Object.assign(nextMeta,savedP2.nextMeta);savedP2.candles.forEach(s=>candles.add(s));resourceEvents.push(...savedP2.resourceEvents);savedP2.revisions.forEach(([s,t])=>revisions.set(s,t===null?-Infinity:t));}
  if(continuous){const done=continuous.phase2({frame,b,prior,changed,nextMeta,candles:[...candles],resourceEvents,revisions:[...revisions].map(([s,t])=>[s,Number.isFinite(t)?t:null]),changedMinutes});if(done){fs.renameSync(this.pending,path.join(this.directory,'ack-'+frame.sequence+'.json'));return done;}}
  if(cp?.phaseLimit==='R2'){const e=Error('RECOVERY_YIELD');e.code='RECOVERY_YIELD';e.stage='R2';throw e;}
  mark('Phase3');if(fault==='AFTER_PHASE2')throw Error('CRASH_AFTER_PHASE2');
  const savedP3=cp?.get('R2:discovery');
  const d=new IncrementalDiscovery({oracle:createOracle({memoize:true})});if(!savedP3)d.restore(this.store.get(prior?.coordinator?.phase3||b.phase3));
  const discovery=savedP3?.discovery||d.process({epoch:frame.epoch,tradeDate:frame.trade_date,sequence:frame.sequence,continuity:'CONTIGUOUS',asOf:frame.asOf,events:resourceEvents});if(discovery.status!=='OFFLINE_EVALUATED')throw Error('DISCOVERY:'+discovery.reason);
  nextMeta.phase3=savedP3?.phase3||this.store.put(d.checkpoint());if(cp&&!savedP3)cp.save('R2:discovery',{discovery,phase3:nextMeta.phase3});
  if(continuous){const done=continuous.phase3({frame,b,prior,changed,nextMeta,discovery});if(done){fs.renameSync(this.pending,path.join(this.directory,'ack-'+frame.sequence+'.json'));return done;}}
  if(cp?.phaseLimit==='R2:discovery'){const e=Error('RECOVERY_YIELD');e.code='RECOVERY_YIELD';e.stage='R2:discovery';throw e;}
  mark('historical_recalculation');
  // Recalculate every affected prefix for audit only; never retroactively notify.
  for(const [s,from]of revisions){
   const savedAudit=cp?.get('R3:'+s);if(savedAudit){nextMeta.revisionAudits[s]=savedAudit.ref;continue;}
   const x=item(s),history=x.historyRef&&!x.data.history?this.store.get(x.historyRef):x.data.history;
   const args={stock_id:s,trade_date:frame.trade_date,current:x.data.current,history,as_of:frame.asOf};
   // These original formulas are causal: a row reads only its minute, earlier
   // current rows and fixed historical rows. Keep the full recursive indicator
   // recomputation; RSI/KD/MACD cannot be truncated at a rolling-20 boundary.
   const ordered=x.data.current.every((b,i)=>i===0||Date.parse(b.timestamp)>Date.parse(x.data.current[i-1].timestamp));
   const volumeRows=ordered?volumeDetector.detect(args).rows:null,priceRows=ordered?priceDetector.detect({...args,previous_close:x.data.quote?.prevClose||null}).rows:null;
   const audit=[];for(let i=0;i<x.data.current.length;i++){
    const bar=x.data.current[i];if(Date.parse(bar.timestamp)<from)continue;
    audit.push({timestamp:bar.timestamp,target_bar_end_at:new Date(Date.parse(bar.timestamp)+60000).toISOString(),known_at:frame.asOf,rows:{volume:ordered?volumeRows[i]:volumeDetector.detect({...args,current:x.data.current.slice(0,i+1)}).rows.at(-1),price:ordered?priceRows[i]:priceDetector.detect({...args,current:x.data.current.slice(0,i+1),previous_close:x.data.quote?.prevClose||null}).rows.at(-1)}});
   }
   nextMeta.revisionAudits[s]=this.store.put({scope:'CORRECTED_HISTORY_NOT_ORIGINAL_VISIBILITY',from:Number.isFinite(from)?new Date(from).toISOString():'ALL',audit,technical_recalculation:indicatorCalculator.calculate({bars:x.data.current,stock_id:s,trade_date:frame.trade_date,as_of:frame.asOf}),notifications_sent:0});flush(s);if(cp)cp.save('R3:'+s,{ref:nextMeta.revisionAudits[s]});
  }
  mark('Phase4');if(fault==='AFTER_PHASE3')throw Error('CRASH_AFTER_PHASE3');
  const result=await evaluate({store:this.store,binding:b.binding,input:{discovery,changedSymbols:Object.keys(changed),candleSymbols:[...candles],revisedSymbols:[...revisions.keys()],asOf:frame.asOf,plan:frame.plan||null},changes:changed,gate:frame.gate,backfill:async s=>this.store.getItem(refs[s]),sequence:frame.sequence,sourceCursor:{status:'OFFLINE_FIXED_SEGMENT',epoch:frame.epoch,intent_hash:digest(frame),sequence:frame.sequence},coordinator:nextMeta,fault,checkpoint:cp});
  mark('committed');fs.renameSync(this.pending,path.join(this.directory,'ack-'+frame.sequence+'.json'));return result;
 }
}
module.exports={Coordinator,digest,checkBars};
