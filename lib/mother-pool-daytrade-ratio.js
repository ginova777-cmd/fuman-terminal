'use strict';
const official=require('./mother-pool-official-daytrade-source');
const marketOf=value=>/^(TWSE|TSE|上市)$/i.test(value||'')?'TWSE':/^(TPEX|OTC|上櫃)$/i.test(value||'')?'TPEX':null;
function prepare(source,asOf){const rows={},errors={};for(const market of ['TWSE','TPEX']){try{rows[market]=official.parse(source?.reports?.[market],market,source.source_date,asOf);}catch{rows[market]={};errors[market]='OFFICIAL_REPORT_INVALID';}}return {rows,errors};}
function evaluate(symbol,market,daily,readAt,source,parsed,identity,asOf){
 const gaps=[];let date=null;
 try{date=require('./mother-pool-daily-volume-baseline').datesFromCalendar(daily?.calendar,identity.trade_date).at(-1);}catch{gaps.push('PREVIOUS_SESSION_UNPROVEN');}
 if(!market||parsed.errors[market])gaps.push('OFFICIAL_MARKET_SOURCE_MISSING');
 if(source?.source_date!==date||daily?.symbol!==symbol||daily?.trade_date!==identity.trade_date||daily?.source!=='strategy4_daily_ohlcv_view')gaps.push('DAYTRADE_SOURCE_IDENTITY_INVALID');
 if(!Number.isFinite(Date.parse(readAt))||Date.parse(readAt)>Date.parse(asOf))gaps.push('DAILY_READ_TIME_INVALID');
 const matches=(daily?.rows||[]).filter(r=>r.symbol===symbol&&r.trade_date===date),d=matches[0],n=parsed.rows[market]?.[symbol]?.daytradeShares;
 if(matches.length!==1||typeof d?.volume_lots!=='number'||!Number.isFinite(d.volume_lots)||d.volume_lots<=0||d.synthetic===true||d.is_synthetic===true)gaps.push('TOTAL_VOLUME_MISSING_OR_INVALID');
 const total=typeof d?.volume_lots==='number'?d.volume_lots*1000:null;
 if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>total)gaps.push('OFFICIAL_DAYTRADE_VOLUME_INVALID');
 const ready=!gaps.length,ratio=ready?n/total*100:null;
 return {market,source_date:date,daytrade_volume_shares:ready?n:null,total_volume_shares:ready?total:null,volume_unit:'SHARES',daytrade_ratio_pct:ratio,threshold_pct:50,matched:ready?ratio>=50:null,status:ready?'READY':'DATA_GAP',data_gap_reason:ready?null:gaps.join('|')};
}
function collect({identity,symbols,activeSymbols,dailyVolumeMap,officialSource,asOf}){
 const parsed=prepare(officialSource,asOf),markets=new Map(activeSymbols.map(r=>[r.symbol,marketOf(r.market)]));
 const rows=symbols.map(symbol=>{const value=dailyVolumeMap.get(symbol),daily=value?.daily_volume_evidence||null,readAt=value?.daily_ohlcv_read_at||null,market=markets.get(symbol)||null;
  return {symbol,...evaluate(symbol,market,daily,readAt,officialSource,parsed,identity,asOf),source:'TWSE_TPEX_OFFICIAL_DAYTRADING+strategy4_daily_ohlcv_view',source_contract:'preopen_a05_daytrade_ratio_receipt_v1',source_updated_at:asOf,event_time:asOf,raw_daily_evidence:daily,daily_read_at:readAt,official_payload_hash:officialSource?.reports?.[market]?.payload_sha256||null,is_synthetic:false,replay:false,look_ahead:false};});
 return {...identity,module_id:'A05',created_at:asOf,requested_symbols:[...symbols],rows,source_evidence:{official:officialSource}};
}
function verify(rows,r){try{
 const source=r.writer_write_set.plan.source_evidence.official,parsed=prepare(source,r.observed_at);
 return rows.every(row=>{const expected=evaluate(row.symbol,row.market,row.raw_daily_evidence,row.daily_read_at,source,parsed,r,r.observed_at);return expected.status==='READY'&&row.is_synthetic===false&&row.replay===false&&row.look_ahead===false&&row.source==='TWSE_TPEX_OFFICIAL_DAYTRADING+strategy4_daily_ohlcv_view'&&row.source_contract==='preopen_a05_daytrade_ratio_receipt_v1'&&row.event_time===r.observed_at&&row.official_payload_hash===source.reports[row.market].payload_sha256&&Object.keys(expected).every(k=>row[k]===expected[k]);});
}catch{return false;}}
module.exports={collect,verify};
