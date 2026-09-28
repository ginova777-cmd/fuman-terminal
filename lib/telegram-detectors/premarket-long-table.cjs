'use strict';
// User-confirmed first table row only. Recommendation, never an order API.
const ID='L_LOW_OPEN_FOREIGN_BUY_3';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function assess({current,previous,history=[],foreignHistory=[],baseDate,trial,previousClose,cost}){
 const rising=(a,b)=>finite(a)&&finite(b)?a>b:null;
 const both=(a,b)=>a===null||b===null?null:a&&b;
 const signals={kd:both(rising(current?.kd?.k,previous?.kd?.k),rising(current?.kd?.d,previous?.kd?.d)),rsi:both(rising(current?.rsi?.short,previous?.rsi?.short),rising(current?.rsi?.long,previous?.rsi?.long)),macd:rising(current?.macd?.histogram,previous?.macd?.histogram)};
 const values=Object.values(signals),up=values.filter(x=>x===true).length,unknown=values.filter(x=>x===null).length;
 const dates=history.slice(-3).map(r=>r.date);
 const foreign=dates.map(date=>{const rows=foreignHistory.filter(r=>r.date===date);return {date,net:rows.length===1&&finite(rows[0].net)?rows[0].net:null};});
 const dated=dates.length===3&&new Set(dates).size===3&&dates.at(-1)===baseDate&&dates.every((d,i)=>i===0||d>dates[i-1]);
 const checks={two_indicators_up:up>=2?true:up+unknown<2?false:null,foreign_buy_3:!dated||foreign.some(r=>r.net===null)?null:foreign.every(r=>r.net>0),trial_below_previous_close:trial?.verified===true&&finite(trial.price)&&finite(previousClose)?trial.price<previousClose:null,trial_below_cost:trial?.verified===true&&finite(trial.price)&&finite(cost)&&cost>0?trial.price<cost:null};
 const result=Object.values(checks),status=result.includes(false)?'not_matched':result.includes(null)?'insufficient_data':'matched';
 return {id:ID,direction:'long',status,checks,signals,up_count:up,foreign_history:foreign,base_date:baseDate,previous_close:previousClose??null,cost:cost??null,trial_price:trial?.price??null,target:finite(cost)&&cost>0?cost*1.03:null,target_basis:'top_net_buy_branch_buy_vwap_times_1_03',unresolved_rules:[]};
}
module.exports={ID,assess};
