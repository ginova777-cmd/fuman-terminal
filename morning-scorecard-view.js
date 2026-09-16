"use strict";
(()=>{
  if(document.querySelector('[data-morning-scorecard-host]'))return;
  const host=document.createElement('aside');host.dataset.morningScorecardHost='1';
  (document.querySelector('main')||document.body).append(host);
  host.innerHTML=window.FUMAN_OPENING_REPORT_VIEW.render(null);
  fetch('/api/market-ai-live?briefingOnly=1',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('晨報讀取失敗');return r.json();}).then(p=>{host.innerHTML=window.FUMAN_OPENING_REPORT_VIEW.render(p.openingMorningReport);}).catch(()=>{host.innerHTML=window.FUMAN_OPENING_REPORT_VIEW.render({ok:false,reason_code:'晨報資料讀取失敗，請重新整理'});});
})();
