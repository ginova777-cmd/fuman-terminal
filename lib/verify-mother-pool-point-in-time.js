'use strict';
function verify(row,asOf){
 try{
  const bars=row.bars_through_event,event=Date.parse(row.event_time),end=Date.parse(asOf),start=Date.parse(row.trade_date+'T09:00:00+08:00');
  if(row.status!=='READY'||!Array.isArray(bars)||!bars.length||!Number.isFinite(event)||event>end||end-event>60000)return false;
  for(let i=0;i<bars.length;i++){
   const b=bars[i],time=Date.parse(b.timestamp),seen=Date.parse(b.available_at);
   if(b.stock_id!==row.symbol||b.trade_date!==row.trade_date||b.is_synthetic!==false||b.complete!==true||b.source!=='Fugle.websocket.candles.TSE_OTC'||time!==start+i*60000||time+60000>event||!Number.isFinite(seen)||seen>event||seen<time)return false;
   if(!['open','high','low','close'].every(k=>typeof b[k]==='number'&&Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high))return false;
  }
  const latest=bars.at(-1),h=Math.max(...bars.map(b=>b.high)),l=Math.min(...bars.map(b=>b.low)),p=latest.close;
  return Date.parse(latest.timestamp)+60000===Math.floor(event/60000)*60000&&row.current_price===p&&row.day_high_so_far===h&&row.day_low_so_far===l&&Math.abs(row.distance_from_high_pct-(p-h)/h*100)<1e-8&&Math.abs(row.distance_from_low_pct-(p-l)/l*100)<1e-8&&row.new_high===(p>=h)&&row.new_low===(p<=l);
 }catch{return false;}
}
module.exports={verify};
