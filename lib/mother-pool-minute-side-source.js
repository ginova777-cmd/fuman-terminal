'use strict';
const {build}=require('./telegram-detectors/provider-minute-side.cjs');
// Source adapter only. It does not emit signals or change Telegram strategy.
function readMinuteSide({symbol,tradeDate,canonicalRunId,asOf,trades=[],side=[]}) {
 const base={contract:'mother_pool_native_minute_side_source_v1',symbol,trade_date:tradeDate,
  canonical_run_id:canonicalRunId,as_of:asOf,publish_allowed:false,creates_order:false};
 const gap=reason=>({...base,status:'DATA_GAP',complete:false,rows:[],data_gaps:[{reason}]});
 if(typeof symbol!=='string'||!/^\d{4}$/.test(symbol)||typeof tradeDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
  ||canonicalRunId!==`fugle_daytrade_source:${tradeDate.replaceAll('-','')}:canonical`
  ||!Number.isFinite(Date.parse(asOf))||new Date(Date.parse(asOf)+28800000).toISOString().slice(0,10)!==tradeDate)return gap('SOURCE_IDENTITY_INVALID');
 if(!Array.isArray(trades)||!Array.isArray(side))return gap('SOURCE_ARRAY_INVALID');
 const now=Date.parse(asOf);
 const validEnvelope=x=>x&&x.stock_id===symbol&&x.trade_date===tradeDate&&x.is_synthetic===false
  &&x.volume_unit==='LOTS'&&Number.isFinite(Date.parse(x.received_at));
 if(trades.some(x=>!validEnvelope(x)||x.contract!=='fugle_native_trade_journal_v1'||x.source!=='Fugle.websocket.trades')
  ||side.some(x=>!validEnvelope(x)||x.provider_source!=='Fugle.aggregates.total'||x.aggregation!=='DAY_CUMULATIVE'||x.is_trial!==false))
  return gap('NATIVE_JOURNAL_ENVELOPE_INVALID');
 const availableTrades=trades.filter(x=>Date.parse(x.received_at)<=now);
 const availableSide=side.filter(x=>Date.parse(x.received_at)<=now);
 if(!availableTrades.length||!availableSide.length)return gap('NATIVE_JOURNAL_MISSING_AS_OF');
 try{
  const result=build({trade_date:tradeDate,stock_id:symbol,trades:availableTrades.map(x=>x.trade),
   journal:availableSide,as_of:asOf,volume_unit:'LOTS'});
  return {...base,status:result.rows.length?'SOURCE_ROWS_AVAILABLE':'DATA_GAP',complete:false,
   rows:result.rows,data_gaps:result.data_gaps,native_trade_records:availableTrades.length,
   native_side_records:availableSide.length,downstream_baseline_verified:false};
 }catch(e){return gap(e.message);}
}
module.exports={readMinuteSide};
