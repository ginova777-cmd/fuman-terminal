'use strict';
const CONTRACT='intraday_volume_spike_detector_v1';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const median=xs=>{const a=xs.slice().sort((x,y)=>x-y),n=a.length;return !n?null:n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;};
function clock(timestamp){if(typeof timestamp!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(timestamp))return null;const ms=Date.parse(timestamp);if(!Number.isFinite(ms)||ms%60000!==0)return null;const local=new Date(ms+28800000).toISOString();return {ms,date:local.slice(0,10),minute:local.slice(11,16)};}
function validate(b,asOf){const c=clock(b.timestamp),reasons=[];if(!c||c.minute<'09:00'||c.minute>'13:30')reasons.push('INVALID_TIMESTAMP');if(c&&b.trade_date!==c.date)reasons.push('TRADE_DATE_MISMATCH');if(b.complete!==true||c&&c.ms+60000>asOf)reasons.push('INCOMPLETE_BAR');if(b.is_synthetic!==false)reasons.push('SYNTHETIC_OR_UNKNOWN_BAR');if(!['SHARES','LOTS'].includes(b.volume_raw_unit))reasons.push('UNKNOWN_VOLUME_UNIT');if(!finite(b.volume_raw)||b.volume_raw<0)reasons.push('INVALID_VOLUME');if(!['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low)reasons.push('INVALID_OHLC');if(b.available_at!=null&&(!Number.isFinite(Date.parse(b.available_at))||Date.parse(b.available_at)>asOf))reasons.push('NOT_AVAILABLE_AS_OF');return {clock:c,reasons,shares:reasons.length?null:b.volume_raw*(b.volume_raw_unit==='LOTS'?1000:1)};}
function classify(r){return r==null?'INSUFFICIENT_DATA':r>=8?'EXTREME_VOLUME_SPIKE':r>=5?'VOLUME_SPIKE':r>=3?'STRONG_VOLUME_EXPANSION':r>=2?'VOLUME_EXPANSION':'NORMAL';}
function detect({stock_id,trade_date,current,history,as_of}){
const asOf=Date.parse(as_of);if(!Number.isFinite(asOf))throw Error('AS_OF_REQUIRED');
if([...current,...history].some(b=>b.stock_id!==stock_id))throw Error('STOCK_ID_MISMATCH');
const seen=new Set();for(const b of [...current,...history]){const c=clock(b.timestamp);if(c){const k=c.ms;if(seen.has(k))throw Error('DUPLICATE_MINUTE');seen.add(k);}}
const hs=history.map(b=>({b,...validate(b,asOf)})).filter(x=>!x.reasons.length&&x.b.trade_date<trade_date);
const days=[...new Set(hs.map(x=>x.b.trade_date))].sort().slice(-20),hist=hs.filter(x=>days.includes(x.b.trade_date));
const sorted=current.slice().sort((a,b)=>(clock(a.timestamp)?.ms??Infinity)-(clock(b.timestamp)?.ms??Infinity));
const valid=[],rows=[];
for(const b of sorted){const v=validate(b,asOf);if(b.trade_date!==trade_date&&!v.reasons.includes('TRADE_DATE_MISMATCH'))v.reasons.push('TRADE_DATE_MISMATCH');
const prior=valid.filter(x=>v.clock&&x.clock.ms<v.clock.ms).slice(-20),h=hist.filter(x=>x.clock.minute===v.clock?.minute);
const sm=h.length>=10?median(h.map(x=>x.shares)):null,rolling=prior.length===20?median(prior.map(x=>x.shares)):null;
const method=v.clock&&v.clock.minute>='09:00'&&v.clock.minute<='09:20'?'SAME_MINUTE_HISTORICAL':'ROLLING_20M_MEDIAN';
const primary=method==='SAME_MINUTE_HISTORICAL'?sm:rolling;
const validInput=v.reasons.length===0;
const ratio=den=>!v.reasons.length&&finite(den)&&den>0?v.shares/den:null;
const pr=ratio(primary),rawTurnover=b.turnover_value_1m;
const row={trade_date:b.trade_date,stock_id,timestamp:b.timestamp,open:b.open,high:b.high,low:b.low,close:b.close,volume_raw:b.volume_raw,volume_raw_unit:b.volume_raw_unit,volume_shares:v.reasons.length?null:v.shares,volume_lots:v.reasons.length?null:v.shares/1000,canonical_volume_unit:'SHARES',turnover_value_1m:finite(rawTurnover)&&rawTurnover>=0?rawTurnover:null,same_minute_baseline:sm,same_minute_ratio:ratio(sm),same_minute_sample_count:h.length,rolling20_baseline:rolling,rolling20_ratio:ratio(rolling),rolling20_sample_count:prior.length,primary_baseline_method:method,primary_baseline:primary,primary_ratio:pr,signal_level:classify(pr),volume_anomaly_event:pr!==null&&pr>=3,baseline_zero:primary!==null&&primary<=0,insufficient_sample:h.length<10,rolling_insufficient_sample:prior.length<20,data_gap:v.reasons.length>0,reasons:v.reasons,baseline_unit:'SHARES',same_minute_baseline_zero:sm!==null&&sm<=0,rolling20_baseline_zero:rolling!==null&&rolling<=0,session_kind:v.clock?.minute==='13:30'?'CLOSING_AUCTION':'REGULAR',source:b.source||null};
if(primary===null)row.reasons.push(method==='SAME_MINUTE_HISTORICAL'?'INSUFFICIENT_SAMPLE':'ROLLING_INSUFFICIENT_SAMPLE');else if(primary<=0)row.reasons.push('BASELINE_ZERO');
rows.push(row);if(validInput)valid.push({b,clock:v.clock,shares:v.shares});
}
const events=rows.filter(r=>r.volume_anomaly_event).map(r=>({...r,event_type:'VOLUME_ANOMALY_EVENT',event_price:r.close}));
return {contract:CONTRACT,stock_id,trade_date,as_of,mode:'independent_detector',canonical_volume_unit:'SHARES',historical_dates:days,history_rejected_count:history.length-hs.length,rows,events};
}
function forward(events,current,as_of){const end=Date.parse(as_of),map=new Map();for(const b of current){const v=validate(b,end);if(!v.reasons.length)map.set(v.clock.ms,b);}
return events.map(e=>{const r={...e},ms=clock(e.timestamp).ms;for(const n of [1,3,5,10,20]){const b=map.get(ms+n*60000);r['forward_return_'+n+'m']=b&&b.trade_date===e.trade_date?b.close/e.event_price-1:null;r['forward_status_'+n+'m']=b&&b.trade_date===e.trade_date?'READY':ms+(n+1)*60000>end?'NOT_YET_AVAILABLE':'NO_EXACT_FUTURE_BAR';}return r;});}
module.exports={CONTRACT,detect,forward,validate,clock,classify};
