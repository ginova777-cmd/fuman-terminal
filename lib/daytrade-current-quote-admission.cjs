'use strict';
function select(rows,tradeDate){
 if(!Array.isArray(rows)||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate))throw Error('QUOTE_ADMISSION_INPUT');
 const accepted=[],rejected=[];
 for(const row of rows){
  if(typeof row?.symbol!=='string'||!row.symbol)throw Error('QUOTE_ADMISSION_SYMBOL');
  if(row.trade_date!==tradeDate){rejected.push({symbol:row.symbol,source_trade_date:row.trade_date??null,expected_trade_date:tradeDate,reason:!/^\d{4}-\d{2}-\d{2}$/.test(row.trade_date||'')?'QUOTE_SOURCE_DATE_UNPROVEN':row.trade_date<tradeDate?'QUOTE_SOURCE_PRIOR_DATE':'QUOTE_SOURCE_FUTURE_DATE'});continue;}
  accepted.push(row);
 }
 return {rows:accepted,rejected,received:rows.length,accepted:accepted.length,complete:rejected.length===0};
}
module.exports={select};
