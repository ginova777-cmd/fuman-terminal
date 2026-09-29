"use strict";
const median = xs => { const a=xs.filter(Number.isFinite).slice().sort((x,y)=>x-y); if(!a.length)return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
function b19(row, priorReturns = [], sameMinute = []) { const close=Number(row.close),prev=Number(row.previous_minute_close); const ret=close>0&&prev>0?(close-prev)/prev*100:null; const sm=median(sameMinute.map(Math.abs)),rb=median(priorReturns.map(Math.abs)),parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(row.timestamp||0)); const hhmm=`${parts.find(x=>x.type==="hour")?.value||""}:${parts.find(x=>x.type==="minute")?.value||""}`; const early=hhmm>="09:00"&&hhmm<="09:20",base=early?sm:rb,n=(early?sameMinute:priorReturns).length,ready=base!==null&&base>0&&n>=10,ratio=ready&&ret<0?Math.abs(ret)/base:null; return {return_1m:ret,down_move:ret===null?null:Math.abs(ret),same_minute_baseline:sm,same_minute_ratio:ready&&ret<0&&sm>0?Math.abs(ret)/sm:null,rolling20_baseline:rb,rolling20_ratio:ready&&ret<0&&rb>0?Math.abs(ret)/rb:null,price_spike_ratio:ratio,b19_signal:ratio!==null&&ratio>=3?"PRICE_SPIKE_DOWN":"NO_SIGNAL",baseline_zero:base!==null&&base<=0,insufficient_sample:n<10,data_status:ready?"READY":"DATA_GAP",previous_close_source:row.previous_minute_close!=null?"completed_previous_minute_bar":null}; }
function b20(row) { const i=Number(row.inside_1m),o=Number(row.outside_1m),valid=Number.isFinite(i)&&Number.isFinite(o)&&i>=0&&o>=0&&(i>0||o>0),ratio=o>0?i/o:null,unit=String(row.side_volume_unit||row.volume_unit||"").toUpperCase(),unitKnown=["SHARES","LOTS"].includes(unit); return {inside_strength:ratio,raw_inside_ratio:ratio,side_volume_unit:unit||null,side_volume_unit_known:unitKnown,side_volume_event_at:row.side_volume_event_at||null,side_volume_is_minute:row.side_volume_is_minute===true,b20_raw_strong:valid&&Number.isFinite(ratio)&&ratio>=2,inside_only:o===0&&i>0?"INSIDE_ONLY":null,no_valid_side_volume:!valid?"NO_VALID_SIDE_VOLUME":null,data_status:valid?"READY":"DATA_GAP",source_contract_ok:valid&&unitKnown&&row.side_volume_is_minute===true&&Boolean(row.side_volume_event_at)}; }
function b21(row) { const rawValue=Number(row.raw_turnover_value), rawVolume=Number(row.raw_volume); const moneyUnit=String(row.raw_turnover_unit||"").toUpperCase(), volumeUnit=String(row.raw_volume_unit||"").toUpperCase(); const value=moneyUnit==="TWD"?rawValue:moneyUnit==="TWD_THOUSAND"?rawValue*1000:null; const shares=volumeUnit==="SHARES"?rawVolume:volumeUnit==="LOTS"?rawVolume*1000:null; const p=Number(row.current_price),vw=value!==null&&shares>0?value/shares:null,d=vw>0?(p-vw)/vw*100:null; return {raw_turnover_value:Number.isFinite(rawValue)?rawValue:null,raw_turnover_unit:moneyUnit||null,raw_volume:Number.isFinite(rawVolume)?rawVolume:null,raw_volume_unit:volumeUnit||null,turnover_event_at:row.turnover_event_at||null,canonical_turnover_TWD:value,canonical_volume_SHARES:shares,vwap:vw,price_vs_vwap_pct:d,vwap_state:d===null?"DATA_GAP":d>0.05?"ABOVE_VWAP":d< -0.05?"BELOW_VWAP":"AT_VWAP",source_contract_ok:value!==null&&shares!==null&&shares>0&&Boolean(row.turnover_event_at)}; }
function b22(row) {
  const bars=Array.isArray(row.opening_range_bars)?row.opening_range_bars:[];
  const symbol=String(row.symbol||''),trade=String(row.trade_date||'');
  const eventMs=Date.parse(row.event_timestamp||row.timestamp||'');
  const identityOk=!!symbol&&/^\d{4}-\d{2}-\d{2}$/.test(trade)&&!!row.canonical_run_id&&Number.isFinite(eventMs);
  const slots=['09:00','09:01','09:02','09:03','09:04'];
  const valid=identityOk&&bars.length===5&&bars.every((x,i)=>{
    const stamp=x.timestamp||x.candle_time||'',ms=Date.parse(stamp);
    return String(x.symbol||'')===symbol&&x.synthetic===false&&x.complete===true&&
      x.high!=null&&x.low!=null&&Number.isFinite(Number(x.high))&&Number.isFinite(Number(x.low))&&
      Number(x.high)>0&&Number(x.low)>0&&Number(x.high)>=Number(x.low)&&
      ms===Date.parse(trade+'T'+slots[i]+':00+08:00')&&ms+60000<=eventMs;
  })&&eventMs>=Date.parse(trade+'T09:05:00+08:00')&&eventMs<Date.parse(trade+'T13:31:00+08:00');
  const h=valid?Math.max(...bars.map(x=>Number(x.high))):null,l=valid?Math.min(...bars.map(x=>Number(x.low))):null;
  const p=Number(row.current_price),priceOk=row.current_price!=null&&Number.isFinite(p)&&p>0;
  const ready=valid&&priceOk;
  return {opening_range_start:'09:00',opening_range_end_exclusive:'09:05',orh:h,orl:l,
    or_source_bars:bars.map(x=>x.timestamp||x.candle_time||null),or_bar_count:bars.length,
    opening_range_valid:ready,opening_range_state:!ready?'DATA_GAP':p>h?'ABOVE_OPENING_RANGE':p<l?'BELOW_OPENING_RANGE':'INSIDE_OPENING_RANGE',
    break_direction:ready?(p>h?'UP':p<l?'DOWN':null):null,source_contract_ok:ready};
}
function b23(row) { const p=Number(row.current_price),o=Number(row.today_open),eventMs=Date.parse(row.event_timestamp||""); const trade=String(row.trade_date||"").slice(0,10),symbol=String(row.symbol||""); const bars=Array.isArray(row.bars_through_event)&&symbol?row.bars_through_event.filter(x=>x.synthetic!==true&&Number.isFinite(Number(x.high))&&Number.isFinite(Number(x.low))&&String(x.symbol||"")===symbol&&(!trade||String(x.trade_date||x.date||x.candle_time||x.timestamp||"").slice(0,10)===trade)&&(!Number.isFinite(eventMs)||Date.parse(x.candle_time||x.timestamp||x.bar_end||"")<=eventMs)):[]; const h=bars.length?Math.max(...bars.map(x=>Number(x.high))):null,l=bars.length?Math.min(...bars.map(x=>Number(x.low))):null; return {day_high_so_far:Number.isFinite(h)?h:null,day_low_so_far:Number.isFinite(l)?l:null,distance_from_high_pct:h>0?(p-h)/h*100:null,distance_from_low_pct:l>0?(p-l)/l*100:null,distance_from_open_pct:o>0?(p-o)/o*100:null,new_high:bars.length>0&&p>=h,new_low:bars.length>0&&p<=l,point_in_time:bars.length>0,source_contract_ok:bars.length>0&&Number.isFinite(eventMs)&&Boolean(symbol)&&Boolean(row.trade_date)&&Boolean(row.canonical_run_id)}; }
function b24(events, windowSeconds=180) {
 if(!Number.isFinite(windowSeconds)||windowSeconds<0||windowSeconds>180)return [];
 const valid=(Array.isArray(events)?events:[]).filter(e=>{
  const time=Date.parse(e?.event_timestamp);
  return e&&e.event_id&&e.type&&e.source_contract&&e.source_contract_ok===true&&/^\d{4}$/.test(e.symbol||'')&&e.canonical_run_id&&Number.isFinite(time)&&new Date(time+28800000).toISOString().slice(0,10)===e.trade_date;
 });
 // Ambiguous repeated IDs are rejected instead of silently choosing the last event.
 const counts=new Map();for(const e of valid)counts.set(e.event_id,(counts.get(e.event_id)||0)+1);
 const unique=valid.filter(e=>counts.get(e.event_id)===1),out=[];
 for(const e of unique){
  const group=unique.filter(x=>x.event_id!==e.event_id&&x.symbol===e.symbol&&x.trade_date===e.trade_date&&x.canonical_run_id===e.canonical_run_id&&Math.abs(Date.parse(x.event_timestamp)-Date.parse(e.event_timestamp))<=windowSeconds*1000);
  if(group.length)out.push({type:'EVENT_COMBINATION',symbol:e.symbol,trade_date:e.trade_date,canonical_run_id:e.canonical_run_id,event_combination:[e.type,...group.map(x=>x.type)],event_sequence:[e,...group].map(x=>({event_id:x.event_id,event_timestamp:x.event_timestamp,time_difference_seconds:(Date.parse(x.event_timestamp)-Date.parse(e.event_timestamp))/1000})),same_bar_event:[e,...group].every(x=>Date.parse(x.event_timestamp)===Date.parse(e.event_timestamp)),formal_candidate_allowed:false,publish_allowed:false});
 }
 return out;
}
module.exports={median,b19,b20,b21,b22,b23,b24};
