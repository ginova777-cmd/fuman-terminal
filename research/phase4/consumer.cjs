'use strict';
// Isolated transaction simulator. This file has no production/network/notification ports.
const fs=require('node:fs'),path=require('node:path');
const {sha,strategy3,telegram,deepAnalysis}=require('./original-adapters.cjs');
const clone=x=>structuredClone(x);
function seal(x){return {payload:x,sha256:sha(JSON.stringify(x))};}
function open(x){if(!x||sha(JSON.stringify(x.payload))!==x.sha256)throw Error('STATE_HASH_MISMATCH');return x.payload;}
class Consumer {
  constructor({directory,tradeDate,identity,epoch,limits={}}){
    this.directory=path.resolve(directory);
    if (/fuman-runtime|fuman-release-owner|prod81/i.test(this.directory)) throw Error('FORMAL_PATH_FORBIDDEN');
    this.limits={symbols:2500,bars:271,history:5420,totalRows:200000,events:5000,frameBytes:4*1024*1024,stateBytes:64*1024*1024,outbox:20000,...limits};
    fs.mkdirSync(this.directory,{recursive:true});this.file=path.join(this.directory,'offline-state.json');
    if(fs.existsSync(this.file)&&fs.statSync(this.file).size>this.limits.stateBytes)throw Error('STATE_CAPACITY');
    this.state=fs.existsSync(this.file)?open(JSON.parse(fs.readFileSync(this.file,'utf8'))):{contract:'phase4_offline_consumer_v1',trade_date:tradeDate,identity,epoch,seq:0,frames:{},symbols:{},strategy:{},telegram:{},pending:[],outbox:[],next_order:1};
    if(this.state.trade_date!==tradeDate||this.state.identity!==identity||this.state.epoch!==epoch)throw Error('IDENTITY_RECOVERY_REQUIRED');
    this.stopped=false;
  }
  save(next,fault){
    const bytes=Buffer.from(JSON.stringify(seal(next)));
    if(bytes.length>this.limits.stateBytes)throw Error('STATE_CAPACITY');
    const tmp=this.file+'.tmp';const fd=fs.openSync(tmp,'w');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(fault==='BEFORE_RENAME')throw Error('INJECTED_CRASH_BEFORE_RENAME');
    fs.renameSync(tmp,this.file);this.state=next;
    if(fault==='AFTER_RENAME')throw Error('INJECTED_CRASH_AFTER_RENAME');
    return bytes.length;
  }
  stop(){this.stopped=true;}
  acquire(){
    const lock=path.join(this.directory,'offline-owner.lock');
    let fd;try{fd=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')throw Error('CONSUMER_OWNER_BUSY_OR_CRASHED');throw e;}
    try{
      fs.writeFileSync(fd,JSON.stringify({pid:process.pid,created_at:new Date().toISOString(),scope:'OFFLINE_ONLY'}));
      if(fs.existsSync(this.file)){
        if(fs.statSync(this.file).size>this.limits.stateBytes)throw Error('STATE_CAPACITY');
        const latest=open(JSON.parse(fs.readFileSync(this.file,'utf8')));
        if(latest.identity!==this.state.identity||latest.epoch!==this.state.epoch||latest.trade_date!==this.state.trade_date)throw Error('IDENTITY_RECOVERY_REQUIRED');
        this.state=latest;
      }
      return ()=>{fs.closeSync(fd);fs.unlinkSync(lock);};
    }catch(e){fs.closeSync(fd);fs.unlinkSync(lock);throw e;}
  }
  async process(frame,options={}){
    const release=this.acquire();try{return await this.processOwned(frame,options);}finally{release();}
  }
  async processOwned(frame,{backfill,gate,fault}={}){
    if(this.stopped)throw Error('STOPPED');
    const old=this.state;
    if(frame.epoch!==old.epoch||frame.trade_date!==old.trade_date||frame.identity!==old.identity)throw Error('IDENTITY_RECOVERY_REQUIRED');
    if(frame.status!=='DURABLE_COMMITTED')throw Error('GAP_FULL_RECOVERY_REQUIRED');
    if(!Number.isSafeInteger(frame.sequence)||frame.sequence<1||!Array.isArray(frame.events))throw Error('FRAME_SCHEMA');
    const rawFrame=JSON.stringify({...frame,payload_sha256:undefined});
    if(Buffer.byteLength(rawFrame)>this.limits.frameBytes)throw Error('FRAME_BYTES_CAPACITY');
    const hash=sha(rawFrame);
    if(frame.payload_sha256!==hash)throw Error('FRAME_HASH_MISMATCH');
    if(frame.sequence<=old.seq){if(old.frames[frame.sequence]===hash)return {status:'REPLAY_DEDUP',sequence:old.seq};throw Error('REPLAY_CONFLICT_OR_OUTSIDE_RETENTION');}
    if(frame.sequence!==old.seq+1)throw Error('SEQUENCE_GAP_FULL_RECOVERY_REQUIRED');
    if(frame.events.length>this.limits.events)throw Error('FRAME_CAPACITY');
    // No formal gate is implemented here. Require an explicitly isolated, same-as-of
    // upstream verdict instead of accepting a stale true flag as a production gate.
    if(gate?.mode!=='OFFLINE_FIXTURE'||gate.as_of!==frame.as_of||gate.trade_date!==frame.trade_date)throw Error('OFFLINE_GATE_CONTEXT_REQUIRED');
    const next=clone(old), touched=new Set(), discovery=new Set();
    for(const e of frame.events){
      const s=e.symbol;if(typeof s!=='string'||!/^\d{4}$/.test(s))throw Error('SYMBOL_SCHEMA');
      if(e.kind==='EXIT'){delete next.symbols[s];delete next.strategy[s];delete next.telegram[s];continue;}
      if(!next.symbols[s]){
        if(e.kind!=='ADMIT')throw Error('ADMISSION_BACKFILL_REQUIRED');
        if(typeof backfill!=='function')throw Error('BACKFILL_READER_REQUIRED');
        const b=await backfill(s,frame);
        if(!b||b.symbol!==s||b.trade_date!==next.trade_date||b.identity!==next.identity||b.complete!==true)throw Error('BACKFILL_UNVERIFIED');
        if(!Array.isArray(b.data?.current)||!Array.isArray(b.data?.history)||b.data.current.length>this.limits.bars||b.data.history.length>this.limits.history)throw Error('BAR_CAPACITY');
        const totalRows=Object.values(next.symbols).reduce((n,x)=>n+x.current.length+x.history.length,0)+b.data.current.length+b.data.history.length;
        if(totalRows>this.limits.totalRows)throw Error('TOTAL_ROWS_CAPACITY');
        next.symbols[s]=clone(b.data);touched.add(s);discovery.add(s);
      }
      const item=next.symbols[s];
      if(e.kind==='ADMIT')continue;
      if(e.kind==='QUOTE'){item.quote=clone(e.payload);touched.add(s);continue;}
      if(e.kind==='TECHNICAL'){item.technical=clone(e.payload);touched.add(s);continue;}
      if(e.kind==='ATR'){item.atr=clone(e.payload);touched.add(s);continue;}
      if(e.kind==='TRANSPORT')continue;
      if(e.kind!=='CANDLE')throw Error('EVENT_KIND_UNKNOWN');
      const b=e.payload,t=Date.parse(b?.timestamp);
      if(b?.stock_id!==s||b?.trade_date!==next.trade_date||!Number.isFinite(t)||t%60000||new Date(t+28800000).toISOString().slice(0,10)!==next.trade_date)throw Error('CANDLE_IDENTITY');
      if(b.complete!==true||t+60000>Date.parse(frame.as_of))throw Error('UNCOMPLETED_CANDLE');
      const i=item.current.findIndex(x=>x.timestamp===b.timestamp);
      if(i>=0&&JSON.stringify(item.current[i])===JSON.stringify(b))continue;
      if(i>=0)item.current[i]=clone(b);else item.current.push(clone(b));
      item.current.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
      touched.add(s);discovery.add(s);
    }
    if(Object.keys(next.symbols).length>this.limits.symbols)throw Error('SYMBOL_CAPACITY');
    for(const [s,b]of Object.entries(next.symbols)){
      if(!Array.isArray(b.current)||!Array.isArray(b.history)||b.current.length>this.limits.bars||b.history.length>this.limits.history)throw Error('BAR_CAPACITY');
      const seen=new Set();let previous=-Infinity;
      for(const row of b.current){const ms=Date.parse(row.timestamp);if(row.stock_id!==s||row.trade_date!==next.trade_date||!Number.isFinite(ms)||ms%60000||new Date(ms+28800000).toISOString().slice(0,10)!==next.trade_date||seen.has(ms)||ms<previous)throw Error('BACKFILL_CONFLICT');seen.add(ms);previous=ms;}
    }
    if(fault==='BEFORE_EVALUATE')throw Error('INJECTED_CONSUMER_FAILURE');
    const s3=await strategy3(next,[...touched],gate);
    for(const s of touched)delete next.strategy[s];for(const r of s3.results)next.strategy[r.symbol]=r;
    // Ranking is cross-symbol: re-rank all surviving results without rescanning their K.
    Object.values(next.strategy).sort((a,b)=>b.score-a.score||b.change_percent-a.change_percent||b.tail_volume_share_pct-a.tail_volume_share_pct).forEach((r,i)=>r.rank=i+1);
    const tg=telegram(next,[...discovery],frame.as_of);
    for(const s of discovery)next.telegram[s]=tg.filter(r=>r.symbol===s);
    const rawEvents=tg.filter(r=>r.hit).map(r=>({...r.row,event_type:r.kind==='volume'?'VOLUME_ANOMALY_EVENT':'PRICE_UP_ANOMALY_EVENT',source_event_at:r.row.timestamp}));
    const contexts=Object.fromEntries(Object.entries(next.symbols).map(([s,b])=>[s,{bars:b.current,levelInput:b.levelInput}]));
    const deep=deepAnalysis({events:rawEvents,previous:next.pending,contexts,now:frame.as_of,tradeDate:next.trade_date,plan:frame.plan ?? null});
    next.pending=deep.state;
    const changes=[];for(const r of deep.events.filter(r=>r.gate.eligible)){
      const key=[next.trade_date,r.stock_id,r.event_type,r.timestamp].join('|');
      const value_hash=sha(JSON.stringify(r)),prior=next.outbox.find(x=>x.key===key);
      if(prior){if(prior.value_hash!==value_hash)changes.push({key,status:'REVISION_AFTER_EVENT',previous_hash:prior.value_hash,new_hash:value_hash});continue;}
      next.outbox.push({key,value_hash,payload:r,order:next.next_order++,status:'DRY_RUN_PENDING',delivery_authorized:false});
    }
    if(next.outbox.length>this.limits.outbox)throw Error('OUTBOX_CAPACITY');
    next.seq=frame.sequence;next.frames[frame.sequence]=hash;
    for(const n of Object.keys(next.frames))if(Number(n)<next.seq-63)delete next.frames[n];
    const bytes=this.save(next,fault);
    return {status:'OFFLINE_COMMITTED',sequence:next.seq,touched:[...touched],discovery:[...discovery],changes,state_bytes:bytes,formula_proof:s3.proof,deep_analysis:deep.events.map(e=>({symbol:e.stock_id,gate:e.gate})),notifications_sent:0};
  }
  // Simulates transactional receiver acknowledgement; never invokes Telegram.
  acknowledge(order,{fault}={}){const release=this.acquire();try{const n=clone(this.state),r=n.outbox.find(x=>x.order===order);if(!r)throw Error('OUTBOX_UNKNOWN');if(n.outbox.some(x=>x.order<order&&x.status!=='DRY_RUN_ACKED'))throw Error('OUTBOX_ORDER');r.status='DRY_RUN_ACKED';return this.save(n,fault);}finally{release();}}
}
function frame(x){const y={...x};y.payload_sha256=sha(JSON.stringify(y));return y;}
module.exports={Consumer,frame,seal,open};
