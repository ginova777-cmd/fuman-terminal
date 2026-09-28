'use strict';
const ID='L_INSTITUTION_BUY_2_5_TOP_20';
const groups=['Foreign_Investor','Investment_Trust','Dealer_self','Dealer_Hedging'];
function assess({symbol,baseDate,dates,rows,previous}){
 const days=[...new Set(dates||[])].filter(d=>d<=baseDate).sort().slice(-6),issues=[];
 if(days.length!==6||days.at(-1)!==baseDate)issues.push('SIX_TRADING_DAYS_REQUIRED');
 const buys=days.map(date=>{let total=0;for(const name of groups){const a=(rows||[]).filter(r=>r.stock_id===symbol&&r.date===date&&r.name===name);if(a.length!==1||!Number.isFinite(a[0].buy)||a[0].buy<0){issues.push('BUY_SOURCE_MISSING_OR_DUPLICATE:'+date+':'+name);return {date,buy:null};}total+=a[0].buy;}return {date,buy:total};});
 const mean=buys.length===6&&buys.every(r=>r.buy!==null)?buys.slice(0,5).reduce((s,r)=>s+r.buy,0)/5:null;
 const ratio=mean>0?buys[5].buy/mean:null;if(mean===0)issues.push('ZERO_BUY_BASELINE');
 const valid=previous?.date===baseDate&&['high','low','close'].every(k=>Number.isFinite(previous[k]))&&previous.high>previous.low&&previous.close>=previous.low&&previous.close<=previous.high;
 const position=valid?(previous.close-previous.low)/(previous.high-previous.low):null;if(!valid)issues.push('INVALID_OR_ZERO_PRICE_RANGE');
 const checks={buy_ratio_2_5:ratio===null?null:buys[5].buy>=mean*2.5,close_top_20:position===null?null:previous.close>=previous.low+(previous.high-previous.low)*.8};
 const matched=Object.values(checks).every(x=>x===true);
 return {id:ID,status:Object.values(checks).includes(null)?'insufficient_data':matched?'matched':'not_matched',matched,score_increment:matched?1:0,buy_ratio:ratio,previous_five_buy_mean:mean,base_buy:buys.at(-1)?.buy??null,close_position:position,checks,source_days:buys,issues,formal_order_allowed:false};
}
function deduplicate(rows){const seen=new Map(),out=[];let removed=0;for(const row of rows){if(seen.has(row.date)){if(JSON.stringify(seen.get(row.date))!==JSON.stringify(row))throw Error('CONFLICTING_DAILY_DUPLICATE:'+row.date);removed++;}else{seen.set(row.date,row);out.push(row);}}return {rows:out,removed};}
function volumeRisk(rows,baseDate){const last=rows.filter(r=>r.date<=baseDate).sort((a,b)=>a.date.localeCompare(b.date)).slice(-5),vol=r=>Number.isFinite(r.volume_shares)?r.volume_shares:Number.isFinite(r.volume_lots)?r.volume_lots*1000:r.volumeUnit==='lots'?r.volume*1000:r.volume;
 if(last.length!==5||last.at(-1).date!==baseDate||!last.every(r=>Number.isFinite(vol(r))&&vol(r)>=0))return {ratio:null,threshold_met:null,score_increment:0};const mean=last.reduce((s,r)=>s+vol(r),0)/5,ratio=mean>0?vol(last.at(-1))/mean:null;return {ratio,threshold_met:ratio===null?null:ratio>=2.5,includes_base_day:true,score_increment:0,scope:'volume_risk_input_only_not_stagnation_verdict'};}
module.exports={ID,assess,deduplicate,volumeRisk};
