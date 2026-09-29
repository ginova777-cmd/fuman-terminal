'use strict';
const catalogue=require('./mother-pool-futures-catalogue');
function build(snapshot,tradeDate,asOf){
 const checked=catalogue.inspect(snapshot,tradeDate,asOf);
 if(checked.status!=='READY')throw Error('COLLECTOR_CATALOGUE_INVALID:'+checked.failed_checks.join('|'));
 const bySymbol=new Map(checked.mapped.map(r=>[r.future_symbol,r]));
 const rows=[];
 for(const raw of snapshot.raw_fugle.data){
  const stock=bySymbol.get(raw.symbol),txf=raw.contractType==='I'&&/^TXF[A-Z0-9]+$/.test(raw.symbol||'');
  if(!stock&&!txf)continue;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw.endDate||''))throw Error('COLLECTOR_EXPIRY_UNPROVEN');
  if(raw.endDate<tradeDate)continue;
  rows.push({future_symbol:raw.symbol,name:raw.name||raw.symbol,product:stock?'STOCK_FUTURE':'TXF',contract_type:raw.contractType,end_date:raw.endDate,exchange:raw.exchange||'TAIFEX',underlying_symbol:stock?.underlying_symbol||'TXF',underlying_name:stock?.underlying_name||'TAIEX',session:snapshot.raw_fugle.session||raw.session||'REGULAR',payload:raw});
 }
 if(!rows.some(r=>r.product==='TXF'))throw Error('COLLECTOR_TXF_CATALOGUE_MISSING');
 rows.cacheFile='futures-catalogue:'+snapshot.run_id;rows.stockLookupCount=checked.symbols.length;
 return rows;
}
module.exports={build};
