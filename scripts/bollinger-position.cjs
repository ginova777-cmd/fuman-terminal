'use strict';
// Our own reproducible implementation; no claim of third-party equivalence.
const defaults={period:20,std_multiplier:2,weak_threshold:8};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function config(input={}){const c={...defaults,...input};if(!Number.isInteger(c.period)||c.period<2||!finite(c.std_multiplier)||c.std_multiplier<=0||!finite(c.weak_threshold))throw Error('INVALID_BOLLINGER_CONFIG');return c;}
function position(close,average,sd,multiplier=2){return [close,average,sd,multiplier].every(finite)&&sd>0&&multiplier>0?10*(close-average)/(multiplier*sd):null;}
function round(v){return v===null?null:Math.sign(v)*Math.round(Math.abs(v));}
function zone(v){return v===null?null:v<1?'VERY_WEAK_LOW':v<4?'WEAK':v<7?'WEAK_REBOUND':v<8?'NEAR_STRONG':'STRONG';}
function calculate(bars,date,input={}){
 const c=config(input),p=c.period;
 const a=[...new Map(bars.filter(b=>b.trade_date<=date).map(b=>[b.trade_date,b])).values()].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
 const last=a.at(-1),current=last?.trade_date===date,closes=a.map(b=>b.close===null||b.close===undefined||b.close===''?null:Number(b.close));
 const avg=offset=>{const end=closes.length-offset,w=closes.slice(Math.max(0,end-p),end);return current&&end>=p&&w.every(v=>finite(v)&&v>0)?mean(w):null;};
 const m=avg(0),prev=avg(1),ago5=avg(5),close=current&&finite(closes.at(-1))?closes.at(-1):null;
 const sd=m===null?null:Math.sqrt(mean(closes.slice(-p).map(v=>(v-m)**2))),raw=position(close,m,sd,c.std_multiplier);
 const s1=m!==null&&prev!==null?m-prev:null,s5=m!==null&&ago5!==null?(m-ago5)/5:null;
 const trend=s1===null||s5===null?'UNKNOWN':s1<0&&s5<0?'DOWN':s1>0&&s5>0?'UP':'FLAT_OR_MIXED';
 const weak=raw===null?null:raw<c.weak_threshold,known=raw!==null&&trend!=='UNKNOWN';
 const priority=raw===null?'UNKNOWN':!weak?'EXCLUDE':trend==='UNKNOWN'?'UNKNOWN':trend!=='DOWN'?'NONE':raw<1?'WAIT_REBOUND':raw<4?'MEDIUM':raw<7?'HIGH':raw<8?'CAUTION':'NONE';
 return {symbol:last?.symbol||null,date,close,ma20:m,std20:sd,boll_upper:sd===null?null:m+c.std_multiplier*sd,boll_middle:m,boll_lower:sd===null?null:m-c.std_multiplier*sd,boll_position_raw:raw,boll_position_display:round(raw),position_status:raw===null?'UNKNOWN':weak?'WEAK':'STRONG',position_zone:zone(raw),ma20_slope_1d:s1,ma20_slope_5d:s5,ma20_trend:trend,short_boll_candidate:known?weak&&trend==='DOWN':null,short_rebound_priority:priority,parameters:c,history_count:a.length,window_start:a.slice(-p)[0]?.trade_date||null,source:'supabase:strategy4_daily_ohlcv_view',status:known?'OK':'DATA_GAP',reason:!current?'資料日期不符':m===null?`不足${p}筆有效收盤價`:sd===0?'標準差為0':trend==='UNKNOWN'?`月線方向需${p+5}筆有效收盤價`:null,short_entry_signal:null,entry_status:'WAITING_INTRADAY_CONFIRMATION',creates_order:false};
}
function openingLevels(open){if(!finite(open)||open<=0)return null;return{open_price:open,open_minus_2:open*.98,open_minus_4:open*.96,open_plus_2:open*1.02,open_plus_3:open*1.03,target_1:open*.98,target_2:open*.96};}
module.exports={defaults,config,position,round,zone,calculate,openingLevels};
