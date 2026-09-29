'use strict';
// This parser is intentionally tied to the official 14-column stockLists table.
// Layout changes and duplicate product codes fail closed, rather than guessing.
const text=value=>value.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
function parse(html){
 if(!html.includes('證券代號')||!html.includes('股票期貨'))throw Error('TAIFEX_HEADER_INVALID');
 const rows=[],seen=new Set();
 for(const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1]));
  if(!/^[A-Z0-9]{2}$/.test(cells[0]||''))continue;
  if(cells.length!==14||!/^\d{4,6}[A-Z]?$/.test(cells[2])||seen.has(cells[0]))throw Error('TAIFEX_ROW_INVALID_OR_DUPLICATE');
  seen.add(cells[0]);
  const future=/●/.test(cells[4]),common=/◎/.test(cells[7]+cells[8]),etf=/◎/.test(cells[9]+cells[10]);
  if(common&&etf)throw Error('TAIFEX_CLASSIFICATION_CONFLICT');
  rows.push({product_code:cells[0],symbol:cells[2],name:cells[3],stock_future:future,common_stock:common,is_etf:etf});
 }
 if(!rows.length)throw Error('TAIFEX_MAPPING_EMPTY');return rows;
}
function map(tickers,mapping,date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Array.isArray(tickers))throw Error('FUTURES_MAPPING_INPUT_INVALID');
 const byCode=new Map(mapping.map(row=>[row.product_code,row]));if(byCode.size!==mapping.length)throw Error('TAIFEX_DUPLICATE_PRODUCT');
 const mapped=[],excluded=[],gaps=[];const seen=new Set();
 for(const ticker of tickers){
  if(ticker.contractType!=='S')continue;
  if(typeof ticker.symbol!=='string'||seen.has(ticker.symbol)){gaps.push({symbol:ticker.symbol,reason:'DUPLICATE_OR_INVALID_CONTRACT'});continue;}seen.add(ticker.symbol);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(ticker.endDate||'')){gaps.push({symbol:ticker.symbol,reason:'EXPIRY_UNPROVEN'});continue;}
  if(ticker.endDate<date){excluded.push({symbol:ticker.symbol,reason:'EXPIRED'});continue;}
  const entry=byCode.get(ticker.symbol.slice(0,2));
  if(!entry||!entry.stock_future){gaps.push({symbol:ticker.symbol,reason:'OFFICIAL_PRODUCT_MAPPING_MISSING'});continue;}
  if(entry.is_etf){excluded.push({symbol:ticker.symbol,reason:'ETF_OUTSIDE_COMMON_STOCK_SCOPE'});continue;}
  if(!entry.common_stock||!/^\d{4}$/.test(entry.symbol)){gaps.push({symbol:ticker.symbol,reason:'COMMON_STOCK_CLASSIFICATION_UNPROVEN'});continue;}
  mapped.push({future_symbol:ticker.symbol,underlying_symbol:entry.symbol,underlying_name:entry.name,product_code:entry.product_code,end_date:ticker.endDate});
 }
 return {mapped,excluded,gaps,symbols:[...new Set(mapped.map(r=>r.underlying_symbol))].sort(),complete:gaps.length===0&&mapped.length>0};
}
module.exports={parse,map};
