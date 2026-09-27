'use strict';
const {costTopBuyer}=require('./main-broker-cost.cjs');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
// Broker buys and institutional NET flows are different measures, not ownership.
function compare({branchRows,institutionalRows,symbol,baseDate}){
 const cost=costTopBuyer({rows:branchRows,symbol,baseDate}),branch=cost.selected?.[0];
 const rows=Array.isArray(institutionalRows)?institutionalRows:[];
 function flow(names){
  let buy=0,sell=0;const missing=[];
  for(const name of names){const found=rows.filter(r=>r.stock_id===symbol&&r.date===baseDate&&r.name===name);
   if(found.length!==1||![found[0].buy,found[0].sell].every(x=>finite(x)&&x>=0)){missing.push(name);continue;}
   buy+=found[0].buy;sell+=found[0].sell;
  }
  return missing.length?{status:'insufficient_data',missing,buy_shares:null,sell_shares:null,net_shares:null,net_lots:null}:{status:'complete',missing:[],buy_shares:buy,sell_shares:sell,net_shares:buy-sell,net_lots:(buy-sell)/1000};
 }
 const institutions={foreign:flow(['Foreign_Investor']),trust:flow(['Investment_Trust']),dealer:flow(['Dealer_self','Dealer_Hedging'])};
 const all=Object.values(institutions),total=all.every(x=>x.status==='complete')?all.reduce((n,x)=>n+x.net_shares,0):null;
 institutions.total={status:total===null?'insufficient_data':'complete',net_shares:total,net_lots:total===null?null:total/1000};
 const comparisons=Object.fromEntries(Object.entries(institutions).map(([key,x])=>[key,{numerator:'top_net_buy_broker_buy_shares',denominator:'institution_net_shares',ratio:branch&&finite(x.net_shares)&&x.net_shares>0?branch.buyVolume/x.net_shares:null,reason:!branch?'BROKER_DATA_MISSING':!finite(x.net_shares)?'INSTITUTION_DATA_MISSING':x.net_shares<=0?'NO_POSITIVE_NET_BUY_DENOMINATOR':null}]));
 return {contract:'broker_buy_institution_net_comparison_v1',symbol,base_date:baseDate,status:branch&&total!==null?'complete':'insufficient_data',unit:'shares',display_unit:'lots_1000_shares',branch:branch?{id:branch.id,name:branch.name,buy_shares:branch.buyVolume,sell_shares:branch.buyVolume-branch.netBuy,net_buy_shares:branch.netBuy,buy_lots:branch.buyVolume/1000,sell_lots:(branch.buyVolume-branch.netBuy)/1000,net_buy_lots:branch.netBuy/1000,buy_vwap:branch.buyCost}:null,institutions,comparisons,ownership_attribution:false,overnight_trader_identity_verified:false,threshold_applied:false,failed_checks:cost.failed_checks};
}
module.exports={compare};
