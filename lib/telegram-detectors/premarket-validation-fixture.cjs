'use strict';
// Synthetic test inputs only. No dependency from any operational runner.
function fixture(){
 const symbol='3450',tradeDate='2026-09-16',dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2026,6,21+i)).toISOString().slice(0,10));
 dates.push('2026-09-14','2026-09-15');const baseDate=dates.at(-1);
 const source={symbol,trade_date:tradeDate,signal_date:baseDate,fetched_at:tradeDate+'T08:50:00+08:00',price_rows:dates.map((date,i)=>({stock_id:symbol,date,open:100,max:101,min:i===35?95:99,close:100,Trading_Volume:100000})),branch_rows:[{stock_id:symbol,date:baseDate,securities_trader_id:'a',price:100,buy:100,sell:1}],institutional_rows:['Foreign_Investor','Investment_Trust','Dealer_self'].flatMap(name=>dates.slice(-4).map(date=>({stock_id:symbol,date,name,buy:0,sell:100})))};
 const trialRows=[{symbol,trade_date:tradeDate,is_trial:true,trial_price:98,observed_at:tradeDate+'T08:59:30+08:00',payload:{source:'fugle-websocket-cache:trial-event',trade_date:tradeDate,observed_at:tradeDate+'T08:59:30+08:00'}}];
 const start=Date.parse(tradeDate+'T09:28:00+08:00'),bars=Array.from({length:31},(_,i)=>({stock_id:symbol,trade_date:tradeDate,timestamp:new Date(start+i*60000).toISOString(),open:99,high:i===30?100:99,low:i===30?98:99,close:i===30?98:99,volume_raw:i===30?500:100,volume_raw_unit:'LOTS',complete:true,is_synthetic:false,timeframe:'1m'}));
 return {snapshot:{trade_date:tradeDate,symbols:[source]},trialRows,calendar:{verified:true,source:'SYNTHETIC_TEST_CALENDAR',trading_dates:[...dates,tradeDate]},symbols:[symbol],tradeDate,baseDate,asOf:tradeDate+'T09:59:00+08:00',groups:{[symbol]:bars},quotes:{},histories:{}};
}
module.exports={fixture};
