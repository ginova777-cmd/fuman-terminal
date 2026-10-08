'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');const {hash,bytes}=require('./offline-store.cjs');
function load(name){const file=path.resolve(__dirname,'../../lib',name),req=createRequire(file),module={exports:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,require:n=>n==='./server-supabase-key'?{terminalSupabaseKey:()=>{throw Error('NETWORK_FORBIDDEN')},terminalSupabaseUrl:()=>{throw Error('NETWORK_FORBIDDEN')}}:req(n),process:{env:{}},Date,Intl,Map,Set,Number,console},{filename:file});return module.exports;}
const trend=load('strategy3-technical-trend-reader.js'),atr=load('strategy3-atr-rvol-reader.js');
function build({symbol,trade_date,epoch,asOf,daily,intraday,levelInput,sources,poolRow={}}){
 const raw={daily,intraday,levelInput,poolRow},source=sources;
 if(!source||source.sha256!==hash(bytes(raw))||source.symbol!==symbol||source.trade_date!==trade_date||source.epoch!==epoch||source.as_of!==asOf||Date.parse(source.available_at)>Date.parse(asOf)||!Number.isFinite(Date.parse(source.available_at)))throw Error('NATIVE_INPUT_IDENTITY');
 const technical=trend.evaluateStrategy3Trend(trend.indicatorTrend(trend.aggregateCompleted60m(intraday,trade_date,new Date(asOf)),'60m'),trend.indicatorTrend(trend.dailyBars(daily,trade_date,poolRow),'daily'));
 const values={technical,atr:atr.calculateAtrRvolEvidence({dailyRows:daily,intradayRows:intraday,tradeDate:trade_date,poolRow})};
 if(levelInput){if(levelInput.stock_id!==symbol||levelInput.trade_date!==trade_date||!Number.isFinite(Date.parse(levelInput.available_at))||Date.parse(levelInput.available_at)>Date.parse(asOf))throw Error('LEVEL_IDENTITY');values.levelInput=levelInput;}
 return Object.entries(values).map(([resource,payload])=>({type:'DATA_RESOURCE',resource,symbol,trade_date,epoch,payload,payload_sha256:hash(bytes(payload)),provenance:{symbol,trade_date,epoch,as_of:asOf,payload_sha256:hash(bytes(payload)),sources:[{source:source.source,version:source.version,available_at:source.available_at,sha256:source.sha256,raw}]}}));
}
module.exports={build};
