"use strict";
(()=>{
  if(document.querySelector('[data-morning-scorecard-host]'))return;
  const host=document.createElement('aside');host.dataset.morningScorecardHost='1';
  (document.querySelector('main')||document.body).append(host);
  host.innerHTML=window.FUMAN_OPENING_REPORT_VIEW.render(null);
  fetch(window.FUMAN_OPENING_REPORT_VIEW.endpoint('/api/market-ai-live?briefingOnly=1'),{cache:'no-store'}).then(r=>{if(r.status===401||r.status===403)throw Error('請登入已開通權限的會員帳號後查看晨報');if(!r.ok)throw Error('晨報讀取失敗');return r.json();}).then(p=>{host.innerHTML=window.FUMAN_OPENING_REPORT_VIEW.render(p.openingMorningReport);}).catch(e=>{host.replaceChildren();const p=document.createElement('p');p.textContent=e.message;host.append(p);});
})();
