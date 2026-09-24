'use strict';
const {evaluateVolume}=require('./daytrade-volume-value-ranking');
const baseline=require('./mother-pool-daily-volume-baseline');
const firstPositive=(...values)=>values.find(v=>typeof v==='number'&&Number.isFinite(v)&&v>0);
function inspect(row,tradeDate,asOf){
 const raw=row?.source_evidence,quote=raw?.quote,payload=quote?.payload||{},b=raw?.daily_baseline,failed=[];
 const volume=evaluateVolume(payload.turnoverVolumeEvidence,tradeDate,Date.parse(asOf));
 if(volume.status!=='ready')failed.push('CUMULATIVE_VOLUME_UNPROVEN');
 if(!baseline.verify(b)||b.symbol!==row.symbol||b.trade_date!==tradeDate)failed.push('FIVE_DAY_DENOMINATOR_UNPROVEN');
 const price=firstPositive(quote?.price,quote?.close,payload.price,payload.close,payload.lastPrice,payload.last_price);
 const previous=firstPositive(quote?.previous_close,quote?.prevClose,quote?.reference_price,quote?.referencePrice,payload.previousClose,payload.previous_close,payload.prevClose,payload.referencePrice,payload.reference_price);
 const at=Date.parse(raw?.quote_event_at),age=Date.parse(asOf)-at;
 if(!price||!previous)failed.push('QUOTE_PRICE_OR_REFERENCE_MISSING');
 if(!Number.isFinite(age)||age<0||age>120000||new Date(at+28800000).toISOString().slice(0,10)!==tradeDate)failed.push('QUOTE_TIME_INVALID');
 const lots=volume.unit==='shares'?volume.value/1000:volume.unit==='lots'?volume.value:null;
 const ratio=lots!==null&&b?.avg_volume5>0?lots/b.avg_volume5:null;
 const change=price&&previous?(price-previous)/previous*100:null;
 if(failed.length===0&&(row.totalVolume!==Math.round(lots)||row.avgVolume5!==Math.round(b.avg_volume5)||row.volumeRatio5!==Number(ratio.toFixed(4))||![Number(change.toFixed(4)),Number(change.toFixed(2))].includes(row.changePercent)))failed.push('DISCOVERY_SUMMARY_RAW_MISMATCH');
 return {status:failed.length?'DATA_GAP':'SOURCE_VERIFIED',failed_checks:failed,cumulative_volume_lots:lots,volume_ratio:ratio,price_change_pct:change,price,previous_close:previous};
}
module.exports={inspect};
