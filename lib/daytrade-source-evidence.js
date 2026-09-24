"use strict";
const crypto=require('node:crypto');
const finite=v=>(typeof v==='number'||(typeof v==='string'&&v.trim()!==''))&&Number.isFinite(Number(v))?Number(v):null;
const date=v=>Number.isFinite(Date.parse(v))?new Date(Date.parse(v)+28800000).toISOString().slice(0,10):'';
function outsideRatio(inside,outside){return finite(inside)>0&&finite(outside)!==null?Number(outside)/Number(inside):null;}
function normalizeNaturalMinute(row,tradeDate,now=Date.now()){
 const raw=row.payload||{},start=Date.parse(row.candleTime||row.candle_time||row.time||'');
 const volume=finite(Object.prototype.hasOwnProperty.call(raw,'volume')?raw.volume:row.volume),close=finite(row.close),open=finite(row.open),high=finite(row.high),low=finite(row.low);
 const symbol=String(row.symbol||row.code||'');
 const market=String(row.market||raw.market||raw.exchange||'').toUpperCase();
 const natural=(row.synthetic===false||row.is_synthetic===false)&&row.synthetic!==true&&row.is_synthetic!==true;
 const source=row.source==='fugle-ws-candles'&&row.sourceChannel==='candles'&&row.candleOrigin==='websocket_candle';
 const unit=['TSE','TWSE','OTC','TPEX'].includes(market)&&row.intradayOddLot===false?'lots':null;
 const reason=!/^\d{4}$/.test(symbol)?'symbol_invalid':!Number.isFinite(start)||date(new Date(start).toISOString())!==tradeDate?'wrong_trade_date':!natural||!source?'natural_source_unproven':!unit?'volume_unit_unproven':volume===null||volume<0?'volume_missing':![open,high,low,close].every(x=>x!==null&&x>0)||high<Math.max(open,close)||low>Math.min(open,close)?'ohlc_invalid':start+60000>Number(now)?'bar_not_completed':null;
 if(reason)return {ok:false,symbol,reason};
 return {ok:true,row:{symbol,candle_time:new Date(start).toISOString(),bar_end:new Date(start+60000).toISOString(),open,high,low,close,volume,volume_unit:unit,is_synthetic:false,bar_complete:true,source:'fugle_websocket_candle_cache'}};
}
function compareIndustry(current,previous,seconds){
 const members=x=>Array.isArray(x?.component_symbols)?[...new Set(x.component_symbols)].sort():null;
 const a=members(current),b=members(previous);
 const reason=!previous?'previous_round_missing':!(seconds>0&&seconds<=300)?'comparison_window_invalid':!a||!b||!a.length?'component_evidence_missing':current.formula_version!==previous.formula_version||!current.formula_version?'formula_version_mismatch':JSON.stringify(a)!==JSON.stringify(b)?'components_changed':null;
 return {comparable:!reason,reason,delta:reason?null:Math.round(current.net_flow_proxy-previous.net_flow_proxy),component_hash:a?crypto.createHash('sha256').update(JSON.stringify(a)).digest('hex'):null};
}
module.exports={finite,outsideRatio,normalizeNaturalMinute,compareIndustry};
