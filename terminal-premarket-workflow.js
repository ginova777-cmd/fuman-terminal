(()=>{
 'use strict';
 if(document.getElementById('premarket-workflow'))return;
 const panel=document.createElement('details');panel.id='premarket-workflow';panel.style.cssText='margin:12px;padding:14px;background:#101827;color:#f1f5f9;border:1px solid #64748b;border-radius:10px;font:14px/1.6 sans-serif;overflow-wrap:anywhere';
 const summary=document.createElement('summary');summary.textContent='盤前劇本 → 盤中訊號｜驗證預覽';panel.append(summary);
 const body=document.createElement('div');body.textContent='展開查看；驗證模式不發送通知。';panel.append(body);(document.querySelector('main')||document.body).append(panel);
 const add=(parent,tag,text)=>{const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;};
 const number=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(2):'缺資料';
 const labels={A_DISTRIBUTION_DIVERGENCE:'A 高檔出貨背離候選',B_BREAK_LOW_CONTINUATION:'B 破昨低續弱',A_UPPER_SHADOW_REBOUND_REVIEW:'A 上影轉弱／反彈成本候選（門檻待確認）'};
 labels.L_LOW_OPEN_FOREIGN_BUY_3='低開外資連買多（表格第一列）';
 labels.A_COST_EXTENSION_DISTRIBUTION_REVIEW='A 成本上方乖離出貨空候選';
 labels.L_NEAR_COST_DEALER_BUY_REVIEW='多方：成本附近／自營商買超（案例候選）';
 const priceLabels={previous_high:'昨高',previous_low:'昨低',previous_close:'昨收',plan_cost:'主力成本',plan_cost_plus_3pct:'成本＋3%',plan_cost_plus_5pct:'成本＋5%'};
 const reasons={VALID_0859_TRIAL_MISSING:'缺少有效08:59試撮',CONFLICTING_0859_TRIAL:'08:59試撮資料衝突',CALENDAR_EVIDENCE_MISSING:'交易日曆證據不足',DAILY_HISTORY_CALENDAR_GAP:'歷史日K與日曆尚未完整核對',ADDITIONAL_VETO_RULES_PENDING:'額外否決條件待累積劇本確認',NO_MATCHING_CONFIRMED_SCENARIO:'尚未命中已定義劇本',DAILY_INPUT_INCOMPLETE:'日K或法人資料不完整'};
 function paint(p){
  body.replaceChildren();panel.dataset.runId=p.run_id||'';panel.dataset.rowsSha256=p.rows_sha256||'';panel.dataset.rowCount=String(p.rows?.length||0);panel.dataset.status=p.status||'blocked';
  add(body,'p','驗證模式｜Telegram 未發送｜不是正式 COMPLETE');
  add(body,'p',`資料日期：${p.trade_date||'尚無'}｜批次：${p.run_id||'尚無'}`);
  if(!p.rows?.length){add(body,'p',p.status==='empty'?'尚無盤前驗證結果':`無法讀取驗證結果：${p.first_blocker||'來源未就緒'}`);return;}
  add(body,'p',`檢查 ${p.coverage?.evaluated??p.rows.length} 檔／要求 ${p.coverage?.requested??p.rows.length} 檔；來源總數 ${p.coverage?.static_source_total??'未知'}。`);
  for(const row of p.rows){
   const card=document.createElement('section');card.dataset.symbol=row.stock_id;card.style.cssText='border-top:1px solid #64748b;padding:12px 0';body.append(card);
   add(card,'h3',`${row.stock_id}｜${row.scenario_assessments?.filter(s=>s.status==='matched').map(s=>labels[s.id]||s.id).join('／')||'未命中已定義劇本'}`);
   add(card,'p',`空方分數 ${row.ranking?.score??'未完成'}/12｜主力成本 ${number(row.cost?.value)}｜08:59 試撮 ${number(row.trial?.price)}`);
   add(card,'p',`第一分點：${row.cost?.selected?.[0]?.name||row.cost?.selected?.[0]?.id||'缺資料'}｜成本公式：買進金額 ÷ 買進量`);
   const priceLevels=row.trial_price_levels;
   if(priceLevels){
    const names={TRIAL_PLUS_3:'試撮＋3%壓力',TRIAL_PLUS_5:'試撮＋5%壓力',TRIAL_MINUS_2:'試撮－2%支撐',TRIAL_MINUS_5:'試撮－5%支撐'};
    add(card,'p',priceLevels.trial_derived_complete?'試撮價位已算出（不需等待劇本放行）':'等待有效試撮：收到後自動計算支撐／壓力');
    for(const level of priceLevels.levels.filter(x=>x.basis==='indicative_trial'))add(card,'p',`${names[level.id]}：${typeof level.price==='number'?Number(level.price.toFixed(6)):'缺資料'}${level.tick_range?`｜上下2 tick範圍 ${level.tick_range.lower}～${level.tick_range.upper}`:''}`);
    add(card,'p','以上基於盤前試撮；盤中開盤價位另依實際開盤計算。');
   }
   const comparison=row.broker_comparison;
   if(comparison){
    add(card,'p',`第一分點買進 ${number(comparison.branch?.buy_lots)} 張｜賣出 ${number(comparison.branch?.sell_lots)} 張｜淨買超 ${number(comparison.branch?.net_buy_lots)} 張`);
    const names={foreign:'外資',trust:'投信',dealer:'自營商含避險',total:'法人合計'};
    for(const [key,label] of Object.entries(names)){const ratio=comparison.comparisons?.[key]?.ratio;add(card,'p',`${label}淨買賣超 ${number(comparison.institutions?.[key]?.net_lots)} 張｜分點買進量對照比例 ${typeof ratio==='number'?number(ratio*100)+'%':'不適用／缺資料'}`);}
    add(card,'p','比例僅為數值對照，不代表法人歸屬；尚未設定大額門檻。');
   }
   const states={matched:'符合已列條件',not_matched:'未符合',insufficient_data:'資料不足'};
   for(const scenario of row.scenario_assessments||[])add(card,'p',`${labels[scenario.id]||scenario.id}：${states[scenario.status]||scenario.status}${scenario.unresolved_rules?.length?'；正式規則待確認':''}`);
   add(card,'p',`策略建議：${row.preopen_recommendation==='LIMIT_UP_LONG'?'掛漲停買（僅建議，未下單）':'先不掛'}｜方向候選：${row.direction_candidate==='long'?'多':row.direction_candidate==='short'?'空':'待確認'}｜自動下單：停用`);
   if(row.long_table_rule){const r=row.long_table_rule;add(card,'p',`低開外資連買多：向上 ${r.up_count}/3｜最近3個交易日外資淨買超：${r.foreign_history.map(x=>`${x.date} ${number(x.net)}`).join('、')}｜成本×1.03目標 ${number(r.target)}`);}
   add(card,'p',`歷史支撐：${number(row.support?.nearest?.price)}｜下方空間：${typeof row.support?.downside_space==='number'?(row.support.downside_space*100).toFixed(2)+'%':'待驗證'}`);
   add(card,'p',`歷史支撐參考：${(row.historical_support_levels||[]).map(x=>`${number(x.price)}（${x.kind==='swing_low'?'波段低點':'缺口'}）`).join('、')||'缺資料'}`);
   add(card,'p',`參考價：${(row.references||[]).map(x=>`${priceLabels[x.source]||x.source} ${number(x.price)}`).join('；')}`);
   add(card,'p',`推算觀察目標（不等於歷史支撐）：${(row.targets||[]).map(x=>number(x.price)).join('、')||'無'}`);
   add(card,'p',`待處理：${(row.blockers||[]).map(x=>reasons[x]||x).join('、')||'無'}`);
   if(row.provenance?.calendar?.historical?.reason==='HISTORICAL_CALENDAR_NOT_COVERED')add(card,'p','歷史資料提醒：較早年度尚未核對交易日連續性；當日與前一交易日已分開驗證。');
   const audit=document.createElement('details');add(audit,'summary','來源與檢核明細');add(audit,'p',(row.blockers||[]).join('、'));add(audit,'p',`來源時間：${row.provenance?.source_fetched_at||'缺資料'}｜來源識別：${row.provenance?.source_sha256||'缺資料'}`);card.append(audit);
   const detail=document.createElement('details');add(detail,'summary','通知內容預覽');card.append(detail);
   for(const preview of p.notification_previews?.filter(x=>x.stock_id===row.stock_id)||[])add(detail,'pre',preview.text).style.cssText='white-space:pre-wrap;font:inherit';
  }
  add(body,'p',`盤中事件：${p.observations?.length||0}｜已發送：0`);
 }
 let loaded=false;
 async function load(){if(loaded)return;loaded=true;try{const run=new URLSearchParams(location.search).get('premarket-run')||'';const r=await fetch('/api/premarket-workflow'+(run?'?run='+encodeURIComponent(run):''),{cache:'no-store'});if(r.status===401||r.status===403){body.replaceChildren();body.textContent='請登入已開通權限的會員帳號後查看';return;}if(!r.ok)throw Error('資料暫時無法讀取');const p=await r.json();if(p.contract&&p.contract!=='telegram_premarket_validation_v1')throw Error('CONTRACT_MISMATCH');paint(p);}catch(e){paint({status:'blocked',first_blocker:e.message,rows:[]});}}
 panel.addEventListener('toggle',()=>{if(panel.open)load();});
 if(new URLSearchParams(location.search).get('premarket-audit')==='1'){panel.open=true;load();}
})();
