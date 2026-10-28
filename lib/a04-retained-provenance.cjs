'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const version=()=>digest(fs.readFileSync(__filename));
function retain({runtime,market,bytes,capturedAt,producerSha256}){
 if(!['TSE','OTC','TIB'].includes(market)||!Buffer.isBuffer(bytes)||bytes.length>32*1024*1024||!Number.isFinite(Date.parse(capturedAt))||!/^[a-f0-9]{64}$/.test(producerSha256))throw Error('A04_RAW_INPUT_INVALID');
 const raw=JSON.parse(bytes),date=String(raw.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Array.isArray(raw.data))throw Error('A04_RAW_DATE_INVALID');
 const dir=path.join(runtime,'data','a04-source-originals',date,crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,market+'.json');fs.writeFileSync(file,bytes,{flag:'wx'});if(digest(fs.readFileSync(file))!==digest(bytes))throw Error('A04_RAW_SAVE_READBACK');
 return {contract:'a04_fugle_snapshot_original_v1',path:file,bytes:bytes.length,sha256:digest(bytes),market,trade_date:date,captured_at:capturedAt,provider_published_at:null,producer_sha256:producerSha256,source_version:version()};
}
function normalize(row,runtime,readAt){
 if(['2323','6173'].includes(row.symbol))throw Error('A04_OWNER_UNKNOWN');
 const e=row.payload?.a04_original,root=path.resolve(runtime,'data','a04-source-originals')+path.sep;
 if(e?.contract!=='a04_fugle_snapshot_original_v1'||!['TSE','OTC','TIB'].includes(e.market)||e.source_version!==version()||e.trade_date!==row.trade_date||!path.resolve(e.path||'').startsWith(root)||row.source!=='fugle-snapshot-'+e.market.toLowerCase())throw Error('A04_ORIGINAL_BINDING_MISSING');
 const b=fs.readFileSync(e.path);if(b.length!==e.bytes||b.length>32*1024*1024||digest(b)!==e.sha256)throw Error('A04_ORIGINAL_HASH');
 const raw=JSON.parse(b),matches=raw.data?.filter(x=>String(x.symbol)===row.symbol);if(raw.date!==row.trade_date||matches?.length!==1)throw Error('A04_ORIGINAL_SET');
 const q=matches[0],numbers={open:q.openPrice,high:q.highPrice,low:q.lowPrice,close:q.closePrice,volume_lots:q.total?.tradeVolume??q.tradeVolume};
 for(const [k,v]of Object.entries(numbers))if(typeof row[k]!=='number'||!Number.isFinite(row[k])||Number(v)!==row[k])throw Error('A04_ORIGINAL_VALUE');
 if(!Number.isFinite(Date.parse(e.captured_at))||!Number.isFinite(Date.parse(row.updated_at))||Date.parse(e.captured_at)>Date.parse(row.updated_at)||Date.parse(row.updated_at)>Date.parse(readAt))throw Error('A04_ORIGINAL_TIME');
 return {...row,available_at:row.updated_at,is_synthetic:false,replay:false,look_ahead:false};
}
function bind({rows,readback,symbol,tradeDate,calendar,readAt,runtime,binding}){
 const {hash}=require('./a04-source-evidence.cjs');
 try{
  if(binding.status!=='APPROVED'||binding.source_version!==version()||rows.length!==15||readback.length!==15||hash(rows)!==hash(readback))throw Error('A04_INDEPENDENT_READBACK');
  const normalized=rows.map(r=>normalize(r,runtime,readAt));
  const independentlyNormalized=readback.map(r=>normalize(r,runtime,readAt));
  return {rows:normalized,proof:{contract:'a04_historical_source_readback_v1',source:'strategy4_daily_ohlcv_view',symbol,trade_date:tradeDate,source_contract:binding.source_contract,source_version:binding.source_version,source_run_id:hash(normalized),binding_sha256:hash(binding),available_at:normalized.map(r=>r.available_at).sort().at(-1),read_at:readAt,is_synthetic:false,replay:false,look_ahead:false,requested_count:15,written_count:15,readback_count:15,readback_rows:independentlyNormalized,rows_sha256:hash(normalized),calendar_sha256:hash(calendar)},status:'ORIGINAL_AND_READBACK_VERIFIED'};
 }catch(e){return {rows,proof:null,status:'UNKNOWN',reason:e.message};}
}
module.exports={retain,normalize,bind,version};
