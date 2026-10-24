'use strict';
const crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function verify(r,identity){try{
 const b=r.reference_bar,p=r.tongzi?.levels,now=Date.parse(identity.observed_at),t=Date.parse(b?.timestamp);
 if(r.status!=='READY'||!b||!p||b.stock_id!==r.symbol||b.trade_date!==identity.trade_date||t!==Date.parse(identity.trade_date+'T09:01:00+08:00')||b.complete!==true||b.is_synthetic!==false||!b.source||!Number.isFinite(now)||t+60000>now||!Number.isFinite(Date.parse(b.available_at))||Date.parse(b.available_at)<t||Date.parse(b.available_at)>now||!['open','high','low','close'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))return false;
 const g=b.high-b.low,expected={GAP:g,RANGE:g/b.low*100,P0:(b.high+b.low)/2,P1:b.high,P2:b.open*1.03,P3:b.open*1.05,S1:b.low,S2:b.low-g,S3:b.open*.98,S4:b.open*.96};
 Object.assign(expected,{P2_R1:expected.P2*.98,P2_R2:expected.P2*.96,P3_R1:expected.P3*.98,P3_R2:expected.P3*.96,S3_T1:expected.S3*1.02,S4_T1:expected.S4*1.02});
 if(Object.entries(expected).some(([k,v])=>p[k]!==v)||p.bar_hash!==hash(b)||p.key_reminder!==(expected.RANGE>=2.8))return false;
 const up=[1,2,3,4].map(n=>b.high+n*g),down=[1,2,3,4].map(n=>b.low-n*g);
 if(!equal(p.up_gap,up)||!equal(p.down_gap,down))return false;
 for(const k of ['P2','P3','S3','S4']){const arr=k[0]==='P'?up:down,ns=arr.flatMap((v,i)=>v>0&&Math.abs(expected[k]-v)/v<=.005?[i+1]:[]);if(!equal(p.resonance[k],ns))return false;}
 if(r.tongzi?.trade_evidence_status!=='AVAILABLE'||!Array.isArray(r.trade_evidence)||new Set(r.trade_evidence.map(q=>q.trade?.serial)).size<2)return false;
 // Independently inspect each crossing's two original trades and causality.
 if(r.tongzi.data_gaps.length)return false;
 const expectedIds=[],serials=new Map();let previous=null;
 for(const q of r.trade_evidence){
  const qt=Date.parse(q.event_at),seen=Date.parse(q.received_at),x=q.trade;
  if(q.contract!=='fugle_native_trade_journal_v1'||q.stock_id!==r.symbol||q.trade_date!==identity.trade_date||q.source!=='Fugle.websocket.trades'||q.is_synthetic!==false||!Number.isFinite(qt)||!Number.isFinite(seen)||seen<qt||seen>now||qt<t+60000||qt<Date.parse(b.available_at)||!Number.isSafeInteger(x?.serial)||!Number.isSafeInteger(x?.time)||Math.floor(x.time/1000)!==qt||!(x.price>0)||!Number.isFinite(x.price))return false;
  if(serials.has(x.serial)){if(serials.get(x.serial)!==hash(x))return false;continue;}serials.set(x.serial,hash(x));
  if(previous){if(qt<Date.parse(previous.event_at)||x.serial<=previous.trade.serial)return false;
   const up=previous.trade.price<=expected.P2&&x.price>expected.P2,down=previous.trade.price>=expected.P2&&x.price<expected.P2;
   if(up||down)expectedIds.push(hash([identity.trade_date,r.symbol,up?'TONGZI_P2_BREAK_UP':'TONGZI_P2_BREAK_DOWN',p.bar_hash,previous.trade.serial,x.serial]));
  }previous=q;
 }
 if(!equal(expectedIds,r.tongzi.events.map(e=>e.event_id)))return false;
 const ids=new Set();
 for(const e of r.tongzi.events){const a=e.previous_trade,c=e.current_trade,at=Date.parse(a?.event_at),ct=Date.parse(c?.event_at);
  for(const q of [a,c])if(!r.trade_evidence.some(x=>equal(x,q))||q.stock_id!==r.symbol||q.trade_date!==identity.trade_date||q.source!=='Fugle.websocket.trades'||q.is_synthetic!==false||q.contract!=='fugle_native_trade_journal_v1'||!Number.isSafeInteger(q.trade?.serial)||!Number.isSafeInteger(q.trade?.time)||Math.floor(q.trade.time/1000)!==Date.parse(q.event_at)||!Number.isFinite(Date.parse(q.received_at))||Date.parse(q.received_at)>now||Date.parse(q.received_at)<Date.parse(q.event_at))return false;
  if(ct<at||at<t+60000||at<Date.parse(b.available_at)||c.trade.serial<=a.trade.serial||e.event_timestamp!==c.event_at||e.event_price!==c.trade.price||e.level!==expected.P2||e.bar_hash!==p.bar_hash)return false;
  const dir=a.trade.price<=expected.P2&&c.trade.price>expected.P2?'long':a.trade.price>=expected.P2&&c.trade.price<expected.P2?'short':null;
  const type=dir==='long'?'TONGZI_P2_BREAK_UP':'TONGZI_P2_BREAK_DOWN';
  if(!dir||e.direction!==dir||e.type!==type||e.event_id!==hash([identity.trade_date,r.symbol,type,p.bar_hash,a.trade.serial,c.trade.serial])||ids.has(e.event_id))return false;ids.add(e.event_id);
  if(e.confirmation?.notify!==false)return false;
  if(e.confirmation.status==='OBSERVED'){const minute=Math.floor(ct/60000)*60000,cs=r.completed_bars.filter(x=>Date.parse(x.timestamp)===minute&&x.stock_id===r.symbol&&x.trade_date===identity.trade_date&&x.complete===true&&x.is_synthetic===false&&Date.parse(x.available_at)<=now&&minute+60000<=now);if(cs.length!==1||e.confirmation.close!==cs[0].close||e.confirmation.position!==(cs[0].close>expected.P2?'ABOVE':cs[0].close<expected.P2?'BELOW':'AT'))return false;}
 }
 return true;
}catch{return false;}}
module.exports={verify};
