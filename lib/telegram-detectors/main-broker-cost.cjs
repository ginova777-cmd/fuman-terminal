'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function costTopBuyer({rows,symbol,baseDate}){
 const failed=[],brokers=new Map();
 if(!/^\d{4}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)||!Array.isArray(rows)||!rows.length)return {valid:false,value:null,failed_checks:['BRANCH_SOURCE_MISSING']};
 for(const r of rows){
  if(r.stock_id!==symbol||r.date!==baseDate||!r.securities_trader_id||!finite(r.price)||r.price<=0||!finite(r.buy)||r.buy<0||!finite(r.sell)||r.sell<0){failed.push('BRANCH_ROW_INVALID');continue;}
  const id=String(r.securities_trader_id),p=brokers.get(id)||{id,buy:0,sell:0,buyAmount:0,name:r.securities_trader||null};
  p.buy+=r.buy;p.sell+=r.sell;p.buyAmount+=r.price*r.buy;brokers.set(id,p);
 }
 if(failed.length)return {valid:false,value:null,failed_checks:[...new Set(failed)]};
 const selected=[...brokers.values()].filter(p=>p.buy>p.sell).sort((a,b)=>(b.buy-b.sell)-(a.buy-a.sell)||a.id.localeCompare(b.id)).slice(0,1).map(p=>({id:p.id,name:p.name,netBuy:p.buy-p.sell,buyVolume:p.buy,buyAmount:p.buyAmount,buyCost:p.buyAmount/p.buy}));
 const value=selected[0]?.buyCost??null;
 return {valid:finite(value)&&value>0,value,method:'top_net_buy_branch_buy_vwap',selected,failed_checks:value===null?['NO_POSITIVE_NET_BUY_BRANCH']:[]};
}
module.exports={costTopBuyer};
