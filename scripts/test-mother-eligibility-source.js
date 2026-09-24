'use strict';
const assert=require('node:assert/strict'),{collect,verify}=require('../lib/mother-pool-eligibility-source');
function fixture(){
 const date='2026-09-18',asOf=date+'T06:01:00+08:00';
 const ticker={symbol:'2330',name:'台積電',market:'TWSE',stock_type:'COMMONSTOCK',is_etf:false,is_suspended:false,payload:{stock_master_contract:'mops_official_stock_master_v1',stock_master_source:'MOPS_OPEN_DATA_TWSE_TPEX',official_present:true,stock_master_run_id:'official-test',stock_master_source_date:date,stock_master_synced_at:date+'T06:00:00+08:00'}};
 return {identity:{trade_date:date},asOf,evidence:{observed_at:asOf,stock_tickers:[ticker,{symbol:'0050',name:'ETF',market:'TWSE',stock_type:'ETF',is_etf:true}],stock_universe:[{symbol:'2330',is_active:true,payload:{}}]}};
}
if(require.main===module){
 const f=fixture(),p=collect(f),r={trade_date:f.identity.trade_date,observed_at:f.asOf};let checks=0;
 assert.deepEqual(p.requested_symbols,['0050','2330']);checks++;
 assert.equal(p.rows[0].eligible,false);assert.equal(p.rows[0].status,'READY');checks++;
 assert(p.rows.every(row=>verify(row,r)));checks++;
 for(const status of ['處置','分盤','停牌','人工管制','suspended']){const bad=structuredClone(f);bad.evidence.stock_universe[0].payload.trading_status=status;const row=collect(bad).rows[1];assert.equal(row.eligible,false);assert(row.reject_reasons.includes('DISPOSITION_SPLIT_OR_CONTROLLED'));assert(verify(row,r));checks++;}
 for(const change of [x=>x.evidence.stock_universe=[],x=>x.evidence.stock_tickers[0].payload.stock_master_source_date='2026-09-17',x=>x.evidence.stock_tickers[0].payload.official_present=false]){const bad=structuredClone(f);change(bad);const row=collect(bad).rows[1];assert.equal(row.status,'DATA_GAP');assert(!verify(row,r));checks++;}
 const reordered=structuredClone(p.rows[1]);reordered.raw_ticker=Object.fromEntries(Object.entries(reordered.raw_ticker).reverse());assert(verify(reordered,r));checks++;
 const bad=structuredClone(p.rows[0]);bad.eligible=true;assert(!verify(bad,r));checks++;
 const duplicate=structuredClone(f);duplicate.evidence.stock_tickers.push(duplicate.evidence.stock_tickers[0]);assert.throws(()=>collect(duplicate),/DUPLICATE/);checks++;
 console.log(JSON.stringify({status:'passed',checks,scope:'isolated_A02_raw_universe_and_eligibility',production_complete:false}));
}
module.exports={fixture};
