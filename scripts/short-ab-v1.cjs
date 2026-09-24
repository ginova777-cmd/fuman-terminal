'use strict';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const triAnd=a=>a.includes(false)?false:a.includes(null)?null:true;
const triOr=a=>a.includes(true)?true:a.includes(null)?null:false;
function evaluate(row,bars,c){
 const date=row.date,a=[...new Map(bars.filter(b=>b.trade_date<=date).map(b=>[b.trade_date,b])).values()].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
 const last=a.at(-1),current=last?.trade_date===date,close=current?number(last.close):null;
 const ret=n=>close!==null&&a.length>n&&number(a.at(-n-1).close)>0?(close/Number(a.at(-n-1).close)-1)*100:null;
 const avg=(key,n)=>{const w=a.slice(-n).map(x=>number(x[key]));return current&&w.length===n&&w.every(finite)?w.reduce((s,x)=>s+x,0)/n:null;};
 const v=number(last?.volume_lots),v5=avg('volume_lots',5),v20=avg('volume_lots',20),r3=ret(3),r5=ret(5),r1=ret(1),ratio5=finite(v)&&v5>0?v/v5:null,ratio20=finite(v)&&v20>0?v/v20:null;
 const pos=row.boll_position_raw,slope=row.ma20_slope_percent,direction=slope===null?'UNKNOWN':slope<0?'DOWN':slope>0?'UP':'FLAT';
 const compare=(v,test)=>finite(v)?test(v):null;
 const historyReturns=[0,1,2].map(offset=>{const x=a.at(-1-offset),p=a.at(-2-offset);return current&&number(x?.close)>0&&number(p?.close)>0?(Number(x.close)/Number(p.close)-1)*100:null;});
 const near2=historyReturns.slice(0,2).every(finite)?historyReturns.slice(0,2).every(v=>v>=c.near_limit_return):null;
 const near3=historyReturns.every(finite)?historyReturns.every(v=>v>=c.near_limit_return):null;
 const evidence={return_3d:compare(r3,v=>v>=c.return_3d_bands[0][0]),return_5d:compare(r5,v=>v>=c.return_5d_bands[0]),consecutive_near_limit:near2,volume_burst:compare(ratio5,v=>v>=c.volume_bands[0][0]),above_boll_upper:finite(close)&&finite(row.boll_upper)?close>row.boll_upper:null};
 const ac=triAnd([compare(pos,v=>v<c.weak_threshold),compare(slope,v=>v<0),direction==='UNKNOWN'?null:direction==='DOWN']);
 const base=triAnd([compare(pos,v=>v>=c.weak_threshold),compare(slope,v=>v>=c.overheat_slope_min)]),bc=triAnd([base,triOr(Object.values(evidence))]);
 const inst=[row.foreign?.net,row.trust?.net,row.dealer?.net];
 const conditions={monthly_slope_down:compare(slope,v=>v<0),ma20_down:direction==='UNKNOWN'?null:direction==='DOWN',daily_bearish:row.daily_trend==='UNKNOWN'?null:row.daily_trend==='BEARISH',hourly_turning_bearish:row.hourly_trend==='UNKNOWN'?null:row.hourly_trend==='TURNING_BEARISH',hourly_bearish:row.hourly_trend==='UNKNOWN'?null:row.hourly_trend==='BEARISH',ema30_bearish:row.ema30_trend==='UNKNOWN'?null:row.ema30_trend==='BEARISH',ma_resistance_failed:null,mainforce_long_sell:null,concentration_down:null,ownership_dispersing:null,institution_net_sell:inst.every(finite)?inst.reduce((s,x)=>s+x,0)<0:null,daytrade_sell_pressure:null};
 const aBreak=Object.fromEntries(Object.entries(c.a_weights).map(([k,w])=>[k,conditions[k]===null?null:conditions[k]?w:0]));
 const band=(v,bands)=>v===null?null:bands.filter(([min])=>v>=min).at(-1)?.[1]||0;
 const bBreak={position:pos===null?null:pos>12?20:pos>=10?15:pos>=8?10:0,slope:slope===null?null:slope>=2.5?20:slope>=2?15:slope>=1?10:0,return_3d:band(r3,c.return_3d_bands),volume_ratio_5:band(ratio5,c.volume_bands),...Object.fromEntries(Object.keys(c.b_weights).map(k=>[k,null]))};
 bBreak.institution_buy_to_sell=finite(row.previous_institution?.total_net)&&inst.every(finite)?row.previous_institution.total_net>0&&inst.reduce((s,x)=>s+x,0)<0?c.b_weights.institution_buy_to_sell:0:null;
 const sum=o=>Object.values(o).reduce((s,x)=>s+(x??0),0),missing=o=>Object.entries(o).filter(([,v])=>v===null).map(([k])=>k);
 return{version:'SHORT_AB_V1',skipped_conditions:c.skipped_conditions||[],short_type:ac===true?'A_WEAK_REBOUND':bc===true?'B_OVERHEATED_REVERSAL':ac===null||bc===null?'UNDETERMINED':'NONE',a_short_candidate:ac,b_overheat_base:base,b_short_candidate:bc,monthly_slope:slope,ma20_direction:direction,ma60:avg('close',60),return_1d:r1,return_3d:r3,return_5d:r5,return_3d_levels:c.return_3d_bands.map(([threshold])=>({threshold,matched:compare(r3,v=>v>=threshold)})),return_5d_levels:c.return_5d_bands.map(threshold=>({threshold,matched:compare(r5,v=>v>=threshold)})),volume_average_5:v5,volume_average_20:v20,volume_ratio_5:ratio5,volume_ratio_20:ratio20,consecutive_near_limit_2:near2,consecutive_near_limit_3:near3,consecutive_actual_limit:null,overheat_evidence:evidence,a_short_score:ac===true?sum(aBreak):null,b_short_score:bc===true?sum(bBreak):null,a_score_breakdown:aBreak,b_score_breakdown:bBreak,a_unconfirmed:missing(aBreak),b_unconfirmed:missing(bBreak),score_status:'PARTIAL',institution_definition:'當日外資+投信+自營商淨量合計<0；非連續賣超或由買轉賣',volume_definition:'含當日最近5/20日成交量平均',price_chip_divergence:null,short_entry_signal:null,a_short_trigger:null,b_short_trigger:null,entry_status:'WAITING_INTRADAY_PRICE_ACTION',open_map:null,trial_price:null,mainforce_cost:null,daytrade_cost:null,top_buy_branch_cost:row.top_buy_branch?.price??null,creates_order:false};
}
module.exports={evaluate};
