'use strict';
const crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const day=ms=>new Date(ms+28800000).toISOString().slice(0,10);
function normalizeResponse(body,{symbol,tradeDate,receivedAt,runId}) {
 const received=Date.parse(receivedAt);
 if(!Number.isFinite(received)||!runId||body?.symbol!==symbol||body.date!==tradeDate||body.type!=='EQUITY'||String(body.timeframe)!=='1'||!['TSE','OTC','TIB'].includes(body.market)||body.intradayOddLot===true||body.isSynthetic===true||!Array.isArray(body.data))throw Error('REST_CANDLE_RESPONSE_IDENTITY_INVALID');
 const rows=[],rejected=[],seen=new Map(),conflicts=new Set(),rawSha=hash(body);
 for(const raw of body.data){const time=typeof raw?.date==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(raw.date)?Date.parse(raw.date):NaN;
 const values=['open','high','low','close','volume'].map(k=>raw?.[k]);
 let reason=!Number.isFinite(time)||time%60000!==0||time>received||day(time)!==tradeDate?'INVALID_EVENT_TIME':null;
 const minute=Number.isFinite(time)?((time/60000+480)%1440):NaN;
 if(!reason&&(minute<540||minute>810))reason='OUTSIDE_REGULAR_SESSION';
 if(!reason&&(!values.every(v=>typeof v==='number'&&Number.isFinite(v))||values.slice(0,4).some(v=>v<=0)||raw.volume<0||raw.high<Math.max(raw.open,raw.close)||raw.low>Math.min(raw.open,raw.close)))reason='INVALID_OHLCV';
 if(!reason&&(raw.synthetic===true||raw.is_synthetic===true||raw.isSynthetic===true))reason='SYNTHETIC';
 if(reason){rejected.push({event_at:raw?.date??null,reason});continue;}
 const fingerprint=JSON.stringify(values);
 if(seen.has(time)){if(seen.get(time)!==fingerprint)conflicts.add(time);continue;}seen.set(time,fingerprint);
 const at=new Date(time).toISOString();
 rows.push({symbol,trade_date:tradeDate,candle_time:at,market:body.market,open:raw.open,high:raw.high,low:raw.low,close:raw.close,volume:raw.volume,source:'fugle_daytrade_writer:rest_gap_repair',source_channel:'rest',candle_origin:'rest_candle',synthetic:false,volume_strategy_usable:true,websocket_row:false,rest_repair_row:true,intraday_odd_lot:false,is_realtime:false,is_formal_entry_eligible:false,updated_at:receivedAt,payload:{source_channel:'rest',candle_origin:'rest_candle',synthetic:false,volume_strategy_usable:true,intradayOddLot:false,volume_unit:'lots',volume_source_event_at:at,raw_evidence:raw,raw_sha256:hash(raw),response_sha256:rawSha,source_received_at:receivedAt,repair_run_id:runId,historical_availability_proven:false}});
 }
 for(const time of conflicts)rejected.push({event_at:new Date(time).toISOString(),reason:'CONFLICTING_SAME_MINUTE'});
 return {rows:rows.filter(r=>!conflicts.has(Date.parse(r.candle_time))),rejected,response_sha256:rawSha};
}
module.exports={normalizeResponse};
async function publishMissing({existing,candidates,insert,readback}) {
 const key=r=>String(r.symbol)+'/'+Date.parse(r.candle_time);
 const occupied=new Set(existing.map(key));
 const blocked=candidates.filter(r=>occupied.has(key(r))).map(r=>({symbol:r.symbol,candle_time:r.candle_time,reason:'EXISTING_ROW_REQUIRES_REVIEW'}));
 const pending=candidates.filter(r=>!occupied.has(key(r)));
 let written=0;
 if(pending.length){
  const inserted=await insert(pending);
  if(!Array.isArray(inserted)||inserted.length>pending.length)throw Error('INVALID_INSERT_ACK');
  const expected=new Set(pending.map(key)),returned=new Set();
  for(const row of inserted){if(!expected.has(key(row))||returned.has(key(row)))throw Error('INVALID_INSERT_IDENTITY');returned.add(key(row));}
  written=inserted.length;
 }
 const rows=await readback();
 if(!Array.isArray(rows)||rows.length>300)throw Error('INVALID_READBACK_BOUND');
 const actual=new Map();for(const row of rows){if(actual.has(key(row)))throw Error('DUPLICATE_READBACK');actual.set(key(row),row);}
 for(const row of pending){const got=actual.get(key(row));
  if(!got||got.trade_date!==row.trade_date||got.synthetic!==false||got.volume_strategy_usable!==true||['open','high','low','close','volume'].some(k=>got[k]!==row[k]))throw Error('REPAIR_READBACK_MISMATCH');
  if(!got.payload?.raw_sha256||got.payload?.volume_unit!=='lots')throw Error('REPAIR_READBACK_EVIDENCE_MISSING');
 }
 return {rows,written,blocked};
}
module.exports.publishMissing=publishMissing;
