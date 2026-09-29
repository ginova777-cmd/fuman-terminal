'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const normalize=s=>String(s||'').normalize('NFKC').replace(/[\s\-－–—]/g,'');
function evaluate(row,date){
 const d=row.daily_metrics||{},b=row.top_buy_branch;
 const sameDate=d.trade_date===date&&b?.date===date;
 const checks={closing_limit_up:typeof d.limit_locked==='boolean'?d.limit_locked:null,top_branch:b?normalize(b.securities_trader)==='凱基城中':null,cost_equals_close:finite(b?.price)&&finite(d.close)&&d.close>0?Math.abs(b.price-d.close)<1e-8:null,same_trade_date:sameDate};
 const values=Object.values(checks),matched=values.includes(false)?false:values.includes(null)?null:true;
 return {rule:'CLOSING_LIMIT_KGI_CHENGZHONG_COST_EQUALS_CLOSE',matched,points:matched===true?1:0,checks,trade_date:date,branch:b?.securities_trader||null,cost:b?.price??null,close:d.close??null,limit_price:d.limit_price??null,limit_source:d.limit_source||null,branch_source:b?.source||null,equality_policy:'raw values; absolute tolerance 1e-8 for floating point only; no display rounding',scope:'HIGH_DISTRIBUTION_SCENARIO_ONLY'};
}
module.exports={evaluate,normalize};
