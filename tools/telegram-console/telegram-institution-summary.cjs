'use strict';
function summarize({rows,symbol,baseDate,dates}){
 const net=(date,name)=>{const a=rows.filter(r=>r.stock_id===symbol&&r.date===date&&r.name===name);return a.length===1&&[a[0].buy,a[0].sell].every(v=>Number.isFinite(v)&&v>=0)?a[0].buy-a[0].sell:null;};
 const day=date=>{const own=net(date,'Dealer_self'),hedge=net(date,'Dealer_Hedging');return {foreign:net(date,'Foreign_Investor'),trust:net(date,'Investment_Trust'),dealer_total:own===null||hedge===null?null:own+hedge};};
 const ordered=[...new Set(dates)].filter(d=>d<=baseDate).sort().reverse(),current=day(baseDate),streaks=[];
 if(ordered[0]!==baseDate)return {current,streaks};
 for(const [key,label]of [['foreign','外資'],['trust','投信'],['dealer_total','自營']]){
 const value=current[key];if(value===null||value===0)continue;const sign=Math.sign(value);let count=0,censored=true;
 for(const date of ordered){const n=day(date)[key];if(n===null)break;if(Math.sign(n)!==sign){censored=false;break;}count++;}
 if(count>=2)streaks.push({key,label,direction:sign>0?'買':'賣',days:count,at_least:censored});
 }
 return {current,streaks};
}
module.exports={summarize};
