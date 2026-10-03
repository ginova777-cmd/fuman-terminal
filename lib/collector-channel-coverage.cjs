'use strict';
// A subscription plan proves neither provider ACK nor receipt of a new trade.
function inspect(selection, {mode='manifest_event_and_session_boundary'}={}) {
 const requested=[...new Set(selection.allSymbols||[])];
 const channels={};
 for(const [name,key,enabled] of [
  ['candles','candleRadarSymbols',selection.candleChannel==='candles'],
  ['trades','quoteRadarSymbols',selection.quoteRadarChannel==='trades'],
  ['aggregates','aggregateRadarSymbols',selection.aggregateRadarChannel==='aggregates']]) {
  const planned=new Set(enabled?selection[key]||[]:[]);
  const missing=requested.filter(s=>!planned.has(s));
  channels[name]={requested_count:requested.length,planned_requested_count:requested.length-missing.length,
   missing_count:missing.length,missing_symbols:missing,planned_full_coverage:requested.length>0&&missing.length===0};
 }
 return {contract:'collector-channel-coverage-v1',scope:'current_plan_only',refresh_mode:mode,
  rotation_coverage_seconds:null,rotation_coverage_reason:mode==='manifest_event_and_session_boundary'?'NO_PERIODIC_ROTATION':'CHANNEL_SWEEP_NOT_VERIFIED',
  channels,acknowledgement_verified:false,natural_event_coverage_verified:false,complete:false};
}
module.exports={inspect};
