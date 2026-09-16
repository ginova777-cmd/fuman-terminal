'use strict';
// Independent last-complete-minute arithmetic. Never imports any detector.
const median=v=>{const a=v.slice().sort((a,b)=>a-b),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:null;};
const equal=(a,b)=>a===b||Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
function verify({current,volumeCurrent=current,history=[],volume,price,outsideCurrent=[],outsideHistory=[],outside=null}){
 const failed=[],check=(ok,k)=>{if(!ok)failed.push(k);},bars=current.slice().sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
 const b=bars.at(-1);if(!b)return ['NO_CURRENT_BAR'];
 const t=Date.parse(b.timestamp),minute=new Date(t+28800000).toISOString().slice(11,16),days=[...new Set(history.map(x=>x.trade_date))].sort().slice(-20),hs=history.filter(x=>days.includes(x.trade_date));
 const same=hs.filter(x=>new Date(Date.parse(x.timestamp)+28800000).toISOString().slice(11,16)===minute),prior=bars.slice(0,-1).slice(-20);
 const vPrior=volumeCurrent.slice(0,-1).slice(-20),shares=x=>x.volume_raw*(x.volume_raw_unit==='LOTS'?1000:1),baseV=minute<='09:20'?(same.length>=10?median(same.map(shares)):null):(vPrior.length===20?median(vPrior.map(shares)):null);
 const ratioV=baseV>0?shares(b)/baseV:null;
 if(volume){check(equal(volume.primary_ratio,ratioV),'VOLUME_RATIO');check(volume.volume_anomaly_event===(ratioV!==null&&ratioV>=3),'VOLUME_EVENT');}
 const map=new Map([...hs,...bars].map(x=>[Date.parse(x.timestamp),x]));
 const ret=x=>{const m=new Date(Date.parse(x.timestamp)+28800000).toISOString().slice(11,16),p=map.get(Date.parse(x.timestamp)-60000);return m!=='09:00'&&p?.trade_date===x.trade_date?(x.close-p.close)/p.close*100:null;};
 const values=(minute<='09:20'?same:prior).map(ret).filter(x=>x!==null).map(Math.abs),baseP=values.length>=(minute<='09:20'?10:20)?median(values):null,change=ret(b),ratioP=change>0&&baseP>0?change/baseP:null;
 if(price){check(equal(price.primary_price_spike_ratio,ratioP),'PRICE_RATIO');check(price.price_up_anomaly_event===(ratioP!==null&&ratioP>=3),'PRICE_EVENT');}
 if(outside){
  const bar=outsideCurrent.at(-1),stamp=Date.parse(bar.timestamp),raw=bar.inside_1m>0?bar.outside_1m/bar.inside_1m:null;
  const hdays=[...new Set(outsideHistory.map(x=>x.trade_date))].sort().slice(-20),sameSide=outsideHistory.filter(x=>hdays.includes(x.trade_date)&&new Date(Date.parse(x.timestamp)+28800000).toISOString().slice(11,16)===minute);
  const samples=(minute<='09:20'?sameSide:outsideCurrent.filter(x=>Date.parse(x.timestamp)>=stamp-1200000&&Date.parse(x.timestamp)<stamp)).filter(x=>x.complete===true&&x.is_synthetic===false&&x.inside_1m>0).map(x=>x.outside_1m/x.inside_1m);
  const base=samples.length>=10?median(samples):null,dynamic=raw!==null&&base>0?raw/base:null;
  check(equal(outside.raw_outside_strength,raw),'OUTSIDE_RAW_RATIO');check(equal(outside.primary_dynamic_ratio,dynamic),'OUTSIDE_DYNAMIC_RATIO');
  check(outside.raw_event===(raw!==null&&raw>=2),'OUTSIDE_RAW_EVENT');check(outside.dynamic_event===(dynamic!==null&&dynamic>=2),'OUTSIDE_DYNAMIC_EVENT');
 }
 return failed;
}
module.exports={verify};
