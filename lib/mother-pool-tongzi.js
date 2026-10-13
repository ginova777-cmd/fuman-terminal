'use strict';
const crypto=require('node:crypto');
const CONTRACT='intraday_tongzi_0901_v1';
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const day=t=>new Date(t+28800000).toISOString().slice(0,10);
function levels(bar,{symbol,trade_date,asOf}){
 const t=Date.parse(bar?.timestamp),now=Date.parse(asOf),seen=Date.parse(bar?.available_at);
 if(!bar||bar.stock_id!==symbol||bar.trade_date!==trade_date||t!==Date.parse(trade_date+'T09:01:00+08:00')||!Number.isFinite(now)||!Number.isFinite(seen)||seen<t||seen>now||t+60000>now||bar.complete!==true||bar.is_synthetic!==false||!bar.source||bar.timeframe&&bar.timeframe!=='1m'||!['open','high','low','close'].every(k=>finite(bar[k])&&bar[k]>0)||bar.high<Math.max(bar.open,bar.close,bar.low)||bar.low>Math.min(bar.open,bar.close,bar.high))throw Error('TONGZI_0901_NATURAL_COMPLETED_BAR_REQUIRED');
 const {open:O,high:H,low:L}=bar,GAP=H-L;
 const P2=O*1.03,P3=O*1.05,S3=O*.98,S4=O*.96;
 const up=[1,2,3,4].map(n=>H+n*GAP),down=[1,2,3,4].map(n=>L-n*GAP);
 const resonance=(p,projection)=>projection.flatMap((q,i)=>q>0&&Math.abs(p-q)/q<=.005?[i+1]:[]);
 return {contract:CONTRACT,bar_hash:digest(bar),bar_timestamp:bar.timestamp,available_at:bar.available_at,GAP,RANGE:GAP/L*100,P0:(H+L)/2,P1:H,P2,P3,P2_R1:P2*.98,P2_R2:P2*.96,P3_R1:P3*.98,P3_R2:P3*.96,S1:L,S2:L-GAP,S3,S4,S3_T1:S3*1.02,S4_T1:S4*1.02,up_gap:up,down_gap:down,resonance:{P2:resonance(P2,up),P3:resonance(P3,up),S3:resonance(S3,down),S4:resonance(S4,down)},key_reminder:GAP/L*100>=2.8};
}
// Consumes captured native trades, never synthesizes crossings from cache/K closes.
function evaluate({symbol,trade_date,bar,trades=[],completedBars=[],asOf}){
 const prices=levels(bar,{symbol,trade_date,asOf}),now=Date.parse(asOf),events=[],gaps=[];
 let previous=null;const ids=new Map();
 for(const r of trades){
  const t=Date.parse(r?.event_at),seen=Date.parse(r?.received_at),x=r?.trade;
  const valid=r?.contract==='fugle_native_trade_journal_v1'&&r.stock_id===symbol&&r.trade_date===trade_date&&r.source==='Fugle.websocket.trades'&&r.is_synthetic===false&&finite(t)&&finite(seen)&&t<=seen&&seen<=now&&day(t)===trade_date&&t>=Date.parse(bar.timestamp)+60000&&t>=Date.parse(bar.available_at)&&x&&finite(x.price)&&x.price>0&&Number.isSafeInteger(x.serial)&&Number.isSafeInteger(x.time)&&Math.floor(x.time/1000)===t;
  if(!valid){gaps.push('INVALID_OR_UNAVAILABLE_TRADE');previous=null;continue;}
  const id=String(x.serial),content=digest(r.trade);
  if(ids.has(id)){if(ids.get(id)!==content){gaps.push('TRADE_SERIAL_CONFLICT');previous=null;}continue;}ids.set(id,content);
  if(previous&&(t<Date.parse(previous.event_at)||x.serial<=previous.trade.serial)){gaps.push('TRADE_ORDER_GAP');previous=null;continue;}
  if(previous){
   // Touching P2 alone is not a crossing. An exact-P2 predecessor may cross away.
   const direction=previous.trade.price<=prices.P2&&x.price>prices.P2?'long':previous.trade.price>=prices.P2&&x.price<prices.P2?'short':null;
   if(direction){
    const type=direction==='long'?'TONGZI_P2_BREAK_UP':'TONGZI_P2_BREAK_DOWN';
    const event_id=digest([trade_date,symbol,type,prices.bar_hash,previous.trade.serial,x.serial]);
    const minute=Math.floor(t/60000)*60000;
    const matches=completedBars.filter(b=>Date.parse(b.timestamp)===minute&&b.stock_id===symbol&&b.trade_date===trade_date&&b.complete===true&&b.is_synthetic===false&&Date.parse(b.available_at)<=now&&minute+60000<=now&&finite(b.close)&&b.close>0);
    const c=matches.length===1?matches[0]:null;
    events.push({module_id:'B22',type,direction,symbol,trade_date,event_id,event_timestamp:r.event_at,event_price:x.price,source_contract:CONTRACT,source_contract_ok:true,level:prices.P2,bar_hash:prices.bar_hash,previous_trade:previous,current_trade:r,confirmation:c?{status:'OBSERVED',timestamp:c.timestamp,available_at:c.available_at,close:c.close,position:c.close>prices.P2?'ABOVE':c.close<prices.P2?'BELOW':'AT',notify:false}:{status:matches.length>1?'DATA_GAP':'PENDING',notify:false}});
   }
  }
  previous=r;
 }
 return {levels:prices,events,trade_evidence_status:gaps.length?'DATA_GAP':trades.length<2?'INSUFFICIENT_TRADES':'AVAILABLE',data_gaps:[...new Set(gaps)]};
}
module.exports={CONTRACT,levels,evaluate};
