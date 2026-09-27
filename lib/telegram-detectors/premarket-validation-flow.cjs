'use strict';
const crypto=require('node:crypto');
const {digest}=require('./premarket-plan-contract.cjs');
const {sourceFor}=require('./premarket-validation-sources.cjs');
const {reviewCase}=require('./premarket-scenario-workflow.cjs');
const gate=require('./level-cross-gate.cjs');
const {normalize}=require('./level-source.cjs');
const {historicalSupports}=require('./premarket-short-decision.cjs');
const detectors=[require('./volume-detector.cjs'),require('./price-detector.cjs')];
const CONTRACT='telegram_premarket_validation_v1';
function runValidation({snapshot,trialRows=[],calendar=null,symbols,tradeDate,baseDate,asOf,groups={},histories={},quotes={}}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(baseDate||'')||!Number.isFinite(Date.parse(asOf)))throw Error('VALIDATION_DATE_REQUIRED');
 if(!Array.isArray(snapshot?.symbols))throw Error('STATIC_SNAPSHOT_REQUIRED');
 const selected=symbols||snapshot.symbols.map(s=>s.symbol);
 if(new Set(selected).size!==selected.length||selected.some(s=>!/^\d{4}$/.test(s)))throw Error('INVALID_SYMBOL_SET');
 const map=new Map();for(const source of snapshot.symbols){if(map.has(source.symbol))throw Error('DUPLICATE_SOURCE_SYMBOL');map.set(source.symbol,source);}
 const runId='premarket-validation-'+crypto.randomUUID(),rows=[],observations=[],previews=[];
 for(const symbol of selected){
  const source=map.get(symbol),inputs=sourceFor({source,symbol,tradeDate,baseDate,asOf,trialRows,calendar});
  const {daily,trial}=inputs;
  const current=daily.short_rank_input?.current,previous=daily.short_rank_input?.previous;
  const trend=current&&previous?{kd:current.kd.k>previous.kd.k&&current.kd.d>previous.kd.d?'up':'other',rsi:current.rsi.short>previous.rsi.short&&current.rsi.long>previous.rsi.long?'up':'other',macd:current.macd.histogram>previous.macd.histogram?'up':'other'}:{};
  const review=reviewCase({stock_id:symbol,base_date:baseDate,trade_date:tradeDate,source:'validation_source',previous:daily.previous_ohlc,trial,branch_rows:source?.branch_rows,institutional_rows:source?.institutional_rows,history:daily.history,short_rank_input:daily.short_rank_input,foreign_history:daily.foreign_history,daily_trend:trend});
  const candidates=review.scenario_candidates;
  // Retain unconfirmed strategies explicitly; observation is never permission.
  const blockers=[...inputs.blockers,'ADDITIONAL_VETO_RULES_PENDING',...(candidates.length?[]:['NO_MATCHING_CONFIRMED_SCENARIO'])];
  const direction=review.scenario_assessments.some(s=>s.status==='matched'&&s.id!=='A_UPPER_SHADOW_REBOUND_REVIEW')&&inputs.blockers.length===0?'short':'none';
  const row={stock_id:symbol,base_date:baseDate,trial,cost:daily.cost||null,ranking:review.ranking,broker_comparison:review.broker_comparison,scenario_assessments:review.scenario_assessments,scenarios:candidates,positions:review.positions,references:review.references,support:review.historical_support,targets:review.observation_targets,direction_candidate:direction,preopen_action:'NO_TRADE',formal_eligible:false,blockers:[...new Set(blockers)],provenance:{source_sha256:inputs.source_sha256,source_fetched_at:daily.source_fetched_at||null,calendar:inputs.calendar,calculation:daily.calculation||null},notification_preview:`【盤前劇本・驗證未發送】${symbol}\n${candidates.map(c=>c.id).join('／')||'未命中已定義劇本'}\n主力成本 ${daily.cost?.value??'缺資料'}\n試撮 ${trial.price??'缺資料'}\n動作：先不掛\n原因：${blockers.join('、')}`};
  row.historical_support_levels=historicalSupports({bars:daily.history,baseDate,trialPrice:Number.MAX_VALUE}).levels;
  rows.push(row);previews.push({category:'premarket_scenario',stock_id:symbol,text:row.notification_preview,sent:false});
  previews.push({category:'preopen_action',stock_id:symbol,text:`【盤前掛單判斷・驗證未發送】${symbol}｜先不掛｜${row.blockers.join('、')}`,sent:false});
  const bars=groups[symbol]||[],levelInput=normalize({symbol,tradeDate,previousDate:baseDate,source,bars,quote:quotes[symbol],now:asOf});
  const events=[];
  for(const detector of detectors){try{events.push(...detector.detect({stock_id:symbol,trade_date:tradeDate,current:bars,history:histories[symbol]||[],as_of:asOf,previous_close:daily.previous_ohlc?.close}).events);}catch(error){row.blockers.push('INTRADAY_SOURCE_INVALID:'+error.message);}}
  for(const event of events){
   let result;
   if(direction==='none')result={status:'source_missing',eligible:false,reason:'VALIDATED_DIRECTION_UNAVAILABLE',matches:[]};
   else try{result=gate.evaluate({event,bars,levelInput,now:asOf,requiredDirection:direction});}catch(error){result={status:'source_missing',eligible:false,reason:error.message,matches:[]};}
   const age=(Date.parse(asOf)-Date.parse(result.confirmed_at))/1000;
   const fresh=result.eligible===true&&age>=60&&age<=120;
   const observation={stock_id:symbol,event,required_direction:direction,gate:result,levelInput,fresh_confirmation:fresh,notification_allowed:false,blocking_reasons:[...row.blockers,...(result.eligible&&!fresh?['CONFIRMATION_OUTSIDE_120_SECONDS']:[])]};observations.push(observation);
   if(fresh)previews.push({category:'intraday_direction',stock_id:symbol,sent:false,text:`【盤中訊號・驗證未發送】${symbol}｜做空｜${result.matches.map(m=>`${m.level_id} ${m.price} ${m.indicators.join('/')}死亡交叉`).join('；')}｜正式放行仍阻擋`});
  }
 }
 rows.sort((a,b)=>(b.ranking.score??-1)-(a.ranking.score??-1)||a.stock_id.localeCompare(b.stock_id));
 return {contract:CONTRACT,run_id:runId,mode:'validation',trade_date:tradeDate,base_date:baseDate,checked_at:asOf,status:rows.length?'blocked':'empty',complete:false,formal_complete:false,notifications_sent:0,rows,rows_sha256:digest(rows),observations,notification_previews:previews,coverage:{requested:selected.length,evaluated:rows.length,static_source_total:snapshot.symbols.length},first_blocker:rows[0]?.blockers[0]||'NO_ROWS',source_sha256:digest(snapshot),no_send:true};
}
module.exports={CONTRACT,runValidation};
