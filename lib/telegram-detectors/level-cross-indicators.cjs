'use strict';
// Pure calculation only. No source fetching, notification or order side effects.
const PARAMETERS=Object.freeze({timeframe:'1m',rsi:[5,15],rsi_method:'rolling-gain-loss',kd:[5,3,3],kd_seed:50,macd:[5,9,20],ema_seed:'period_sma',cross_mode:'any',following_minutes:3,include_touch_bar:true});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const taipeiDate=ms=>new Date(ms+28800000).toISOString().slice(0,10);
function ema(period){let seed=[],value=null;return x=>{if(value===null){seed.push(x);if(seed.length===period)value=seed.reduce((a,b)=>a+b,0)/period;}else value+=2/(period+1)*(x-value);return value;};}
function rsi(closes,period){if(closes.length<=period)return null;let gain=0,loss=0;for(let i=closes.length-period;i<closes.length;i++){const d=closes[i]-closes[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}return loss===0?(gain===0?50:100):100-100/(1+gain/loss);}
function crosses(previous,current){
 const golden=[],death=[];
 for(const [name,a,b]of [['RSI','rsi5','rsi15'],['KD','k','d'],['MACD','dif','signal']]){
  if(!previous||![previous[a],previous[b],current[a],current[b]].every(finite))continue;
  if(previous[a]<=previous[b]&&current[a]>current[b])golden.push(name);
  if(previous[a]>=previous[b]&&current[a]<current[b])death.push(name);
 }
 return {golden,death};
}
function calculate({bars,stock_id,trade_date,as_of}){
 const end=Date.parse(as_of);if(!Number.isFinite(end))throw Error('AS_OF_REQUIRED');
 if(!Array.isArray(bars)||!stock_id||!/^\d{4}-\d{2}-\d{2}$/.test(trade_date))throw Error('IDENTITY_REQUIRED');
 const sorted=[...bars].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
 const rows=[],seen=new Set();let segment=[],previous=null,last=null,k=50,d=50,fast=ema(5),slow=ema(9),signal=ema(20);
 const reset=()=>{segment=[];previous=null;k=50;d=50;fast=ema(5);slow=ema(9);signal=ema(20);};
 for(const b of sorted){
  const t=Date.parse(b.timestamp);
  if(!Number.isFinite(t)||t%60000||!/(Z|[+-]\d{2}:\d{2})$/.test(b.timestamp)||seen.has(t))throw Error('INVALID_OR_DUPLICATE_MINUTE');seen.add(t);
  if(b.stock_id!==stock_id||b.trade_date!==trade_date||taipeiDate(t)!==trade_date)throw Error('BAR_IDENTITY_MISMATCH');
  const minute=new Date(t+28800000).toISOString().slice(11,16);
  const reasons=[];
  if(minute<'09:00'||minute>'13:30')reasons.push('OUTSIDE_SESSION');
  if(b.complete!==true||t+60000>end)reasons.push('INCOMPLETE_BAR');
  if(b.is_synthetic!==false)reasons.push('NON_NATURAL_BAR');
  if(b.timeframe!=null&&b.timeframe!=='1m')reasons.push('ONE_MINUTE_REQUIRED');
  if(!['open','high','low','close'].every(p=>finite(b[p])&&b[p]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.high<b.low)reasons.push('INVALID_OHLC');
  if(b.available_at!=null&&(!Number.isFinite(Date.parse(b.available_at))||Date.parse(b.available_at)>end))reasons.push('NOT_AVAILABLE_AS_OF');
  const gap=last!==null&&t-last!==60000;
  if(gap||reasons.length)reset();last=t;
  if(reasons.length){rows.push({timestamp:b.timestamp,valid:false,reasons,golden:[],death:[]});continue;}
  segment.push(b);const closes=segment.map(x=>x.close),f=fast(b.close),s=slow(b.close),dif=f!==null&&s!==null?f-s:null;
  const values={rsi5:rsi(closes,5),rsi15:rsi(closes,15),k:null,d:null,dif,signal:dif===null?null:signal(dif)};
  if(segment.length>=5){const w=segment.slice(-5),hi=Math.max(...w.map(x=>x.high)),lo=Math.min(...w.map(x=>x.low));const rsv=hi===lo?50:100*(b.close-lo)/(hi-lo);k=(2*k+rsv)/3;d=(2*d+k)/3;values.k=k;values.d=d;}
  rows.push({timestamp:b.timestamp,stock_id,trade_date,candle_timeframe:'1m',valid:true,reasons:gap?['GAP_RESTARTED_WARMUP']:[],values,...crosses(previous,values),available_indicators:[['RSI','rsi5','rsi15'],['KD','k','d'],['MACD','dif','signal']].filter(([,a,c])=>finite(values[a])&&finite(values[c])).map(([name])=>name)});
  previous=values;
 }
 return {contract:'intraday_level_cross_indicators_v1',parameters:PARAMETERS,stock_id,trade_date,as_of,rows};
}
function withinWindow(touch,cross){const a=Date.parse(touch),b=Date.parse(cross);return Number.isFinite(a)&&Number.isFinite(b)&&a%60000===0&&b%60000===0&&taipeiDate(a)===taipeiDate(b)&&b>=a&&b-a<=3*60000;}
function levels({cost,open,previous_close,previous_low}){
 const valid=x=>finite(x)&&x>0,make=(id,direction,value,source)=>({id,direction,price:valid(value)?value:null,status:valid(value)?'ready':'source_missing',source});
 return [make('P1','short',cost,'previous_top_net_buy_branch_cost'),make('P2','short',valid(cost)?cost*1.03:null,'previous_top_net_buy_branch_cost'),make('P3','short',valid(cost)?cost*1.05:null,'previous_top_net_buy_branch_cost'),make('P4','short',valid(open)?open*1.03:null,'actual_today_open'),make('P5','short',valid(open)?open*1.05:null,'actual_today_open'),make('S1','long',previous_close,'previous_close'),make('S2','long',previous_low,'previous_low'),make('S3','long',cost,'previous_top_net_buy_branch_cost'),make('S4','long',valid(open)?open*.98:null,'actual_today_open'),make('S5','long',valid(open)?open*.95:null,'actual_today_open')];
}
module.exports={PARAMETERS,calculate,crosses,withinWindow,levels};
