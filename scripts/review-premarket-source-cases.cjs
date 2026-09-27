'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {adaptDaily}=require('../lib/telegram-detectors/premarket-daily-source.cjs');
const {reviewCase}=require('../lib/telegram-detectors/premarket-scenario-workflow.cjs');
const cases=require('../lib/telegram-detectors/premarket-example-cases.cjs');
function build(snapshot,sourceHash){return {scope:'cached_source_case_audit',status:'blocked',complete:false,source_sha256:sourceHash,rows:cases.map(example=>{
 const source=snapshot.symbols?.find(s=>s.symbol===example.stock_id);
 const daily=adaptDaily({source,symbol:example.stock_id,baseDate:example.base_date,tradeDate:example.trade_date,asOf:example.trade_date+'T08:59:00+08:00'});
 if(!daily.short_rank_input)return {stock_id:example.stock_id,daily};
 const {current:c,previous:p}=daily.short_rank_input;
 const trend={kd:c.kd.k>p.kd.k&&c.kd.d>p.kd.d?'up':'not_both_up',rsi:c.rsi.short>p.rsi.short&&c.rsi.long>p.rsi.long?'up':'not_both_up',macd:c.macd.histogram>p.macd.histogram?'up':'not_up'};
 let consecutive=0;for(const row of [...daily.foreign_history].reverse()){if(row.net<0)consecutive++;else break;}
 return {stock_id:example.stock_id,daily,reported_foreign_sell_days:example.foreign_consecutive_sell_days_reported??null,observed_foreign_sell_records:consecutive,trial_source:'USER_EXAMPLE_NOT_VERIFIED_0859',review:reviewCase({...example,source:'cached_finmind_source',previous:daily.previous_ohlc,branch_rows:source.branch_rows,institutional_rows:source.institutional_rows,history:daily.history,short_rank_input:daily.short_rank_input,foreign_history:daily.foreign_history,daily_trend:trend})};
})};}
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('INPUT_AND_REVIEW_OUTPUT_REQUIRED');if(/fuman-runtime|prod81/i.test(path.resolve(output)))throw Error('REVIEW_OUTPUT_NOT_PRODUCTION');const raw=fs.readFileSync(input);const result=build(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')),crypto.createHash('sha256').update(raw).digest('hex'));fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,scope:result.scope,output}));}
module.exports={build};
