'use strict';
// Official trade cumulative volume proves each minute boundary. Provider side totals
// must match those exact counters; arbitrary adjacent snapshots are never used.
function build({trade_date,stock_id,trades,journal,as_of,volume_unit}){
 if(volume_unit!=='LOTS'||!Array.isArray(trades)||!Array.isArray(journal)||!Number.isFinite(Date.parse(as_of)))throw Error('INVALID_SOURCE_CONTRACT');
 const rows=[],gaps=[],grouped=new Map(),seen=new Map();let cumulative=null,previousGroup=null;
 const sorted=trades.slice().sort((a,b)=>a.time-b.time||a.serial-b.serial);
 for(const x of sorted){
  if(!Number.isSafeInteger(x.time)||x.time<1e15)throw Error('MISSING_NATIVE_TRADE_TIME');
  const t=x.time/1000,local=new Date(t+28800000).toISOString(),minute=local.slice(11,16);if(local.slice(0,10)!==trade_date)throw Error('TRADE_DATE_MISMATCH');if(minute<'09:00'||minute>'13:30')continue;
  if(!Number.isSafeInteger(x.serial)||!Number.isFinite(x.size)||x.size<0||!Number.isFinite(x.volume))throw Error('MISSING_NATIVE_TRADE_COUNTER');
  const signature=JSON.stringify(x);if(seen.has(x.serial)){if(seen.get(x.serial)!==signature)throw Error('TRADE_SERIAL_CONFLICT');continue;}seen.set(x.serial,signature);
  const first=cumulative===null;if(first)cumulative=x.volume-x.size;
  if(cumulative<0||x.volume<x.size)throw Error('INVALID_NATIVE_TRADE_COUNTER');
  const discontinuity=x.volume!==cumulative+x.size,key=Math.floor(t/60000)*60000;let g=grouped.get(key);
  if(!g){g={before:cumulative,last:x,volume:0,count:0,gap:first&&cumulative>0?'MISSING_NATIVE_MINUTE_PREFIX':null};grouped.set(key,g);}
  if(discontinuity){g.gap='INCOMPLETE_NATIVE_TRADE_SEQUENCE';if(previousGroup)previousGroup.gap='INCOMPLETE_NATIVE_TRADE_SEQUENCE';}
  g.volume+=x.size;g.last=x;g.count++;cumulative=x.volume;previousGroup=g;
 }
 const byVolume=new Map();
 for(const j of journal){if(j.stock_id!==stock_id||j.trade_date!==trade_date||j.aggregation!=='DAY_CUMULATIVE'||j.volume_unit!=='LOTS'||j.provider_source!=='Fugle.aggregates.total'||j.is_synthetic!==false||j.is_trial!==false||Date.parse(j.received_at)>Date.parse(as_of))continue;
  const v=j.total;if(!v||!['tradeVolume','tradeVolumeAtBid','tradeVolumeAtAsk'].every(k=>typeof v[k]==='number'&&Number.isFinite(v[k])&&v[k]>=0)||v.tradeVolumeAtBid+v.tradeVolumeAtAsk>v.tradeVolume)continue;
  const prev=byVolume.get(v.tradeVolume);if(prev&&(prev.total.tradeVolumeAtBid!==v.tradeVolumeAtBid||prev.total.tradeVolumeAtAsk!==v.tradeVolumeAtAsk))throw Error('PROVIDER_COUNTER_REVISION');byVolume.set(v.tradeVolume,j);
 }
 for(const [t,g]of grouped){if(t+60000>Date.parse(as_of))continue;const end=byVolume.get(g.last.volume),start=g.before===0?null:byVolume.get(g.before),timestamp=new Date(t).toISOString();
  if(g.gap){gaps.push({timestamp,reason:g.gap});continue;}
  if(!end||(g.before>0&&!start)){gaps.push({timestamp,reason:'MISSING_EXACT_PROVIDER_SIDE_BOUNDARY',start_volume:g.before,end_volume:g.last.volume});continue;}
  const event=Date.parse(end.event_at);if(event<t||event>=t+60000||end.event_time_microseconds!==g.last.time){gaps.push({timestamp,reason:'PROVIDER_EVENT_BOUNDARY_MISMATCH'});continue;}
  const outside=end.total.tradeVolumeAtAsk-(start?.total.tradeVolumeAtAsk??0),inside=end.total.tradeVolumeAtBid-(start?.total.tradeVolumeAtBid??0),unknown=g.volume-outside-inside;
  if(outside<0||inside<0||unknown<0){gaps.push({timestamp,reason:'SIDE_COUNTER_RESET_OR_INVALID_DELTA'});continue;}
  rows.push({trade_date,stock_id,timestamp,outside_1m:outside,inside_1m:inside,neutral_1m:null,unknown_1m:unknown,total_1m:g.volume,volume_unit:'LOTS',side_volume_timestamp:end.event_at,processing_timestamp:as_of,complete:true,is_synthetic:false,aggregation:'ONE_MINUTE',classification_source:'Fugle.aggregates.total.exact_trade_counter_boundaries',start_boundary_identity:start?.identity??'ZERO_TOTAL_BEFORE_FIRST_REGULAR_TRADE',end_boundary_identity:end.identity,trade_count:g.count});
 }
 return {rows,data_gaps:gaps,requested_count:rows.length+gaps.length,source:'Fugle provider cumulative side totals matched to complete native trade counters',live_freshness_still_required:true};
}
module.exports={build};
