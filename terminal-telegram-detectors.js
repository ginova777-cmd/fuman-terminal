(()=>{
 'use strict';
 if(document.getElementById('telegram-detector-audit'))return;
 const box=document.createElement('details');box.id='telegram-detector-audit';
 box.style.cssText='position:relative;margin:12px;padding:12px;border:1px solid #64748b;border-radius:10px;background:#101827;color:#f1f5f9;font:14px/1.6 sans-serif;overflow:auto';
 const title=document.createElement('summary');title.textContent='盤中三通知｜瞬間巨量・瞬間拉抬・動態外盤';box.append(title);
 const body=document.createElement('div');body.textContent='展開後讀取驗收狀況';box.append(body);
 (document.querySelector('main')||document.body).append(box);
 let loading=false,loaded=false;
 function line(text){const e=document.createElement('p');e.textContent=text;body.append(e);}
 function paint(p){
  body.replaceChildren();box.dataset.runId=p.run_id||'';box.dataset.tradeDate=p.trade_date||'';box.dataset.eventsSha256=p.events_sha256||'';box.dataset.eventCount=String(p.event_count??0);box.dataset.status=p.status||'blocked';
  const replay=p.mode==='replay'||p.scope==='replay_integration_only';
  line(replay?'歷史回放驗收｜未發送 Telegram，尚非正式 COMPLETE':p.complete===true?'正式驗收 COMPLETE':p.status==='empty'?'尚無當日偵測結果':'正式驗收未完成');
  if(p.trade_date)line('資料日期：'+p.trade_date+'｜批次：'+p.run_id);
  if(p.first_blocker)line('待處理：'+p.first_blocker);
  if(p.data_gaps?.length)line('水源缺口：'+p.data_gaps.length+' 筆');
  line('5 分 K：僅為加分項目');
  const labels={VOLUME_ANOMALY_EVENT:'瞬間巨量',PRICE_UP_ANOMALY_EVENT:'瞬間拉抬',RAW_OUTSIDE_STRENGTH_EVENT:'外盤強勢 RAW',DYNAMIC_OUTSIDE_STRENGTH_EVENT:'動態外盤'};
  const events=Array.isArray(p.events)?p.events:[];
  if(!events.length){line(p.complete===true?'本次完整掃描無符合事件':'目前沒有可顯示事件');return;}
  line('事件總數：'+events.length+'｜完整顯示，RAW／DYNAMIC 分開記錄');
  const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse;white-space:nowrap';
  const header=table.insertRow();for(const name of ['時間','股票','偵測器','倍率','交付']){const cell=document.createElement('th');cell.textContent=name;cell.style.textAlign='left';header.append(cell);}
  for(const e of events){const tr=table.insertRow(),time=Date.parse(e.timestamp),display=Number.isFinite(time)?new Date(time+28800000).toISOString().slice(11,16):'時間缺漏',symbol=e.stock_id||e.symbol||'',ratio=e.event_type==='VOLUME_ANOMALY_EVENT'?e.primary_ratio:e.event_type==='PRICE_UP_ANOMALY_EVENT'?e.primary_price_spike_ratio:e.event_type==='RAW_OUTSIDE_STRENGTH_EVENT'?e.raw_outside_strength:e.primary_dynamic_ratio;
   const id=Number.isFinite(time)?`${p.trade_date}:${symbol}:${new Date(time).toISOString()}:${e.event_type}`:'';const delivery=p.deliveries?.find(x=>x.event_id===id);
   for(const text of [display,symbol,labels[e.event_type]||e.event_type,Number.isFinite(ratio)?ratio.toFixed(2)+'×':'缺資料',replay?'回放未發送':delivery?.status==='delivered'?`${delivery.confirmed_count}/${delivery.target_count} 已交付`:'未確認']){const c=tr.insertCell();c.textContent=text;c.style.padding='4px 10px 4px 0';}
  }body.append(table);
 }
 async function load(){if(loading||loaded)return;loading=true;body.textContent='正在讀取三偵測器資料…';try{const r=await fetch('/api/telegram-detectors',{cache:'no-store'});const p=await r.json();paint(p);loaded=true;}catch{paint({status:'blocked',first_blocker:'三偵測器資料無法讀取',events:[]});}finally{loading=false;}}
 box.addEventListener('toggle',()=>{if(box.open)load();});
 if(new URLSearchParams(location.search).get('telegram-audit')==='1'){box.open=true;load();}
})();
