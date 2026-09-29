'use strict';
function datesFromCalendar(calendar,tradeDate,count=5){
 if(!Number.isInteger(count)||count<1||count>20)throw Error('SESSION_COUNT_INVALID');
 if(typeof tradeDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||!Number.isFinite(Date.parse(tradeDate))||new Date(tradeDate).toISOString().slice(0,10)!==tradeDate)throw Error('TRADE_DATE_INVALID');
 if(calendar?.trade_date!==tradeDate||calendar.status!=='SESSION_DATES_VERIFIED'||!Array.isArray(calendar.checks))throw Error('DAILY_CALENDAR_REQUIRED');
 const dates=[];let expected=Date.parse(tradeDate+'T00:00:00Z')-86400000;
 for(const c of calendar.checks){
  const date=new Date(expected).toISOString().slice(0,10);
  if(c.date!==date||!['cache','twse'].includes(c.source)||typeof c.isTradingDay!=='boolean'||c.error||c.override===true)throw Error('DAILY_CALENDAR_INVALID');
  if(c.isTradingDay)dates.push(date);expected-=86400000;if(dates.length===count)break;
 }
 if(dates.length!==count)throw Error('COMPLETED_SESSIONS_REQUIRED');return dates.reverse();
}
function build({symbol,tradeDate,rows,calendar}){
 const dates=datesFromCalendar(calendar,tradeDate),selected=rows.filter(r=>r.symbol===symbol&&dates.includes(r.trade_date));
 const failed=[];
 if(dates.some(d=>selected.filter(r=>r.trade_date===d).length!==1))failed.push('DAILY_VOLUME_MISSING_OR_DUPLICATE');
 if(selected.some(r=>typeof r.volume_lots!=='number'||!Number.isFinite(r.volume_lots)||r.volume_lots<0||r.synthetic===true||r.is_synthetic===true||r.replay===true||r.look_ahead===true))failed.push('DAILY_VOLUME_INVALID');
 const ordered=dates.map(date=>selected.find(r=>r.trade_date===date)).filter(Boolean);
 const avg=failed.length?null:ordered.reduce((n,r)=>n+r.volume_lots,0)/5;
 if(avg===0)failed.push('DAILY_VOLUME_ZERO_BASELINE');
 return {contract:'mother_pool_previous_five_completed_volumes_v1',symbol,trade_date:tradeDate,source:'strategy4_daily_ohlcv_view',volume_unit:'LOTS',dates,rows:ordered,calendar,avg_volume5:failed.length?null:avg,status:failed.length?'DATA_GAP':'READY',failed_checks:failed};
}
function verify(e){try{if(e?.contract!=='mother_pool_previous_five_completed_volumes_v1'||e.source!=='strategy4_daily_ohlcv_view'||e.volume_unit!=='LOTS')return false;if(!Array.isArray(e.failed_checks)||e.failed_checks.length||!Array.isArray(e.rows)||e.rows.length!==5||e.rows.some(r=>r.symbol!==e.symbol||!e.dates.includes(r.trade_date)))return false;const r=build({symbol:e.symbol,tradeDate:e.trade_date,rows:e.rows,calendar:e.calendar});return r.status==='READY'&&e.status==='READY'&&e.avg_volume5===r.avg_volume5&&JSON.stringify(e.dates)===JSON.stringify(r.dates);}catch{return false;}}
module.exports={build,verify,datesFromCalendar};

