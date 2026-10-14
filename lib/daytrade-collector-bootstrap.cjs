'use strict';
function publish({apply,dryRun,calendar,tradeDate,canonicalRunId,leaseValid,rows,write}) {
  if(!apply||dryRun)return {status:'READ_ONLY',written:false};
  if(calendar?.trade_date!==tradeDate||calendar?.is_open!==true) return {status:'CALENDAR_NOT_OPEN',written:false};
  if(!leaseValid())throw Error('COLLECTOR_BOOTSTRAP_LEASE_INVALID');
  if(!Array.isArray(rows)||!rows.length)throw Error('COLLECTOR_BOOTSTRAP_EMPTY_UNIVERSE');
  const symbols=[...new Set(rows.map(row=>String(row.symbol||'')))];
  if(symbols.some(symbol=>!/^\d{4}$/.test(symbol)))throw Error('COLLECTOR_BOOTSTRAP_INVALID_SYMBOL');
  write(symbols,{source:'daytrade-active-universe-bootstrap',tradeDate,canonicalRunId});
  return {status:'COLLECTOR_UNIVERSE_PUBLISHED',written:true,count:symbols.length,trade_date:tradeDate};
}
module.exports={publish};
