'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {normalize,hash}=require('./txf-candle-evidence.cjs');
const CONTRACT='mother-pool-txf-1m-archive-v1';
function createArchive({runtime,now=()=>Date.now(),flushMs=30000}){
 const groups=new Map();let lastFlush=0;
 function fileFor(row){return path.join(runtime,'data','mother-pool','futures-1m',row.trade_date,row.session,row.future_symbol+'.json');}
 function load(row){
  const file=fileFor(row);if(groups.has(file))return groups.get(file);
  let saved=null;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('TXF_ARCHIVE_UNREADABLE');}
  if(saved&&(saved.contract!==CONTRACT||saved.trade_date!==row.trade_date||saved.future_symbol!==row.future_symbol||saved.session!==row.session||saved.rows_sha256!==hash(saved.rows)||!Array.isArray(saved.rows)))throw Error('TXF_ARCHIVE_IDENTITY_OR_HASH');
  const rows=new Map((saved?.rows||[]).map(r=>[r.candle_time,r]));
  if(rows.size!==(saved?.rows||[]).length||rows.size>1440)throw Error('TXF_ARCHIVE_DUPLICATE_OR_BOUND');
  const group={file,identity:{trade_date:row.trade_date,future_symbol:row.future_symbol,session:row.session},rows,dirty:false,pending:[]};groups.set(file,group);return group;
 }
 function ingest(raw,context){
  const row=normalize(raw,{...context,nowMs:now()}),group=load(row),old=group.rows.get(row.candle_time);
  if(old?.raw_sha256===row.raw_sha256)return {accepted:false,reason:'DUPLICATE'};
  if(old&&Date.parse(row.received_at)<Date.parse(old.received_at))return {accepted:false,reason:'OUT_OF_ORDER_RECEIPT'};
  const conflict=old&&(old.conflict===true||row.volume<old.volume||(old.closed_at_receipt&&['open','high','low','close','volume'].some(k=>row[k]!==old[k])));
  const next={...row,first_available_at:old?.first_available_at||row.available_at,conflict:Boolean(conflict),volume_strategy_usable:!conflict};
  if(conflict)next.data_gap_reason='CONFLICTING_CANDLE_EVIDENCE';
  if(!old&&group.rows.size>=1440)throw Error('TXF_ARCHIVE_DAY_BOUND');
  group.pending.push({recorded_at:new Date(now()).toISOString(),previous_raw_sha256:old?.raw_sha256||null,evidence:next});
  group.rows.set(row.candle_time,next);group.dirty=true;
  return {accepted:true,conflict:Boolean(conflict)};
 }
 function flush({force=false}={}){
  if(!force&&now()-lastFlush<flushMs)return {files_written:0,reason:'COALESCED'};
  let files=0,bars=0,bytes=0;
  for(const group of groups.values()){
   if(!group.dirty)continue;
   const rows=[...group.rows.values()].sort((a,b)=>a.candle_time.localeCompare(b.candle_time));
   const runId=randomUUID(),out={contract:CONTRACT,...group.identity,run_id:runId,published_at:new Date(now()).toISOString(),count:rows.length,conflict_count:rows.filter(r=>r.conflict).length,rows_sha256:hash(rows),rows};
   fs.mkdirSync(path.dirname(group.file),{recursive:true});
   const journal=group.file.replace(/\.json$/,'.evidence.jsonl');
   // Append provenance before publishing; interruption may leave redundant evidence, never a silent replacement.
   if(group.pending.length){fs.appendFileSync(journal,group.pending.map(r=>JSON.stringify({...r,publication_run_id:runId})).join('\n')+'\n');group.pending=[];}
   const data=JSON.stringify(out),tmp=group.file+'.tmp-'+process.pid+'-'+runId;
   fs.writeFileSync(tmp,data);fs.renameSync(tmp,group.file);
   group.dirty=false;files++;bars+=rows.length;bytes+=Buffer.byteLength(data);
  }
  lastFlush=now();return {files_written:files,bars_published:bars,bytes_written:bytes};
 }
 return {ingest,flush};
}
module.exports={createArchive,CONTRACT};
