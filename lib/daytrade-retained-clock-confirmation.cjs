'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const bytes=fs.readFileSync(path.join(__dirname,'../data/contracts/a08-retained-clock-confirmation-20261022.json'));
const receiptHash=crypto.createHash('sha256').update(bytes).digest('hex');
if(receiptHash!=='e54359f3870f71bfe12c0220f59947e8d7572fa269e538c13807c08f47be789e')throw Error('CLOCK_CONFIRMATION_RECEIPT_CHANGED');
const evidence=JSON.parse(bytes);
function match(c){
 const time=Date.parse(c.candleTime||c.candle_time),seen=c.candleSeenAt||c.payload?.sourceCandleSeenAt;
 const r=evidence.records.find(r=>r.symbol===c.symbol&&Date.parse(r.candle_time)===time&&r.source_seen_at===seen);
 if(!r||!['open','high','low','close','volume'].every(k=>c[k]===r[k])||(c.tradeDate||c.trade_date)!==r.trade_date||c.market!==r.market)return null;
 if(!Number.isFinite(Date.parse(r.provider_observed_at))||Date.parse(r.provider_observed_at)<time+60000)return null;
 return {contract:evidence.contract,receipt_sha256:receiptHash,provider_response_sha256:r.provider_response_sha256,provider_observed_at:r.provider_observed_at,clock_anomaly_preserved:true};
}
function persisted(row){const expected=match(row),actual=row.payload?.clock_confirmation;return !!expected&&JSON.stringify(actual)===JSON.stringify(expected);}
module.exports={match,persisted};
