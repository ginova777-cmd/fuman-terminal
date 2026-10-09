'use strict';
// OFFLINE ONLY. No environment, runtime path, DB, HTTP, or production entrypoint.
const fs=require('node:fs'),path=require('node:path');
const evidence=require('../../lib/mother-change-evidence.cjs');
const {audit}=require('../../lib/mother-evidence-parent-audit.cjs');
const {mapNaturalCandle}=require('../../lib/daytrade-fast-candle-row.js');
const {latestFirst}=require('../../lib/daytrade-candle-write-order.js');
const delta=require('../../lib/daytrade-candle-delta.js');
const CONTRACT='offline-writer-incremental-v1';
function fail(reason){throw Error(reason);}
function boundedRead(file,max=8*1048576){if(fs.statSync(file).size>max)fail('READER_FILE_LIMIT');return JSON.parse(fs.readFileSync(file,'utf8'));}
function snapshotManifest(dir){const names=fs.readdirSync(dir).sort();if(names.length>10000)fail('READER_FILE_COUNT_LIMIT');let bytes=0;const entries=[];for(const n of names){if(n==='owner.lock')continue;const p=path.join(dir,n),s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())fail('READER_UNSUPPORTED_ENTRY');bytes+=s.size;if(bytes>64*1048576||s.size>8*1048576)fail('READER_SEGMENT_LIMIT');entries.push([n,s.size,evidence.sha(fs.readFileSync(p))]);}return {entries,hash:evidence.sha(entries),bytes};}
function readCommittedSegment({dir,kind,epoch,tradeDate,checkpoint=null,continuityProof,maxEvents=20000}){
  // C2 itself says continuous=false. An audited retained segment is NOT enough.
  if(!continuityProof||continuityProof.status!=='OFFLINE_FIXED_SEGMENT'||continuityProof.epoch!==epoch)fail('CONTINUITY_UNKNOWN_FULL_RECOVERY_REQUIRED');
  const before=snapshotManifest(dir);if(continuityProof.manifest_hash!==before.hash)fail('SEGMENT_MANIFEST_MISMATCH');
  if(checkpoint&&(checkpoint.epoch!==epoch||checkpoint.trade_date!==tradeDate||checkpoint.kind!==kind))fail('CHECKPOINT_IDENTITY_CHANGED');
  const files=before.entries.map(x=>x[0]);let end=0,last=null,events=[],positions=new Map();
  if(kind==='candle')audit(dir);else if(kind==='quote')require('../../lib/mother-change-evidence-audit.cjs').audit(dir);else fail('KIND_INVALID');
  for(const n of files.filter(n=>/^\d{12}\.prepare\.json$/.test(n))){
    const b=boundedRead(path.join(dir,n)),stem=n.split('.')[0],s=boundedRead(path.join(dir,stem+'.saved.json')),c=boundedRead(path.join(dir,stem+'.commit.json'));
    if(b.sequence!==end+1)fail('SEQUENCE_GAP');end=b.sequence;
    if(kind==='quote'){evidence.validateBatch(b);evidence.validateSaved(b,s);if(b.kind!=='quote'||b.collector_epoch!==epoch||c.status!=='DURABLE_COMMITTED'||c.contract!==b.contract||c.sequence!==end||c.batch_id!==b.batch_id||c.batch_hash!==b.batch_hash||c.saved_hash!==evidence.sha(s))fail('QUOTE_COMMIT_INVALID');}
    else if(b.epoch!==epoch||b.contract!=='mother-change-evidence-v3-c2-capacity')fail('CANDLE_EPOCH_OR_CONTRACT');
    last=kind==='quote'?evidence.sha(c):c.hash;positions.set(end,last);
    for(const e of b.events){if(e.trade_date!==tradeDate||evidence.keyOf(e.payload,kind).key!==e.key)fail('EVENT_IDENTITY_INVALID');if(end>(checkpoint?.sequence||0)){events.push({...e,sequence:end});if(events.length>maxEvents)fail('READER_EVENT_LIMIT');}}
  }
  if(checkpoint&&(checkpoint.sequence>end||checkpoint.sequence>0&&positions.get(checkpoint.sequence)!==checkpoint.commit_hash))fail('CHECKPOINT_ANCHOR_MISMATCH');
  if(snapshotManifest(dir).hash!==before.hash)fail('SEGMENT_CHANGED_DURING_READ');
  const seen=new Map(),finals=new Map();for(const e of events){if(seen.has(e.event_id)&&seen.get(e.event_id)!==evidence.sha(e))fail('EVENT_ID_REPLAY_CONFLICT');seen.set(e.event_id,evidence.sha(e));finals.set(e.key,e.final_payload||e.payload);}
  return {contract:CONTRACT,mode:'DELTA',kind,epoch,trade_date:tradeDate,events,rows:[...finals.values()],changedSymbols:[...new Set(events.map(e=>e.symbol))].sort(),changedCandleKeys:kind==='candle'?[...finals.keys()].sort():[],next:{kind,epoch,trade_date:tradeDate,sequence:end,commit_hash:last},segment_hash:before.hash,logical_read_bytes:before.bytes*2,continuity_scope:'OFFLINE_FIXED_SEGMENT_ONLY'};
}
function safeRead(options,fullSnapshot){if(options.stop===true)return {mode:'BLOCKED',reason:'OPERATOR_STOP'};try{return readCommittedSegment(options);}catch(e){if(typeof fullSnapshot!=='function')return {mode:'BLOCKED',reason:e.message};try{const snap=fullSnapshot();if(!snap||snap.complete!==true||snap.kind!==options.kind||snap.trade_date!==options.tradeDate||!Array.isArray(snap.rows)||snap.rows.length>250000||snap.sha256!==evidence.sha(snap.rows))return {mode:'BLOCKED',reason:e.message,fallback_error:'FULL_SNAPSHOT_UNVERIFIED'};const keys=new Set();for(const r of snap.rows){const id=evidence.keyOf(r,options.kind);if(id.trade_date!==options.tradeDate||keys.has(id.key))return {mode:'BLOCKED',reason:e.message,fallback_error:'FULL_SNAPSHOT_IDENTITY'};keys.add(id.key);}return {mode:'FULL_FALLBACK',reason:e.message,rows:snap.rows,kind:options.kind,changedSymbols:[...new Set(snap.rows.map(r=>evidence.keyOf(r,options.kind).symbol))].sort(),changedCandleKeys:options.kind==='candle'?[...keys].sort():[],next:null,continuity_reestablished:false};}catch(f){return {mode:'BLOCKED',reason:e.message,fallback_error:f.message};}}}
function writerRows(raw,{tradeDate,nowMs,cacheUpdatedAt,allowedSymbols}){const result=[];for(const c of raw){if(allowedSymbols&&!allowedSymbols.has(String(c.symbol||c.code)))continue;const row=mapNaturalCandle(c,{tradeDate,nowMs,maxSeenAgeMs:Infinity});if(row)result.push({...row,source:'fugle_daytrade_writer:websocket_candles',source_channel:'candles',candle_origin:'websocket_candle',websocket_row:true,rest_repair_row:false,intraday_odd_lot:false,payload:{...row.payload,cacheUpdatedAt,source:'fugle-websocket-candles-cache'}});}return latestFirst(result);}
function loadCheckpoint(file){if(!fs.existsSync(file))return null;const x=boundedRead(file);if(x.contract!==CONTRACT||evidence.sha(x.value)!==x.sha256)fail('CHECKPOINT_CORRUPT');return x.value;}
async function publishOffline({plan,file,options,write,fault=()=>{}}){if(!['DELTA','FULL_FALLBACK'].includes(plan.mode))fail('PLAN_BLOCKED');if(plan.kind!=='candle')fail('QUOTE_PUBLICATION_NOT_IMPLEMENTED');const prior=loadCheckpoint(file);if(plan.mode==='DELTA'&&prior?.feed&&prior.feed.sequence>(plan.next?.sequence||0))fail('CHECKPOINT_REGRESSION');const rows=writerRows(plan.rows,options);
 // Do not consume a forming candle or invalidating revision and lose it forever.
 // A mature-bar scheduler and explicit invalidation sink need separate integration.
 if(rows.length!==plan.rows.length)fail('UNMAPPED_ROW_REQUIRES_DEFER_OR_INVALIDATION');
 const selected=delta.selectDelta(rows,prior?.delta,{tradeDate:options.tradeDate,target:'OFFLINE_IN_MEMORY_SINK',nowMs:options.nowMs});const value={feed:plan.next,delta:delta.acknowledge(selected.checkpoint,selected.pending),mode:plan.mode};const tmp=file+'.tmp';let pendingTemp=false;
 if(fs.existsSync(tmp)){const pending=boundedRead(tmp);if(pending.contract!==CONTRACT||pending.sha256!==evidence.sha(pending.value)||pending.sha256!==evidence.sha(value))fail('UNRECOGNIZED_PENDING_CHECKPOINT');pendingTemp=true;}
 if(selected.pending.length)await write(selected.pending);fault('AFTER_WRITE_BEFORE_CHECKPOINT');fs.mkdirSync(path.dirname(file),{recursive:true});if(!pendingTemp){const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify({contract:CONTRACT,value,sha256:evidence.sha(value)}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}fault('AFTER_CHECKPOINT_FSYNC');fs.renameSync(tmp,file);return {written:selected.pending.length,unchanged:selected.unchanged,feed_checkpoint:plan.next,mode:plan.mode,recovered_pending_checkpoint:pendingTemp};}
module.exports={CONTRACT,snapshotManifest,readCommittedSegment,safeRead,writerRows,loadCheckpoint,publishOffline};
