'use strict';
const {createHash}=require('node:crypto');
const digest=row=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
// In-memory, one existing Writer batch only. No persisted checkpoint is trusted
// across restarts or identities; acknowledge is called after actual HTTP success.
function createLedger({tradeDate,writerRunId,target,maxSymbols=2000,enforceEventOrder=false}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||'')||!writerRunId||!target||!Number.isInteger(maxSymbols)||maxSymbols<1||maxSymbols>2000)throw Error('QUOTE_LEDGER_IDENTITY_INVALID');
 const entries=new Map();
 function identify(rows){
  if(!Array.isArray(rows)||rows.length>maxSymbols)throw Error('QUOTE_LEDGER_ROW_LIMIT');
  const seen=new Set();return rows.map(row=>{
   if(!row||typeof row.symbol!=='string'||!/^\d{4}$/.test(row.symbol)||row.trade_date!==tradeDate||seen.has(row.symbol))throw Error('QUOTE_LEDGER_ROW_IDENTITY');
   if(enforceEventOrder){
    const current=Date.parse(row.quote_seen_at),trade=Date.parse(row.last_trade_time);
    if(!Number.isFinite(current)||(row.last_trade_time!=null&&!Number.isFinite(trade))||trade>current)throw Error('QUOTE_LEDGER_EVENT_TIME_INVALID');
    const saved=entries.get(row.symbol)?.row;
    if(saved&&(current<Date.parse(saved.quote_seen_at)||(Number.isFinite(Date.parse(saved.last_trade_time))&&(!Number.isFinite(trade)||trade<Date.parse(saved.last_trade_time)))))throw Error('QUOTE_LEDGER_EVENT_REGRESSION');
   }
   seen.add(row.symbol);return {row:structuredClone(row),hash:digest(row)};
  });
 }
 return {
  select(rows){const values=identify(rows),pending=[],acknowledged=[];
   for(const item of values){const saved=entries.get(item.row.symbol);if(saved?.row_sha256===item.hash)acknowledged.push(structuredClone(saved));else pending.push(item.row);}
   return {pending,acknowledged,requested_count:values.length};
  },
  acknowledge(rows,at){
   if(!Number.isFinite(Date.parse(at)))throw Error('QUOTE_LEDGER_ACK_TIME_INVALID');
   const values=identify(rows),newSymbols=values.filter(x=>!entries.has(x.row.symbol));
   if(entries.size+newSymbols.length>maxSymbols)throw Error('QUOTE_LEDGER_CAPACITY');
   for(const item of values){const old=entries.get(item.row.symbol);if(old&&Date.parse(at)<Date.parse(old.write_completed_at))throw Error('QUOTE_LEDGER_ACK_REGRESSION');}
   for(const item of values)entries.set(item.row.symbol,{contract:'mother-quote-write-ack-v1',symbol:item.row.symbol,trade_date:tradeDate,writer_run_id:writerRunId,target,row:item.row,row_sha256:item.hash,write_completed_at:at});
  },
 };
}
module.exports={createLedger};
