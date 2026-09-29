'use strict';
const median=xs=>{const a=xs.slice().sort((a,b)=>a-b),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:null;};
const equal=(a,b)=>a===b||Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
function verify(id,row,asOf){
 try{
  const current=row.current,history=row.history||[],end=Date.parse(asOf);
  if(!Array.isArray(current)||!current.length||row.status!=='READY')return false;
  const valid=require('./telegram-detectors/volume-detector.cjs').validate;
  if([...current,...history].some(b=>b.stock_id!==row.symbol||valid(b,end).reasons.length))return false;
  if(current.some((b,i)=>b.trade_date!==row.trade_date||(i&&Date.parse(b.timestamp)-Date.parse(current[i-1].timestamp)!==60000)))return false;
  if(history.some(b=>b.trade_date>=row.trade_date)||new Set([...current,...history].map(b=>b.timestamp)).size!==current.length+history.length)return false;
  const latest=current.at(-1),time=Date.parse(latest.timestamp),minute=new Date(time+28800000).toISOString().slice(11,16),early=minute<='09:20';
  if(end-time<60000||end-time>120000||row.event_time!==latest.timestamp)return false;
  const days=[...new Set(history.map(b=>b.trade_date))].sort().slice(-20),historical=history.filter(b=>days.includes(b.trade_date));
  const previous=current.slice(0,-1).slice(-20),same=historical.filter(b=>new Date(Date.parse(b.timestamp)+28800000).toISOString().slice(11,16)===minute);
  const byTime=new Map([...historical,...current].map(b=>[Date.parse(b.timestamp),b]));
  const ret=b=>{const p=byTime.get(Date.parse(b.timestamp)-60000);return p&&p.trade_date===b.trade_date?(b.close-p.close)/p.close*100:null;};
  const samples=(early?same:previous).map(b=>id==='B12'?b.volume_raw*(b.volume_raw_unit==='LOTS'?1000:1):ret(b)).filter(Number.isFinite).map(x=>id==='B12'?x:Math.abs(x));
  const base=median(samples),value=id==='B12'?latest.volume_raw*(latest.volume_raw_unit==='LOTS'?1000:1):ret(latest);
  if(samples.length<(early?10:20)||!Number.isFinite(value)||!(base>0))return false;
  const direction=id==='B12'||(id==='B13'?value>0:value<0),ratio=direction?(id==='B12'?value:Math.abs(value))/base:null;
  return row.baseline_method===(early?'SAME_MINUTE_HISTORICAL':'ROLLING_20M_MEDIAN')&&row.sample_count===samples.length&&equal(row.baseline_value,base)&&equal(id==='B12'?row.latest_volume:row.return_1m,value)&&equal(row.ratio,ratio)&&equal(row.price_spike_ratio,ratio)&&row.event_detected===(ratio!==null&&ratio>=3)&&row.admission?.allowed===row.event_detected&&Array.isArray(row.detector_failed_checks)&&row.detector_failed_checks.length===0;
 }catch{return false;}
}
module.exports={verify};
