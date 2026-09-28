'use strict';
// Read-only integration entry: never imports delivery or schedules a second runner.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {digest}=require('../lib/telegram-detectors/premarket-plan-contract.cjs');
const {adaptDaily}=require('../lib/telegram-detectors/premarket-daily-source.cjs');
const {scoreB,buildBEvidence}=require('../lib/telegram-detectors/premarket-short-ranking.cjs');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
function dailyRows(snapshot,baseDate,tradeDate,asOf){
 return snapshot.symbols.map(source=>{const d=adaptDaily({source,symbol:source.symbol,baseDate,tradeDate,asOf});return {stock_id:source.symbol,source_complete:d.complete,reason:d.reason,cost:d.cost?.value??null,short_ranking:scoreB(d.short_rank_input?buildBEvidence(d.short_rank_input):{}),long_rank:null,long_rank_status:'LONG_RANKING_RULES_NOT_COMPLETE',previous:d.previous_ohlc||null,formal_direction:null};}).sort((a,b)=>(b.short_ranking.score??-1)-(a.short_ranking.score??-1)||a.stock_id.localeCompare(b.stock_id));
}
const escape=s=>String(s??'未確認').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(report){
 const table=(headers,rows)=>'<div style="overflow:auto"><table><thead><tr>'+headers.map(h=>'<th>'+escape(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+escape(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 return '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telegram 三階段流程</title><style>body{font:16px/1.6 sans-serif;margin:24px;background:#101827;color:#eef2ff}table{border-collapse:collapse;width:100%}td,th{padding:8px;text-align:left;border:1px solid #64748b}section{margin:24px 0}small{color:#cbd5e1}</style><h1>Telegram 三階段流程</h1><p>通知停送｜不下單｜正式整套尚未完成</p><small>'+escape(report.run_id)+'｜T '+escape(report.trade_date)+'｜T−1 '+escape(report.base_date)+'</small><p>本次資料來源 '+report.coverage.evaluated+' 檔；全市場涵蓋尚未證明。</p><section><h2>① T−1 資料與排名</h2><p>以下為既有空方條件分數排序，非已放行空方名單；完整多空排名規則待接齊。</p>'+table(['股票','主力成本','空方分數','缺資料','多方排名'],report.daily.map(r=>[r.stock_id,r.cost,r.short_ranking.score,r.short_ranking.missing.join('、'),r.long_rank_status]))+'</section><section><h2>② 試撮、支撐壓力與開盤判斷</h2>'+table(['股票','試撮','方向候選','參考價位','阻擋原因'],report.trials.map(r=>[r.stock_id,r.trial?.price,r.direction_candidate,r.references.map(x=>x.source+': '+x.price).join('／'),r.blockers.join('、')]))+'</section><section><h2>③ 盤中巨量／拉抬＋技術分析</h2><p>僅顯示來源可驗證的事件；零事件不代表全日完整掃描。</p>'+table(['股票','方向','偵測器','確認結果'],report.intraday.map(r=>[r.stock_id,r.required_direction,r.event?.event_type,r.gate?.reason||r.gate?.status]))+'</section></html>';
}
async function main(args=process.argv.slice(2)){
 const arg=k=>args.find(v=>v.startsWith('--'+k+'='))?.slice(k.length+3),stage=arg('stage')||'all';
 if(!['all','rank','trial','intraday'].includes(stage))throw Error('INVALID_STAGE');
 if(!arg('output'))throw Error('OUTPUT_REQUIRED');const dir=path.resolve(arg('output'));
 if(/(?:^|[\\/])(?:fuman-runtime|prod81|fuman-terminal-production[^\\/]*)[\\/]/i.test(dir+path.sep))throw Error('OUTPUT_MUST_NOT_BE_PRODUCTION');
 if(fs.existsSync(path.join(dir,'workflow-receipt.json')))throw Error('OUTPUT_ALREADY_HAS_RECEIPT');
 fs.mkdirSync(dir,{recursive:true});const now=arg('as-of')||new Date().toISOString();if(!Number.isFinite(Date.parse(now)))throw Error('INVALID_CLOCK');
 let staticFile=arg('static'),tradeDate=arg('date'),baseDate=arg('base-date'),trials=arg('trials'),calendar=arg('calendar');
 if(!staticFile){const c=require('../lib/telegram-detectors/premarket-source-collector.cjs').collect({runtimeRoot:arg('runtime-root')||'C:/fuman-runtime',now});
  if(!c.baseDate||!c.snapshot.symbols.length){const r={contract:'telegram_workflow_entry_receipt_v1',status:'blocked',complete:false,exitCode:2,first_blocker:!c.baseDate?'PREVIOUS_TRADING_DAY_NOT_PROVEN':'STATIC_SOURCE_MISSING',source_blockers:c.blockers,notifications_sent:0};fs.writeFileSync(path.join(dir,'workflow-receipt.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r));return r;}
  tradeDate=c.tradeDate;baseDate=c.baseDate;
  for(const [name,payload]of Object.entries({static:c.snapshot,trials:c.trialRows,calendar:c.calendar}))fs.writeFileSync(path.join(dir,'input-'+name+'.json'),JSON.stringify(payload));
  staticFile=path.join(dir,'input-static.json');trials=path.join(dir,'input-trials.json');calendar=path.join(dir,'input-calendar.json');
 }
 if(!tradeDate||!baseDate)throw Error('TRADE_DATE_AND_BASE_DATE_REQUIRED');
 const argv=['--premarket-validation','--static='+staticFile,'--date='+tradeDate,'--base-date='+baseDate,'--as-of='+now,'--output='+dir];
 for(const [key,value]of [['trials',trials],['calendar',calendar],['intraday',arg('intraday')],['runtime-root',arg('runtime-root')]])if(value)argv.push('--'+key+'='+value);
 console.log('① 讀取 T−1 日K、法人、分點成本與既有空方評分');
 const daily=dailyRows(read(staticFile),baseDate,tradeDate,now);
 console.log('② 執行既有試撮／劇本判斷；③ 執行既有1分K偵測驗證');
 const {payload}=require('./run-premarket-validation.cjs').main(argv);
 const report={contract:'telegram_workflow_report_v1',run_id:payload.run_id,trade_date:tradeDate,base_date:baseDate,requested_view:stage,coverage:{...payload.coverage,full_market_verified:false},daily,trials:payload.rows,intraday:payload.observations,notifications_sent:0,formal_complete:false};
 for(const [name,value]of Object.entries({'workflow':report,'daily-ranking':daily,'trial-analysis':payload.rows,'intraday-signals':payload.observations}))fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(value,null,2));
 fs.writeFileSync(path.join(dir,'workflow.html'),html(report));
 const readback=digest(read(path.join(dir,'workflow.json')))===digest(report);if(!readback)throw Error('WORKFLOW_READBACK_FAILED');
 let ui=null;if(args.includes('--verify-ui')){console.log('驗證桌機／手機／88元件');ui=await require('./verify-premarket-validation-ui.cjs').verify({artifact:path.join(dir,'validation.json'),output:path.join(dir,'ui')});}
 const receipt={contract:'telegram_workflow_entry_receipt_v1',run_id:payload.run_id,status:'blocked',complete:false,exitCode:2,entry_execution_complete:true,local_readback_ok:readback,formal_complete:false,coverage:report.coverage,stages:{rank:{status:'blocked',reason:'FULL_MARKET_LONG_SHORT_RANKING_NOT_COMPLETE',artifact:'daily-ranking.json'},trial:{status:payload.status,artifact:'trial-analysis.json'},intraday:{status:'validation_only',artifact:'intraday-signals.json'}},ui_verified:ui?.complete===true,notifications_sent:0,orders_sent:0,report:path.join(dir,'workflow.html'),first_blocker:'FULL_MARKET_LONG_SHORT_RANKING_NOT_COMPLETE'};
 fs.writeFileSync(path.join(dir,'workflow-receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));return receipt;
}
if(require.main===module)main().then(r=>{process.exitCode=r.exitCode;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,dailyRows,html};
