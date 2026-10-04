'use strict';
const {build}=require('./futopt-collector-catalogue');
const {selectReference}=require('./futopt-txf-reference.cjs');
const POLICY='txf-regular-daily-fixed-v1';
function isoDate(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;}
function reference(snapshot,{tradeDate,nowMs=Date.now()}){
 const rows=build(snapshot,tradeDate,new Date(nowMs).toISOString());
 const candidates=rows.filter(r=>r.product==='TXF'&&/^TXF[A-L]\d$/.test(r.future_symbol));
 if(!candidates.length)throw Error('TXF_VALID_CONTRACT_MISSING');
 for(const r of candidates){const p=r.payload;
  if(r.session!=='REGULAR'||r.contract_type!=='I'||!p||p.type!=='FUTURE'||!isoDate(p.startDate)||!isoDate(p.endDate)||p.startDate>tradeDate)throw Error('TXF_CONTRACT_METADATA_INVALID');
 }
 const ref=selectReference(rows,{tradeDate,sourceHash:snapshot.source_hash,runId:snapshot.run_id,observedAt:snapshot.observed_at,nowMs});
 const chosen=candidates.find(r=>r.future_symbol===ref.future_symbol),raw=chosen.payload;
 const open=Date.parse(raw.openDatetime),close=Date.parse(raw.closeDatetime);
 const expectedOpen=Date.parse(tradeDate+'T08:45:00+08:00');
 const expectedClose=Date.parse(tradeDate+(ref.expiry_date===tradeDate?'T13:30:00+08:00':'T13:45:00+08:00'));
 if(open!==expectedOpen||close!==expectedClose)throw Error('TXF_SESSION_WINDOW_UNVERIFIED');
 if(Date.parse(snapshot.observed_at)>=close)throw Error('TXF_MAPPING_OBSERVED_AFTER_SESSION');
 if(raw.settlementDate!==raw.endDate)throw Error('TXF_SETTLEMENT_DATE_CONFLICT');
 return {...ref,product:'TXF',session:'REGULAR',mapping_contract:'fugle-txf-reference-read-v1',policy_version:POLICY,
  contract_month:raw.endDate.slice(0,7),contract_month_source:'Fugle.endDate calendar month; not symbol parsing',
  source_provider:'Fugle',source_url:snapshot.fugle_url,source_event_date:snapshot.raw_fugle.date,source_event_at:null,
  source_event_time_reason:'ticker response supplies date; no native publication timestamp',
  verified_at:new Date(nowMs).toISOString(),valid_from:snapshot.observed_at,valid_until:new Date(close).toISOString(),session_open_at:new Date(open).toISOString(),
  rollover_policy:'Freeze nearest verified contract for this regular session. On expiry date mapping stops at native 13:30 close; no intraday switch. Re-select from next verified trading-day catalogue.',
  candidates:candidates.map(r=>({future_symbol:r.future_symbol,start_date:r.payload.startDate,expiry_date:r.end_date,session:r.session})),raw_contract:raw};
}
module.exports={reference,POLICY};

