'use strict';
const {fixedReadQuery}=require('./daytrade-source-status-ack');
const identities=['trade_date','canonical_run_id','writer_run_id','generation_id'];
const fields=['volume_value_ranking','intraday_turnover_ranking','mother_pool_minute_side_evidence','mother_pool_price_volume_evidence'];
function query(row){
 const q=new URLSearchParams(fixedReadQuery(row));
 q.set('select',['trade_date',...identities.map(k=>'identity_'+k+':payload->>'+k),...fields.map(k=>k+':payload->'+k)].join(','));
 return q.toString();
}
function decode(rows,expected){
 if(!Array.isArray(rows)||rows.length!==1)throw Error('RANKING_READBACK_ROW_COUNT');
 const r=rows[0];
 if(r.trade_date!==expected.trade_date||identities.some(k=>r['identity_'+k]!==expected.payload[k]))throw Error('RANKING_READBACK_IDENTITY');
 if(fields.some(k=>!Object.hasOwn(r,k)))throw Error('RANKING_READBACK_FIELDS');
 return [{trade_date:r.trade_date,payload:Object.fromEntries(fields.map(k=>[k,r[k]]))}];
}
module.exports={query,decode};
