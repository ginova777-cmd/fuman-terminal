'use strict';
// Independent arithmetic for final B15 values, without importing the producer/calculator.
function verify(row,receipt){try{
 const bars=row.source_history,now=Date.parse(receipt.observed_at);if(row.status!=='READY'||row.timeframe!=='1m'||!Array.isArray(bars)||bars.length<28||row.parameters?.rsi?.join()!=='5,15'||row.parameters?.macd?.join()!=='5,9,20'||row.parameters?.kd?.join()!=='5,3,3')return false;
 let close=[],high=[],low=[],k=50,d=50,ef=null,es=null,signal=null,difs=[],last=null;
 for(const b of bars){const t=Date.parse(b.timestamp);if(b.stock_id!==row.symbol||b.trade_date!==receipt.trade_date||!Number.isFinite(t)||t%60000||b.complete!==true||b.is_synthetic!==false||t+60000>now||Date.parse(b.available_at)>now||!['open','high','low','close'].every(x=>typeof b[x]==='number'&&Number.isFinite(b[x])&&b[x]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))return false;
  if(last!==null&&t-last!==60000){close=[];high=[];low=[];k=50;d=50;ef=null;es=null;signal=null;difs=[];}last=t;close.push(b.close);high.push(b.high);low.push(b.low);
  const n=close.length;if(n===5)ef=close.reduce((a,b)=>a+b,0)/5;else if(n>5)ef+=(b.close-ef)/3;
  if(n===9)es=close.reduce((a,b)=>a+b,0)/9;else if(n>9)es+=(b.close-es)/5;
  if(n>=9){difs.push(ef-es);if(difs.length===20)signal=difs.reduce((a,b)=>a+b,0)/20;else if(difs.length>20)signal+=2/21*(ef-es-signal);}
  if(n>=5){const hi=Math.max(...high.slice(-5)),lo=Math.min(...low.slice(-5));k=(2*k+(hi===lo?50:100*(b.close-lo)/(hi-lo)))/3;d=(2*d+k)/3;}
 }
 if(close.length<28||now-last>120000||row.event_time!==bars.at(-1).timestamp)return false;
 const rsi=p=>{let gain=0,loss=0;for(let i=close.length-p;i<close.length;i++){const c=close[i]-close[i-1];gain+=Math.max(c,0);loss+=Math.max(-c,0);}return loss===0?(gain===0?50:100):100-100/(1+gain/loss);};
 return [[row.kd.k,k],[row.kd.d,d],[row.rsi.rsi5,rsi(5)],[row.rsi.rsi15,rsi(15)],[row.macd.dif,ef-es],[row.macd.signal,signal]].every(([a,b])=>typeof a==='number'&&Number.isFinite(a)&&Math.abs(a-b)<1e-9);
}catch{return false;}}
module.exports={verify};
