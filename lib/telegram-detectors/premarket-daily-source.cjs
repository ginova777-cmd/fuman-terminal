'use strict';
// FinMind daily rows -> explicitly versioned daily inputs. No provider writes.
const {costTopBuyer}=require('./main-broker-cost.cjs');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function ema(n){let seed=[],value=null;return x=>{if(value===null){seed.push(x);if(seed.length===n)value=seed.reduce((a,b)=>a+b,0)/n;}else value+=(x-value)*2/(n+1);return value;};}
function rsi(closes,n){if(closes.length<=n)return null;let up=0,down=0;for(let i=closes.length-n;i<closes.length;i++){const diff=closes[i]-closes[i-1];up+=Math.max(diff,0);down+=Math.max(-diff,0);}return down===0?(up===0?50:100):100-100/(1+up/down);}
function adaptDaily({source,symbol,baseDate,tradeDate,asOf}={}){
 const fail=reason=>({complete:false,reason,short_rank_input:null});
 if(!/^\d{4}$/.test(symbol||'')||!/^\d{4}-\d{2}-\d{2}$/.test(baseDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||'')||baseDate>=tradeDate)return fail('DAILY_IDENTITY_INVALID');
 if(source?.symbol!==symbol||source?.signal_date!==baseDate||source?.trade_date!==tradeDate||!Number.isFinite(Date.parse(asOf))||!Number.isFinite(Date.parse(source.fetched_at))||Date.parse(source.fetched_at)>Date.parse(asOf))return fail('DAILY_SOURCE_IDENTITY_OR_TIME');
 if(!Array.isArray(source.price_rows))return fail('DAILY_ROWS_MISSING');
 const rows=source.price_rows.filter(r=>typeof r?.date==='string'&&r.date<=baseDate).slice().sort((a,b)=>a.date.localeCompare(b.date));
 if(rows.length<29||rows.at(-1)?.date!==baseDate)return fail('DAILY_WARMUP_OR_BASE_DATE_MISSING');
 if(rows.some((r,i)=>r.stock_id!==symbol||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||[r.open,r.max,r.min,r.close].some(v=>!finite(v)||v<=0)||r.max<Math.max(r.open,r.close)||r.min>Math.min(r.open,r.close)||!finite(r.Trading_Volume)||r.Trading_Volume<0||(i&&rows[i-1].date===r.date)))return fail('DAILY_ROWS_INVALID');
 const fast=ema(5),slow=ema(9),signal=ema(20),closes=[],history=[],indicators=[];let k=50,d=50;
 for(const r of rows){
  closes.push(r.close);history.push({date:r.date,open:r.open,high:r.max,low:r.min,close:r.close,volume:r.Trading_Volume,completed:true});
  const f=fast(r.close),s=slow(r.close),dif=f===null||s===null?null:f-s,sig=dif===null?null:signal(dif);
  let kval=null,dval=null;
  if(history.length>=5){const w=history.slice(-5),hi=Math.max(...w.map(x=>x.high)),lo=Math.min(...w.map(x=>x.low));const rsv=hi===lo?50:(r.close-lo)/(hi-lo)*100;k=(2*k+rsv)/3;d=(2*d+k)/3;kval=k;dval=d;}
  indicators.push({date:r.date,timeframe:'1d',completed:true,kd:{params:[5,3,3],k:kval,d:dval},rsi:{params:[5,15],short:rsi(closes,5),long:rsi(closes,15)},macd:{params:[5,9,20],dif,signal:sig,histogram:dif===null||sig===null?null:dif-sig}});
 }
 const institutions={date:baseDate},names={Foreign_Investor:'foreign_net',Investment_Trust:'trust_net',Dealer_self:'dealer_self_net'},foreign=[];
 const institutionRows=Array.isArray(source.institutional_rows)?source.institutional_rows:[];
 for(const [name,key]of Object.entries(names)){
  const selected=institutionRows.filter(r=>r.stock_id===symbol&&r.date===baseDate&&r.name===name);
  institutions[key]=selected.length===1&&[selected[0].buy,selected[0].sell].every(v=>finite(v)&&v>=0)?selected[0].buy-selected[0].sell:null;
 }
 const lastFour=history.slice(-4).map(r=>r.date);
 for(const date of lastFour){const selected=institutionRows.filter(r=>r.stock_id===symbol&&r.date===date&&r.name==='Foreign_Investor');if(selected.length===1&&[selected[0].buy,selected[0].sell].every(v=>finite(v)&&v>=0))foreign.push({date,net:selected[0].buy-selected[0].sell});}
 const current=indicators.at(-1),previous=indicators.at(-2),priorVolumes=history.slice(-6,-1).map(r=>r.volume),avg=priorVolumes.reduce((a,b)=>a+b,0)/5;
 const cost=costTopBuyer({rows:source.branch_rows,symbol,baseDate});
 return {complete:cost.valid&&Object.values(names).every(key=>finite(institutions[key])),reason:null,source_fetched_at:source.fetched_at,calculation:{version:'daily_5_15_533_5920_v1',rsi_method:'rolling_gain_loss',kd_seed:50,ema_seed:'period_sma',histogram:'dif_minus_signal',history_count:history.length},calendar_continuity_verified:false,history,previous_ohlc:history.at(-1),cost,foreign_history:foreign,volume_ratio_excluding_today:avg>0?history.at(-1).volume/avg:null,short_rank_input:{current,previous,institutions,baseDate,previousDate:previous.date}};
}
module.exports={adaptDaily};
