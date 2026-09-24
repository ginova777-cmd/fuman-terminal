'use strict';
function verifyRules(r){const fail=[];
const check=(v,msg)=>{if(!v)fail.push(msg);};
const finite=Number.isFinite,close=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<1e-8;
const expectedA=[],expectedB=[];
for(const x of r.rows){
 const p=x.premarket_final,s=p.month_slope_raw,l=p.boll_level_raw,d=x.dual_scenario;
 const hist=p.slope_history||[];
 if(p.status==='OK'){
  check(close(s,(p.ma20_today/p.ma20_yesterday-1)*100),x.symbol+':slope');
  check(close(l,5*(p.close-p.ma20_today)/p.std20),x.symbol+':boll');
 }
 if(finite(p.slope_delta)){
  check(close(p.slope_delta,s-p.month_slope_yesterday),x.symbol+':delta');
  let n=0;for(let i=hist.length-1;i>0;i--){if(!finite(hist[i].value)||!finite(hist[i-1].value)||hist[i].value>=hist[i-1].value)break;n++;}
  check(n===p.slope_down_days,x.symbol+':down_days');
 }
 const a=finite(s)&&finite(l)&&s<0&&l>-5&&l<8;
 const weak=x.hourly_evidence?.trend==='TURNING_BEARISH'||x.daily_metrics.all_ma_down===true;
 const high=finite(l)&&Math.floor(l+0.5)>=8;
 const background=(finite(x.daily_metrics.change_percent)&&x.daily_metrics.change_percent>5)||x.daily_metrics.limit_locked===true||x.telegram_intraday_notification?.status==='SENT';
 const b=high&&background;
 check(d.b.level_gate_value===(finite(l)?Math.floor(l+0.5):null)&&d.b.level_gate_policy==='round_integer_gte_8',x.symbol+':rounded_gate');
 check(x.b_condition_score.checks['B布林位置符合']===(finite(l)?Math.floor(l+0.5)>=8:null),x.symbol+':rounded_score');
 check(d.a.pass===a,x.symbol+':a');check(d.b.pass===b,x.symbol+':b');
 const gap=!finite(x.daily_metrics.change_percent)||typeof x.daily_metrics.limit_locked!=='boolean'||!['SENT','NO_SENT_BURST'].includes(x.telegram_intraday_notification?.status);
 check(d.b.grade===(b?weak?'B-CANDIDATE':'B-WATCH':!finite(l)||high&&gap?'UNKNOWN':'REJECT'),x.symbol+':b_grade');
 check(d.b.confirmed===null&&d.b.short_entry_signal===null,x.symbol+':NO_AUTOMATIC_ENTRY');
 if(x.daily_metrics.volume_lots>2000){if(a)expectedA.push(x);if(b)expectedB.push(x);}
 for(const key of ['condition_score','b_condition_score'])check(x[key].score===Object.values(x[key].checks).filter(v=>v===true).length,x.symbol+':'+key);
 const bonus=x.branch_priority,branch=x.top_buy_branch,daily=x.daily_metrics;
 const isChengzhong=String(branch?.securities_trader||'').normalize('NFKC').replace(/[\s\-－–—]/g,'')==='凱基城中';
 const expectedBonus=daily.limit_locked===true&&isChengzhong&&finite(branch?.price)&&finite(daily.close)&&Math.abs(branch.price-daily.close)<1e-8&&branch.date===r.trade_date&&daily.trade_date===r.trade_date;
 check(bonus?.points===(expectedBonus?1:0),x.symbol+':BRANCH_BONUS');
 check(x.b_condition_score.checks['漲停＋凱基城中買一成本等於收盤']===bonus?.matched,x.symbol+':BONUS_SCORE_MAPPING');
 check(x.b_condition_score.max_score===9&&x.condition_score.max_score===8,x.symbol+':MAX_SCORE');
 if(expectedBonus){check(close(daily.close,daily.limit_price),x.symbol+':LIMIT_CLOSE');check(daily.limit_source_status==='OK',x.symbol+':LIMIT_SOURCE');}
}
const ordered=(a,key)=>a.sort((x,y)=>y[key].score-x[key].score||x.symbol.localeCompare(y.symbol)).map(x=>x.symbol);
check(JSON.stringify(ordered(expectedA,'condition_score'))===JSON.stringify(r.premarket_final.a_symbols),'A_ORDER_OR_MEMBERSHIP');
check(JSON.stringify(ordered(expectedB,'b_condition_score'))===JSON.stringify(r.premarket_final.b_symbols),'B_ORDER_OR_MEMBERSHIP');
const union=[...new Set([...r.premarket_final.a_symbols,...r.premarket_final.b_symbols])].sort();
check(JSON.stringify(union)===JSON.stringify([...r.premarket_final.symbols].sort()),'UNION');

return {ok:fail.length===0,issues:fail,checked:r.rows.length};}
module.exports={verifyRules};
