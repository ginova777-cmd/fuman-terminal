'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function classify(slope,level){
 const zone=!finite(level)?'UNKNOWN':level>=8?'HIGH_LEVEL_RISK':level>=3?'SHORT_POSITION_A':level>=0?'SHORT_POSITION_B':level>-5?'LOW_LEVEL_WARNING':'OVERSOLD_SHORT_RISK';
 const reasons=[];if(!finite(slope)||!finite(level))reasons.push('DATA_GAP');
 if(finite(slope)&&slope>=0)reasons.push('MONTH_SLOPE_NOT_DOWN');
 if(finite(level)&&level>=8)reasons.push('HIGH_LEVEL_RISK');
 if(finite(level)&&level<=-5)reasons.push('OVERSOLD_SHORT_RISK');
 const grade=reasons.includes('DATA_GAP')?'UNKNOWN':reasons.length?'REJECT':level>=3?'A':level>=0?'B':'WATCH';
 return{short_trend_pass:finite(slope)?slope<0:null,boll_position_zone:zone,short_candidate_grade:grade,short_reject_reason:reasons.length?reasons.join('|'):null,month_trend_strength:!finite(slope)?'UNKNOWN':slope>=0?'非空方月趨勢':slope>-.3?'輕微下彎':slope>-.6?'明顯偏空':'強空趨勢'};
}
function calculate(symbol,date,bars){
 const a=[...new Map(bars.filter(x=>x.trade_date<=date).map(x=>[x.trade_date,x])).values()].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));const w=a.slice(-21),closes=w.map(x=>x.close===null||x.close===undefined||x.close===''?null:Number(x.close));
 const bases=[...new Set(w.map(x=>x.price_basis||x.adjustment||x.adjusted).filter(x=>x!==undefined&&x!==null))];
 const ready=w.length===21&&w.at(-1).trade_date===date&&closes.every(x=>finite(x)&&x>0)&&bases.length<=1;
 const avg=v=>v.reduce((s,x)=>s+x,0)/v.length;
 const today=ready?avg(closes.slice(1)):null,yesterday=ready?avg(closes.slice(0,20)):null,close=ready?closes.at(-1):null,sd=ready?Math.sqrt(avg(closes.slice(1).map(x=>(x-today)**2))):null;
 const slope=ready?(today-yesterday)/yesterday*100:null,level=ready&&sd>0?5*(close-today)/sd:null;
 const slope_history=[];
 for(let i=20;i<a.length;i++){
  const window=a.slice(i-20,i+1),values=window.map(x=>x.close===null||x.close===undefined||x.close===''?null:Number(x.close));
  const basis=[...new Set(window.map(x=>x.price_basis||x.adjustment||x.adjusted).filter(x=>x!==undefined&&x!==null))];
  const ok=values.every(x=>finite(x)&&x>0)&&basis.length<=1;
  const prev=ok?avg(values.slice(0,20)):null,now=ok?avg(values.slice(1)):null;
  slope_history.push({date:a[i].trade_date,value:ok?(now-prev)/prev*100:null});
 }
 const previous=ready&&slope_history.length>=2?slope_history.at(-2).value:null;
 const delta=finite(slope)&&finite(previous)?slope-previous:null;
 let down=delta===null?null:0;
 if(down!==null)for(let i=slope_history.length-1;i>0;i--){const x=slope_history[i].value,y=slope_history[i-1].value;if(!finite(x)||!finite(y)||x>=y)break;down++;}
 const history_fields={month_slope_yesterday:previous,slope_delta:delta,slope_down_days:down,slope_history,slope_history_status:ready&&slope_history.length>=3&&slope_history.slice(-3).every(x=>finite(x.value))?'OK':'NEED_23_VALID_DAILY_CLOSES'};
 return{...history_fields,symbol,date,close,ma20_today:today,ma20_yesterday:yesterday,month_slope_raw:slope,month_slope_display:slope===null?null:Number(slope.toFixed(1)),std20:sd,boll_upper:ready?today+2*sd:null,boll_middle:today,boll_lower:ready?today-2*sd:null,boll_level_raw:level,...classify(slope,level),source:'strategy4_daily_ohlcv_view',window_start:w[0]?.trade_date||null,ddof:0,period:20,std_multiplier:2,price_basis:bases[0]??'SOURCE_UNSPECIFIED',source_series:[...new Set(w.map(x=>x.source).filter(Boolean))],price_basis_policy:'single canonical daily source; no adjusted-price fallback; reject explicitly mixed bases',status:level===null?'DATA_GAP':'OK',data_gap_reason:ready?sd===0?'STD20_ZERO':null:bases.length>1?'MIXED_PRICE_BASIS':'NEED_21_VALID_DAILY_CLOSES_AT_SOURCE_DATE',scope:'PREMARKET_SCREEN_ONLY',short_entry_signal:null};
}
module.exports={calculate,classify};
