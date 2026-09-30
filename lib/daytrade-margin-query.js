'use strict';
async function query({tradeDate,resolveDay}){
 const calendar=await require('./mother-pool-historical-sessions').selectSessions({tradeDate,resolveDay});
 const dates=require('./mother-pool-daily-volume-baseline').datesFromCalendar(calendar,tradeDate,5);
 return 'select=symbol,trade_date,margin_balance,short_balance,updated_at&trade_date=in.('+dates.join(',')+')&order=trade_date.desc,symbol.asc';
}
module.exports={query};
