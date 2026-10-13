'use strict';
const {read}=require('./mother-pool-trade-journal-reader');
// Isolated Writer input boundary. Full bounded reread retains cross-round pairs;
// there is no volatile cursor to advance before a successful module commit.
async function collect({root,symbols,tradeDate,asOf,maxTotalBytes,maxTotalRows,maxSymbols,maxElapsedMs}){
 for(const x of [maxTotalBytes,maxTotalRows,maxSymbols,maxElapsedMs])if(!Number.isSafeInteger(x)||x<1)throw Error('TRADE_INPUT_BUDGET_REQUIRED');
 if(!Array.isArray(symbols)||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^\d{4}$/.test(s)))throw Error('TRADE_INPUT_SYMBOLS');
 const started=performance.now(),tradesBySymbol={},receipts={},gaps={};let bytes=0,rows=0;
 for(const symbol of symbols){
  if(symbols.length>maxSymbols||bytes>=maxTotalBytes||rows>=maxTotalRows||performance.now()-started>=maxElapsedMs){gaps[symbol]='TRADE_INPUT_ROUND_BUDGET';continue;}
  const r=await read({root,symbol,tradeDate,asOf,maxBytes:maxTotalBytes-bytes,maxRows:maxTotalRows-rows});
  if(!r.complete){gaps[symbol]=r.reason;for(const rest of symbols.slice(symbols.indexOf(symbol)+1))gaps[rest]='TRADE_INPUT_STOP_AFTER_READ_FAILURE';break;}
  bytes+=r.bytes;rows+=r.scanned_rows;
  if(performance.now()-started>=maxElapsedMs){gaps[symbol]='TRADE_INPUT_TIME_BUDGET';continue;}
  // Do not feed pre-reference trades to a P2 crossing evaluator.
  tradesBySymbol[symbol]=r.rows.filter(x=>Date.parse(x.event_at)>=Date.parse(tradeDate+'T09:02:00+08:00'));
  receipts[symbol]=r;
 }
 return {tradesBySymbol,receipts,gaps,resources:{bytes,rows,elapsed_ms:performance.now()-started},continuity_verified:false};
}
module.exports={collect};
