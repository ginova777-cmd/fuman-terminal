'use strict';
const assert=require('node:assert/strict');
const {collect,verify}=require('../lib/mother-pool-preopen-history');
function fixture(){
 const f=require('./test-mother-previous-ohlc').fixture(),date=f.identity.trade_date;
 for(const [symbol,v] of f.dailyVolumeMap){v.daily_volume_evidence.rows=require('../lib/mother-pool-daily-volume-baseline').datesFromCalendar(v.daily_volume_evidence.calendar,date).map(trade_date=>({symbol,trade_date,open:100,high:110,low:90,close:105,volume_lots:1000}));}
 f.quoteMap=new Map(f.symbols.map(symbol=>[symbol,{symbol,price:105,updated_at:'2026-09-17T13:30:00+08:00',payload:{source:'fugle-websocket-cache'}}]));
 f.activeSymbols=f.symbols.map(symbol=>({symbol,turnoverMaster:{official_issued_common_shares:10000000,stock_master_source:'MOPS_OPEN_DATA_TWSE_TPEX',official_present:true,stock_master_source_date:'2026-09-18',stock_master_synced_at:date+'T06:00:00+08:00'}}));
 f.rawEvidence={contract:'daytrade_preopen_raw_rpc_evidence_v1',observation_trade_date:date,source_rpc:'get_fugle_daytrade_intraday_1m_latest_n',requested_symbols:f.symbols,observed_at:date+'T06:00:00+08:00',rows:f.symbols.map(symbol=>({symbol,trade_date:'2026-09-17',candle_time:'2026-09-17T13:29:00+08:00',open:100,high:110,low:90,close:105,volume:100,source:'fugle_daytrade_fast_sync:websocket_candles',synthetic:false,volume_strategy_usable:true,payload:{originalSource:'fugle-ws-candles',originalChannel:'candles',candleOrigin:'websocket_candle',sourceCandleSeenAt:'2026-09-17T13:30:00+08:00'}}))};return f;
}
let checks=0;
const f=fixture(),p=collect(f),r={...f.identity,observed_at:f.asOf};assert(p.rows.every(row=>verify(row,r)));assert.equal(p.rows[0].reference_turnover_pct,10);assert.equal(p.rows[0].avg_volume3_lots,1000);assert.equal(p.rows[0].quote_mode,'previous_session_reference');assert.equal(p.rows[0].today_1m_requirement,'NOT_DUE_IN_PREOPEN');checks++;
for(const mutate of [x=>x.quoteMap.clear(),x=>x.rawEvidence.rows.splice(0),x=>x.rawEvidence.rows[0].synthetic=true,x=>x.rawEvidence.rows[0].volume=null,x=>x.rawEvidence.rows.push(x.rawEvidence.rows[0]),x=>x.dailyVolumeMap.get('2330').daily_volume_evidence.rows.pop(),x=>x.activeSymbols[0].turnoverMaster.official_issued_common_shares=0,x=>x.activeSymbols[0].turnoverMaster.stock_master_source='unproven',x=>x.asOf='2026-09-18T09:00:00+08:00',x=>x.rawEvidence.rows[0].payload.sourceCandleSeenAt='2026-09-17T13:29:30+08:00']){
 const x=fixture();mutate(x);const row=collect(x).rows[0];assert.equal(row.status,'DATA_GAP');assert(!verify(row,{...x.identity,observed_at:x.asOf}));checks++;
}
for(const field of ['avg_volume3_lots','reference_turnover_pct','amplitude_pct','quote_age_seconds','history_bar_count']){const row=structuredClone(p.rows[0]);row[field]=999;assert(!verify(row,r));checks++;}
const identity={...f.identity,writer_run_id:'writer',generation_id:'writer-generation',mother_pool_run_id:'pool',snapshot_generation:'snapshot-generation',snapshot_sequence:1};
function round(){
 const plan={created_at:f.asOf,requested_symbols:p.requested_symbols,data_gap_symbols:[],special_evidence:{},rows:p.rows},plan_hash=require('../lib/mother-pool-module-write-set').hash(plan);
 const contract=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json').modules.A07;
 const writeSet={contract:'mother_pool_module_write_set_v1',module_id:'A07',module_contract:contract,...identity,plan,plan_hash,ack:{committed:true,committed_at:f.asOf,plan_hash,written_symbols:p.requested_symbols}};
 const rows=p.rows.map(row=>({...row,...identity}));
 const surface=()=>({query_identity:identity,requested_count:2,written_count:2,missing:[],extra:[],pages:[{page_index:0,page_size:500,offset:0,http_status:200,content_range:'0-1/2',query_identity:identity,rows:structuredClone(rows)}]});
 return {module_id:'A07',contract,...identity,run_id:identity.writer_run_id,observed_at:f.asOf,status:'verified',source_contract_ok:true,db_readback_ok:true,anon_readback_ok:true,failed_checks:[],natural_evidence:true,replay:false,synthetic:false,look_ahead:false,requested:2,written:2,readback:2,unique_symbols:2,writer_write_set:writeSet,db_readback:surface(),anon_readback:surface()};
}
const verifier=require('../lib/verify-mother-pool-module-round').createVerifier('A07');
assert(verifier.validRound(round()));checks++;
for(const role of ['db_readback','anon_readback']){const bad=round();bad[role].pages[0].rows[0].avg_volume5_lots=99;assert(!verifier.validRound(bad));checks++;}
console.log(JSON.stringify({status:'passed',checks,scope:'isolated_A07_sources_formulas_and_both_readback_surfaces',production_complete:false}));
