'use strict';
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
function build(row,daybar,opening=null){
 const confirmed=opening?.kind==='ACTUAL_OPEN'&&opening.symbol===row.symbol&&opening.trade_date>row.date&&finite(opening.price)&&Number.isFinite(Date.parse(opening.observed_at))&&Date.parse(opening.observed_at)>=Date.parse(opening.trade_date+'T09:00:00+08:00')&&Date.parse(opening.observed_at)<Date.parse(opening.trade_date+'T14:00:00+08:00');
 const o=confirmed?opening.price:null;
 return{status:confirmed?'OPEN_CONFIRMED':'WAITING_ACTUAL_OPEN',source_date:row.date,trade_date:confirmed?opening.trade_date:null,open:o,open_minus_2:o===null?null:o*.98,open_minus_4:o===null?null:o*.96,open_plus_2:o===null?null:o*1.02,open_plus_3:o===null?null:o*1.03,previous_close:row.close,previous_high:daybar?.trade_date===row.date?Number(daybar.high):null,previous_low:daybar?.trade_date===row.date?Number(daybar.low):null,flat_reference:null,flat_reference_reason:'須由T日來源提供除權息等調整後參考價',ma5:row.daily_metrics.ma5,ma10:row.daily_metrics.ma10,ma20:row.daily_metrics.ma20,top_buy_branch_cost:row.top_buy_branch?.price??null,mainforce_cost:null,daytrade_cost:null,hourly_resistance:null,trial_price:opening?.kind==='TRIAL'&&finite(opening.price)?opening.price:null,short_entry_signal:null};
}
module.exports={build};
