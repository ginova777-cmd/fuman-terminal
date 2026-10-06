'use strict';
// Bound the intraday queue without dropping or acknowledging deferred rows.
function plan(pending,{nowMs=Date.now(),limit=2000,backfillReserve=500}={}){
 if(!Array.isArray(pending)||!Number.isFinite(nowMs)||!Number.isInteger(limit)||limit<1||!Number.isInteger(backfillReserve)||backfillReserve<0||backfillReserve>=limit)throw Error('FAST_PLAN_INVALID');
 const clock=new Date(nowMs+28800000),minute=clock.getUTCHours()*60+clock.getUTCMinutes();
 if(minute<540||minute>=810)return {rows:pending,deferred:0,mode:'FULL_CATCHUP',latest_changed_symbols:0};
 const sorted=[...pending].sort((a,b)=>Date.parse(b.candle_time)-Date.parse(a.candle_time)||a.symbol.localeCompare(b.symbol));
 const latest=new Map();for(const r of sorted){if(!Number.isFinite(Date.parse(r.candle_time))||typeof r.symbol!=='string')throw Error('FAST_PLAN_ROW_INVALID');if(!latest.has(r.symbol))latest.set(r.symbol,r);}
 const rows=[],selected=new Set(),add=r=>{if(rows.length<limit&&!selected.has(r)){selected.add(r);rows.push(r);}};
 // Every changed symbol gets its newest pending minute first where capacity permits.
 for(const r of latest.values()){if(rows.length>=limit-backfillReserve)break;add(r);}
 const before=rows.length;for(let i=sorted.length-1;i>=0&&rows.length-before<backfillReserve;i--)add(sorted[i]);
 for(const r of sorted)add(r);
 return {rows,deferred:pending.length-rows.length,mode:'BOUNDED_LATEST_AND_BACKFILL',latest_changed_symbols:latest.size,
  latest_changed_symbols_selected:[...latest.values()].filter(r=>selected.has(r)).length};
}
module.exports={plan};
