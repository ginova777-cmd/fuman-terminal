'use strict';
// Independent calculation core; RAW and DYNAMIC events are separate.
const number=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
function time(t){if(typeof t!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(t))return null;const n=Date.parse(t);return Number.isFinite(n)?n:null;}
const local=n=>new Date(n+28800000).toISOString();
function row(b){const t=time(b.timestamp),s=time(b.side_volume_timestamp),reasons=[];
if(t===null||t%60000||local(t).slice(11,16)<'09:00'||local(t).slice(11,16)>'13:30')reasons.push('INVALID_TIMESTAMP');
if(t!==null&&local(t).slice(0,10)!==b.trade_date)reasons.push('TRADE_DATE_MISMATCH');
if(b.complete!==true)reasons.push('INCOMPLETE_MINUTE');if(b.is_synthetic!==false)reasons.push('SYNTHETIC_OR_UNKNOWN');
if(b.aggregation!=='ONE_MINUTE')reasons.push('NOT_ONE_MINUTE_SIDE_VOLUME');if(!b.classification_source)reasons.push('MISSING_PROVIDER_CLASSIFICATION');
if(s===null||t===null||s<t||s>t+60000)reasons.push('INVALID_SIDE_EVENT_TIME');
if(!['LOTS','SHARES'].includes(b.volume_unit))reasons.push('UNKNOWN_VOLUME_UNIT');
for(const k of ['outside_1m','inside_1m'])if(!number(b[k]))reasons.push('INVALID_'+k.toUpperCase());
for(const k of ['neutral_1m','unknown_1m','total_1m'])if(b[k]!=null&&!number(b[k]))reasons.push('INVALID_'+k.toUpperCase());
const factor=b.volume_unit==='LOTS'?1000:b.volume_unit==='SHARES'?1:null,converted={};for(const k of ['outside_1m','inside_1m','neutral_1m','unknown_1m','total_1m'])converted[k]=number(b[k])&&factor!==null?b[k]*factor:null;
const known=converted.outside_1m!==null&&converted.inside_1m!==null?converted.outside_1m+converted.inside_1m:null;
if(converted.total_1m!==null&&known!==null&&converted.total_1m<known+(converted.neutral_1m??0)+(converted.unknown_1m??0))reasons.push('SIDE_COMPONENTS_EXCEED_TOTAL');
const raw=!reasons.length&&b.inside_1m>0?b.outside_1m/b.inside_1m:null;
return {b,t,s,reasons,converted,known,raw};}
const median=xs=>{const a=xs.slice().sort((a,b)=>a-b),n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;};
function evaluate({current,history=[],rolling=[],processing_timestamp,previous_result=null}){
const c=row(current),now=time(processing_timestamp);if(now===null)throw Error('PROCESSING_TIMESTAMP_REQUIRED');
if([...history,...rolling].some(x=>x.stock_id!==current.stock_id))throw Error('STOCK_ID_MISMATCH');
const duplicates=new Set();for(const b of [...history,...rolling,current]){const t=time(b.timestamp);if(t!==null){if(duplicates.has(t))throw Error('DUPLICATE_MINUTE');duplicates.add(t);}}
const age=c.s===null?null:(now-c.s)/1000,reasons=c.reasons.slice();if(c.t!==null&&c.t+60000>now)reasons.push('INCOMPLETE_MINUTE');if(age===null||age<0)reasons.push('INVALID_SIDE_EVENT_AGE');if(age>120)reasons.push('STALE_SIDE_VOLUME');
const past=history.map(row).filter(x=>!x.reasons.length&&x.b.trade_date<current.trade_date&&x.t<c.t),dates=[...new Set(past.map(x=>x.b.trade_date))].sort().slice(-20),hm=past.filter(x=>dates.includes(x.b.trade_date)&&local(x.t).slice(11,16)===local(c.t??0).slice(11,16));
const rw=rolling.map(row).filter(x=>!x.reasons.length&&x.b.trade_date===current.trade_date&&x.t<c.t&&x.t>=c.t-20*60000).sort((a,b)=>a.t-b.t),hv=hm.filter(x=>x.raw!==null),rv=rw.filter(x=>x.raw!==null);
const sm=hv.length>=10?median(hv.map(x=>x.raw)):null,rb=rv.length>=10?median(rv.map(x=>x.raw)):null,method=c.t!==null&&local(c.t).slice(11,16)<='09:20'?'SAME_MINUTE_HISTORICAL':'ROLLING_20M_MEDIAN',baseline=method==='SAME_MINUTE_HISTORICAL'?sm:rb;
const raw=reasons.length?null:c.raw,ratio=b=>raw!==null&&b>0?raw/b:null,p=ratio(baseline),sideState=reasons.length?'DATA_GAP':current.inside_1m===0?current.outside_1m>0?'OUTSIDE_ONLY':'NO_VALID_SIDE_VOLUME':'RATIO_VALID';
const result = {contract:'intraday_dynamic_outside_strength_detector_v1_core',trade_date:current.trade_date,stock_id:current.stock_id,timestamp:current.timestamp,raw_input:current,volume_unit:'SHARES',...c.converted,classified_side_volume:c.known,unclassified_difference:c.converted.total_1m!==null&&c.known!==null?c.converted.total_1m-c.known:null,side_coverage_ratio:c.converted.total_1m>0&&c.known!==null?c.known/c.converted.total_1m:null,side_state:sideState,raw_outside_strength:raw,RAW_OUTSIDE_STRONG:raw!==null&&raw>=2,raw_level:raw===null?null:raw<1?'INSIDE_DOMINANT':raw<1.5?'BALANCED_TO_OUTSIDE':raw<2?'OUTSIDE_STRONG':raw<3?'OUTSIDE_VERY_STRONG':'OUTSIDE_EXTREME',same_minute_baseline:sm,same_minute_dynamic_ratio:ratio(sm),same_minute_sample_count:hv.length,zero_denominator_sample_count:hm.filter(x=>x.b.inside_1m===0).length,rolling_window_size:20,rolling_observed_count:rw.length,rolling_valid_ratio_count:rv.length,rolling_zero_denominator_sample_count:rw.filter(x=>x.b.inside_1m===0).length,rolling20_baseline:rb,rolling20_dynamic_ratio:ratio(rb),primary_baseline_method:method,primary_baseline:baseline,primary_dynamic_ratio:p,dynamic_level:p===null?null:p<1.5?'NORMAL_DYNAMIC_OUTSIDE':p<2?'OUTSIDE_STRENGTH_EXPANSION':p<3?'STRONG_OUTSIDE_STRENGTH_EXPANSION':p<5?'DYNAMIC_OUTSIDE_SPIKE':'EXTREME_DYNAMIC_OUTSIDE_SPIKE',baseline_zero:baseline!==null&&baseline<=0,insufficient_sample:hv.length<10,rolling_insufficient_sample:rv.length<10,side_volume_timestamp:current.side_volume_timestamp,processing_timestamp,side_volume_age_seconds:age,stale_side_volume:age!==null&&age>120,data_gap:reasons.length>0,reasons,turnover_value_1m:number(current.turnover_value_1m)?current.turnover_value_1m:null,dynamic_event:p!==null&&p>=2,dynamic_event_rule_status:'SPECIFIED',publish_allowed:false};
const prev=rw.find(x=>x.t===c.t-60000),prevRaw=prev?.raw??null;
result.raw_strength_change=raw!==null&&prevRaw!==null?raw-prevRaw:null;
result.raw_strength_acceleration=raw!==null&&prevRaw>0?raw/prevRaw:null;
result.raw_event=result.RAW_OUTSIDE_STRONG;
result.event_types=[];
if(result.raw_event)result.event_types.push('RAW_OUTSIDE_STRENGTH_EVENT');
if(result.dynamic_event)result.event_types.push('DYNAMIC_OUTSIDE_STRENGTH_EVENT');
result.combined_classification=result.raw_event&&result.dynamic_event?'RAW_AND_DYNAMIC_OUTSIDE':result.raw_event?'RAW_ONLY':result.dynamic_event?'DYNAMIC_ONLY':'NEITHER';
const linked=previous_result&&previous_result.stock_id===current.stock_id&&previous_result.trade_date===current.trade_date&&time(previous_result.timestamp)===c.t-60000&&!previous_result.data_gap;
result.consecutive_raw_strong_minutes=result.raw_event?1+(linked&&previous_result.raw_event?previous_result.consecutive_raw_strong_minutes||0:0):0;
result.consecutive_dynamic_strong_minutes=result.dynamic_event?1+(linked&&previous_result.dynamic_event?previous_result.consecutive_dynamic_strong_minutes||0:0):0;
result.rolling20_sample_count=rv.length;
result.dynamic_signal_level=result.dynamic_level;
result.OUTSIDE_ONLY=sideState==='OUTSIDE_ONLY';result.NO_VALID_SIDE_VOLUME=sideState==='NO_VALID_SIDE_VOLUME';
result.BASELINE_ZERO=result.baseline_zero;result.INSUFFICIENT_SAMPLE=result.insufficient_sample;
result.ROLLING_INSUFFICIENT_SAMPLE=result.rolling_insufficient_sample;result.DATA_GAP=result.data_gap;
return result;
}
module.exports={evaluate};


