/* One display-only calendar contract for desktop, mobile and /88. */
(()=>{'use strict';if(window.__fumanMarketClosedBannerReady)return;window.__fumanMarketClosedBannerReady=true;
const id='fuman-market-closed-banner';
function show(p){
 const known=p?.ok===true&&typeof p.marketOpen==='boolean'&&p.displayEvidence?.contract==='market-calendar-display-v1';
 const open=known&&p.marketOpen;
 window.FUMAN_MARKET_CALENDAR=known?p:null;
 for(const node of [document.documentElement,document.body])if(node){node.dataset.marketOpen=known?String(open):'unknown';node.dataset.marketClosedProtection=String(!open);}
 let n=document.getElementById(id);
 if(open){n?.remove();window.dispatchEvent(new CustomEvent('fuman:market-calendar',{detail:p}));setTimeout(()=>{try{window.FUMAN_DESKTOP_FAST_BUNDLE_PRIME?.(true)}catch{}},800);return;}
 if(!n){n=document.createElement('aside');n.id=id;n.setAttribute('role','status');n.style.cssText='position:sticky;top:0;z-index:9999;margin:8px 0 12px;border:1px solid #f59e0b;border-radius:8px;background:#78350f;color:#fff7ed;padding:10px 12px;font-weight:800;line-height:1.5';(document.querySelector('main.dashboard')||document.querySelector('.dashboard')||document.querySelector('main')||document.body).prepend(n);}
 n.dataset.calendarState=known?'closed':'unverified';
 n.textContent=known?(p.closedReasonText||'市場休市')+'｜休市保護啟動，顯示最後交易日 '+p.displayTradeDate+'；不掃描、不寫空結果、不覆蓋 previous good。':'市場日曆待確認｜最後交易日尚未驗證；保留各模組原資料，不代表今日掃描成功。';
}
async function load(){for(let attempt=0;attempt<3;attempt++){try{const r=await fetch('/api/market-calendar?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('calendar unavailable');const p=await r.json();show(p);return;}catch{if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500));}}show(null);}load();
})();
