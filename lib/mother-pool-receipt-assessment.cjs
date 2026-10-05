'use strict';
const {createHash}=require('node:crypto');
const {verifyHashEvidence}=require('./mother-pool-receipt-binding');
const {isClosedRow,isExplicitTradingRow}=require('../scripts/twse-trading-day');
const REALTIME_CHECKS=['websocket_readable','websocket_same_day','websocket_canonical','websocket_healthy','websocket_fresh','priority_same_day','priority_canonical','priority_fresh','mother_pool_same_day','mother_pool_canonical','mother_pool_fresh','fast_supabase_sync_same_day','fast_supabase_sync_fresh','fast_supabase_quote_write_nonempty','fast_supabase_1m_write_nonempty'];
function assess(result,{calendar}){
 const binding=result.snapshot_binding,checks=result.checks||{},integrity=[];
 if(!binding)integrity.push('SNAPSHOT_BINDING_MISSING');
 else {
  integrity.push(...verifyHashEvidence(binding).failed_checks);
  if(binding.trade_date!==result.trade_date||binding.canonical_run_id!==result.canonical_run_id)integrity.push('RESULT_IDENTITY_MISMATCH');
  if(binding.snapshot_readback_count!==result.components?.mother_pool?.rows)integrity.push('RESULT_COUNT_MISMATCH');
 }
 for(const k of ['snapshot_generation_bound','snapshot_generation_unchanged'])if(checks[k]!==true)integrity.push(k);
 const ev=calendar?.calendar_evidence,stamp=Date.parse(result.checked_at),fetched=Date.parse(ev?.fetched_at);
 // Never classify an unavailable/stale calendar or weekday fallback as NOT_DUE.
 const dayParts=String(result.trade_date||'').split('-');
 const rocKey=String(Number(dayParts[0])-1911)+dayParts.slice(1).join('');
 const officialRow=ev?.rows?.find?.(row=>String(row?.Date||'')===rocKey);
 const weekday=new Date(String(result.trade_date)+'T04:00:00Z').getUTCDay();
 const expectedReason=officialRow&&isExplicitTradingRow(officialRow)?'special_trading_day':officialRow&&isClosedRow(officialRow)?'twse_closed_day':[0,6].includes(weekday)?'weekend':'regular_weekday';
 const expectedOpen=['special_trading_day','regular_weekday'].includes(expectedReason);
 const calendarVerified=calendar?.date===result.trade_date&&typeof calendar.isTradingDay==='boolean'
  && !calendar.error&&!calendar.override&&['twse','cache'].includes(calendar.source)
  && ev?.source_url==='https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule'
  && Array.isArray(ev.rows)&&ev.rows.length>0&&ev.year===Number(result.trade_date?.slice(0,4))
  && Number.isFinite(fetched)&&fetched<=stamp&&stamp-fetched<=7*86400000
  && calendar.reason===expectedReason&&calendar.isTradingDay===expectedOpen;
 const local=Number.isFinite(stamp)?new Date(stamp+8*3600000).toISOString():'';
 const minute=local?Number(local.slice(11,13))*60+Number(local.slice(14,16)):null;
 const validMinute=Number.isInteger(minute)&&local.slice(0,10)===result.trade_date;
 const phase=!calendarVerified||!validMinute?'UNKNOWN':!calendar.isTradingDay?'CLOSED_DAY':minute<540?'PREOPEN':minute>=810?'POSTCLOSE':'INTRADAY';
 const liveFailures=REALTIME_CHECKS.filter(k=>checks[k]!==true);
 const realtime=phase==='UNKNOWN'?'UNKNOWN':phase!=='INTRADAY'?'NOT_DUE':liveFailures.length?'FAIL':'PASS';
 return {
  integrity_status:!binding?'UNKNOWN':integrity.length?'FAIL':'PASS',
  integrity_verified_at:result.checked_at,integrity_failed_checks:[...new Set(integrity)],
  realtime_status:realtime,realtime_verified_at:result.checked_at,
  realtime_failed_checks:phase==='UNKNOWN'?['SESSION_EVIDENCE_UNVERIFIED']:phase==='INTRADAY'?liveFailures:[],
  session_evidence:{contract:'mother-pool-receipt-assessment-v1',scope:'writer_pipeline_checks_not_per_symbol_formal_gate',phase,trade_date:result.trade_date,timezone:'Asia/Taipei',minute,
   regular_start:'09:00',regular_end_exclusive:'13:30',calendar_verified:calendarVerified,
   calendar_source:calendar?.source||null,calendar_reason:calendar?.reason||null,calendar_fetched_at:ev?.fetched_at||null,
   calendar_source_url:ev?.source_url||null,calendar_evidence:ev||null,
   calendar_sha256:ev?createHash('sha256').update(JSON.stringify(ev)).digest('hex'):null,
   original_realtime_failed_checks:liveFailures,legacy_complete_unchanged:true,not_due_is_not_pass:true}
 };
}
module.exports={assess,REALTIME_CHECKS};
