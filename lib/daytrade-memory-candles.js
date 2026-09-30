'use strict';
// One current-session candle per symbol/minute. No tick history and no I/O.
function createMemoryCandles({tradeDate,symbols,buildIndicators,now=Date.now,maxBarsPerSymbol=300}){
 const universe=new Set(symbols),rows=new Map(),gaps=new Map(),slotCounts=new Map();let revision=0,cached=null,cachedKey='',historicalRows=[],historicalGaps=[],historySeeded=false;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||universe.size!==symbols.length||!symbols.length||symbols.some(s=>!/^\d{4}$/.test(s)))throw Error('MEMORY_CANDLE_UNIVERSE_INVALID');
 function ingest(batch){
  if(!Array.isArray(batch)||batch.length>universe.size*maxBarsPerSymbol)throw Error('MEMORY_CANDLE_BATCH_INVALID');
  const updates=new Map(),counts=new Map(slotCounts);
  for(const raw of batch){
   const symbol=String(raw.symbol||raw.code||''),time=Date.parse(raw.candle_time||raw.candleTime||raw.date||'');
   if(!universe.has(symbol)||!Number.isFinite(time)||time%60000!==0||time>now()||new Date(time+28800000).toISOString().slice(0,10)!==tradeDate)throw Error('MEMORY_CANDLE_IDENTITY_INVALID');
   let reason=null;
   if(raw.synthetic!==false||raw.volumeStrategyUsable===false||raw.volume_strategy_usable===false)reason='MEMORY_CANDLE_NOT_NATURAL_OR_USABLE';
   if(['open','high','low','close','volume'].some(k=>raw[k]===null||raw[k]===undefined||raw[k]===''||typeof raw[k]==='boolean'||!Number.isFinite(Number(raw[k]))))reason=reason||'MEMORY_CANDLE_VALUES_INVALID';
   const row={symbol,trade_date:tradeDate,candle_time:new Date(time).toISOString(),open:Number(raw.open),high:Number(raw.high),low:Number(raw.low),close:Number(raw.close),volume:Number(raw.volume),synthetic:false};
   if(row.low<=0||row.volume<0||row.low>Math.min(row.open,row.close)||row.high<Math.max(row.open,row.close)||row.high<row.low)reason=reason||'MEMORY_CANDLE_OHLC_INVALID';
   const key=symbol+'|'+row.candle_time;
   if(!rows.has(key)&&!gaps.has(key)&&!updates.has(key))counts.set(symbol,(counts.get(symbol)||0)+1);
   if(counts.get(symbol)>maxBarsPerSymbol)throw Error('MEMORY_CANDLE_CAPACITY_EXCEEDED');
   updates.set(key,reason?{gap:{symbol,candle_time:row.candle_time,reason}}:{row});
  }
  // Identity/capacity failures reject the whole batch above. Data-quality gaps
  // are per symbol/minute: invalidate that bar, not the entire market feed.
  for(const [key,update] of updates){
   if(update.gap){if(rows.has(key)||JSON.stringify(gaps.get(key))!==JSON.stringify(update.gap)){rows.delete(key);gaps.set(key,update.gap);revision++;}}
   else if(gaps.has(key)||JSON.stringify(rows.get(key))!==JSON.stringify(update.row)){gaps.delete(key);rows.set(key,update.row);revision++;}
  }
  slotCounts.clear();for(const [symbol,count]of counts)slotCounts.set(symbol,count);
 }
 function read(){
  const ms=now(),key=revision+':'+Math.floor(ms/60000);
  if(cachedKey!==key){
   const completed=[...historicalRows,...rows.values()].filter(r=>Date.parse(r.candle_time)+60000<=ms).sort((a,b)=>Date.parse(b.candle_time)-Date.parse(a.candle_time)||a.symbol.localeCompare(b.symbol));
   cached=buildIndicators(completed,tradeDate);if(!(cached instanceof Map))throw Error('MEMORY_CANDLE_INDICATORS_INVALID');cachedKey=key;
  }
  // Recompute age even when prices did not change; cache liveness is not market freshness.
  const result=new Map([...cached].map(([s,r])=>[s,{...r,latest_candle_age_seconds:Math.floor((ms-Date.parse(r.latest_candle_time))/1000)}]));
  result.dataGaps=[...historicalGaps,...gaps.values()].filter(g=>Date.parse(g.candle_time)+60000<=ms).map(g=>({...g}));
  for(const gap of result.dataGaps)if(Date.parse(gap.candle_time)>=Date.parse(result.get(gap.symbol)?.latest_candle_time||'1970-01-01'))result.delete(gap.symbol);
  result.readinessSource='volatile_natural_completed_1m';return result;
 }
 function seedHistory({calendar,rows:history}){
  if(historySeeded)throw Error('MEMORY_HISTORY_ALREADY_SEEDED');
  const previous=calendar?.session_dates?.at(-1);
  if(calendar?.status!=='SESSION_DATES_VERIFIED'||calendar.trade_date!==tradeDate||!previous||previous>=tradeDate)throw Error('MEMORY_HISTORY_CALENDAR_UNPROVEN');
  const checked=createMemoryCandles({tradeDate:previous,symbols,buildIndicators:()=>new Map(),now,maxBarsPerSymbol:35});
  checked.ingest(history);
  historicalRows=checked.completedRows();historicalGaps=checked.dataGaps();historySeeded=true;revision++;cachedKey='';
 }
 function completedRows(){return [...rows.values()].filter(r=>Date.parse(r.candle_time)+60000<=now()).map(r=>({...r}));}
 return {ingest,read,seedHistory,completedRows,dataGaps:()=>[...gaps.values()].map(g=>({...g})),status:()=>({trade_date:tradeDate,candle_count:rows.size,historical_candle_count:historicalRows.length,data_gap_count:gaps.size+historicalGaps.length,revision})};
}
module.exports={createMemoryCandles};
