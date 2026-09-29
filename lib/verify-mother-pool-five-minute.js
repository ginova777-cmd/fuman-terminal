'use strict';
const {envelopeOk,BRANCHES}=require('./mother-pool-five-minute-producer');
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const closeEnough=(a,b)=>a===null?b===null:typeof b==='number'&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8;
function recalculate(bars){
 let segment=[],prior=null,k=50,d=50,fast=[],slow=[],signal=[],ef=null,es=null,dea=null,last;
 const ema=(values,value,period,previous)=>previous===null?(values.push(value),values.length<period?null:mean(values.slice(-period))):previous+(value-previous)*2/(period+1);
 for(const bar of bars){
  const adjacent=segment.length&&Date.parse(bar.bar_start)-Date.parse(segment.at(-1).bar_start)===300000;
  if(!adjacent){segment=[];prior=null;k=50;d=50;fast=[];slow=[];signal=[];ef=null;es=null;dea=null;}
  segment.push(bar);
  const ma=n=>segment.length<n?null:mean(segment.slice(-n).map(x=>x.close));
  const rsi=n=>{if(segment.length<=n)return null;const s=segment.slice(-n-1),diff=s.slice(1).map((b,i)=>b.close-s[i].close),gain=mean(diff.map(v=>Math.max(0,v))),loss=mean(diff.map(v=>Math.max(0,-v)));return gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);};
  let currentK=null,currentD=null;
  if(segment.length>=5){const w=segment.slice(-5),lo=Math.min(...w.map(x=>x.low)),hi=Math.max(...w.map(x=>x.high)),rsv=hi===lo?50:100*(bar.close-lo)/(hi-lo);k=(2*k+rsv)/3;d=(2*d+k)/3;currentK=k;currentD=d;}
  ef=ema(fast,bar.close,3,ef);es=ema(slow,bar.close,9,es);const dif=ef===null||es===null?null:ef-es;if(dif!==null)dea=ema(signal,dif,3,dea);
  const values={k:currentK,d:currentD,r3:rsi(3),r6:rsi(6),dif,dea,histogram:dif===null||dea===null?null:dif-dea,m5:ma(5),m10:ma(10),m20:ma(20)};
  const cross=(a,b)=>!prior||[prior[a],prior[b],values[a],values[b]].some(x=>x===null)?null:prior[a]<=prior[b]&&values[a]>values[b];
  const branches=Object.fromEntries(BRANCHES.map((name,i)=>[name,cross(...[['r3','r6'],['k','d'],['dif','dea'],['m5','m10'],['m10','m20'],['m5','m20']][i])]));
  const signals=Object.values(branches),status=signals.includes(true)?'CONFIRMED_STRONG_5M':signals.includes(null)?'DATA_GAP_5M':'WAIT_5M_CONFIRMATION';
  last={values,branches,status};prior=values;
 }
 return last;
}
function verify(row,receipt){
 try{
 const source=receipt.writer_write_set.plan.source_evidence,q=source.receipt,snapshot=source.snapshot,asOf=Date.parse(receipt.observed_at),bars=row.source_history;
 if(!envelopeOk(q,snapshot,receipt.observed_at)||snapshot.mother_pool_run_id!==receipt.mother_pool_run_id||snapshot.generation!==receipt.snapshot_generation||snapshot.snapshot_sequence!==receipt.snapshot_sequence||!snapshot.symbols.includes(row.symbol)||!q.requested_symbols.includes(row.symbol)||row.five_minute_run_id!==q.run_id||row.status!=='READY'||row.formal_candidate_allowed!==false||!Array.isArray(bars)||!bars.length)return false;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],start=Date.parse(b.bar_start),end=Date.parse(b.bar_end),local=new Date(start+28800000).toISOString();
  if(b.symbol!==row.symbol||b.trade_date!==receipt.trade_date||b.run_id!==q.run_id||b.source!=='fugle_stock_intraday_candles_timeframe_5'||b.is_synthetic!==false||b.bar_complete!==true||b.confirmation_eligible!==true||b.bar_count!==5||b.bar_kind!=='regular_session'||b.volume_available!==true||!['lots','shares'].includes(b.volume_unit)||typeof b.volume!=='number'||!Number.isFinite(b.volume)||b.volume<0)return false;
  const calculated=Date.parse(b.calculated_at),verified=Date.parse(q.verified_at);
  if(!Number.isFinite(calculated)||calculated<end||calculated>verified||verified>asOf)return false;
  if(start%300000!==0||end-start!==300000||end>asOf||local.slice(0,10)!==receipt.trade_date||local.slice(11,16)<'09:00'||local.slice(11,16)>'13:25'||i&&start<=Date.parse(bars[i-1].bar_start))return false;
  if(['open','high','low','close'].some(k=>typeof b[k]!=='number'||!Number.isFinite(b[k])||b[k]<=0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))return false;
 }
 const last=bars.at(-1),computed=recalculate(bars),v=computed.values;
 if(!require('../scripts/daytrade-intraday-5m-coverage-contract').isEffectiveRow(last,{tradeDate:receipt.trade_date,runId:q.run_id,asOfMs:asOf,maxStaleSeconds:600})||asOf-Date.parse(last.bar_end)>600000||row.bar_end!==last.bar_end||row.quality_status!==computed.status||computed.status==='DATA_GAP_5M'||row.bonus_eligible!==(computed.status==='CONFIRMED_STRONG_5M'))return false;
 if(!closeEnough(v.k,row.kd.k)||!closeEnough(v.d,row.kd.d)||!closeEnough(v.r3,row.rsi.rsi3)||!closeEnough(v.r6,row.rsi.rsi6)||!closeEnough(v.dif,row.macd.dif)||!closeEnough(v.dea,row.macd.dea)||!closeEnough(v.histogram,row.macd.histogram))return false;
 return BRANCHES.every(k=>row.branches[k]===computed.branches[k]);
 }catch{return false;}
}
module.exports={verify,recalculate};
