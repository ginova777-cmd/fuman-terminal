'use strict';
// Offline completion/invalidation scheduler. Frozen input; never fabricates a candle.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {mapNaturalCandle}=require('../../lib/daytrade-fast-candle-row.js');
const {priceOnly}=require('./price-quality.cjs');
const mapSeparated=(r,o)=>mapNaturalCandle(r,o)||priceOnly(r,o);
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
class CandleLifecycle {
 constructor({directory,tradeDate,epoch,maxRows=200000,maxBytes=128*1024*1024}){
  if(/fuman-runtime|fuman-release-owner|prod81/i.test(path.resolve(directory)))throw Error('FORMAL_PATH_FORBIDDEN');
  this.file=path.join(directory,'lifecycle.json');this.limits={maxRows,maxBytes};this.identity={tradeDate,epoch};
  fs.mkdirSync(directory,{recursive:true});this.state={...this.identity,sequence:0,lastClock:0,rows:{},outbox:[]};
  if(fs.existsSync(this.file)){if(fs.statSync(this.file).size>maxBytes)throw Error('STATE_LIMIT');const e=JSON.parse(fs.readFileSync(this.file));if(e.sha256!==sha(e.payload))throw Error('STATE_HASH');this.state=e.payload;if(this.state.tradeDate!==tradeDate||this.state.epoch!==epoch)throw Error('IDENTITY');}
 }
 persist(next,fault){const e=JSON.stringify({payload:next,sha256:sha(next)});if(Buffer.byteLength(e)>this.limits.maxBytes)throw Error('STATE_LIMIT');const tmp=this.file+'.tmp';fs.writeFileSync(tmp,e);const fd=fs.openSync(tmp,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fault==='BEFORE_RENAME')throw Error('CRASH_BEFORE_RENAME');fs.renameSync(tmp,this.file);this.state=next;if(fault==='AFTER_RENAME')throw Error('CRASH_AFTER_RENAME');}
 apply({sequence,rows=[],nowMs,fault}){
  if(!Number.isFinite(nowMs)||nowMs<this.state.lastClock)throw Error('CLOCK_REGRESSION');
  if(sequence!==this.state.sequence+1)throw Error('SEQUENCE');
  const n=structuredClone(this.state),events=[];
  const emit=(key,kind,payload,reason)=>{const e={key,kind,payload,reason,sequence,event_id:sha({epoch:n.epoch,sequence,key,kind,payload,reason})};events.push(e);n.outbox.push(e);};
  for(const raw of rows){
   const r=structuredClone(raw),s=String(r.symbol||r.code||''),t=Date.parse(r.candleTime||r.date||'');
   if(!/^\d{4}$/.test(s)||!Number.isFinite(t)||t%60000||r.tradeDate!==n.tradeDate||new Date(t+28800000).toISOString().slice(0,10)!==n.tradeDate)throw Error('ROW_IDENTITY');
   const key=s+'|'+new Date(t).toISOString(),hash=sha(r),prior=n.rows[key];
   if(prior?.rawHash===hash)continue;
   const due=Math.max(t+60000,Date.parse(r.candleSeenAt));
   const probe=mapSeparated(r,{tradeDate:n.tradeDate,nowMs:Number.isFinite(due)?Math.max(nowMs,due):nowMs,maxSeenAgeMs:Infinity});
   if(!probe){n.rows[key]={raw:r,rawHash:hash,status:'INVALID',publishedHash:null};emit(key,'INVALIDATE',null,'ORIGINAL_QUALITY_VALIDATOR_REJECTED');continue;}
   if(prior?.status==='PUBLISHED'){emit(key,'INVALIDATE',null,'REVISION_PENDING_REVALIDATION');}
   n.rows[key]={raw:r,rawHash:hash,due,status:'PENDING',publishedHash:null};
  }
  if(Object.keys(n.rows).length>this.limits.maxRows)throw Error('ROW_LIMIT');
  for(const [key,x]of Object.entries(n.rows))if(x.status==='PENDING'&&x.due<=nowMs){
   const row=mapSeparated(x.raw,{tradeDate:n.tradeDate,nowMs,maxSeenAgeMs:Infinity});
   if(!row){x.status='INVALID';emit(key,'INVALIDATE',null,'ORIGINAL_QUALITY_VALIDATOR_REJECTED');continue;}
   x.status='PUBLISHED';x.publishedHash=sha(row);emit(key,'UPSERT',row,null);
  }
  n.sequence=sequence;n.lastClock=nowMs;
  if(n.outbox.length>20000)throw Error('OUTBOX_LIMIT_ACK_REQUIRED');this.persist(n,fault);return events;
 }
 ack(ids){const set=new Set(ids);if([...set].some(id=>!this.state.outbox.some(e=>e.event_id===id)))throw Error('ACK_UNKNOWN');const n=structuredClone(this.state);n.outbox=n.outbox.filter(e=>!set.has(e.event_id));this.persist(n);}
}
module.exports={CandleLifecycle,sha};
