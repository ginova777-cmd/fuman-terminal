'use strict';
const {bounds}=require('./level-touch.cjs');
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
function calculate({trial,cost,previous={}}){
 const price=trial?.verified===true&&positive(trial.price)?trial.price:null;
 const rows=[];
 function add(id,kind,value,basis){const exact=positive(value)?value:null;rows.push({id,kind,price:exact,basis,status:exact===null?'source_missing':'ready',tick_range:exact===null?null:bounds(exact)});}
 add('PREVIOUS_HIGH','resistance',previous.high,'previous_day');
 add('COST','reference',cost,'top_net_buy_branch_buy_vwap');
 add('COST_PLUS_3','resistance',positive(cost)?cost*1.03:null,'top_net_buy_branch_buy_vwap');
 add('COST_PLUS_5','resistance',positive(cost)?cost*1.05:null,'top_net_buy_branch_buy_vwap');
 add('TRIAL_PLUS_3','resistance',price===null?null:price*1.03,'indicative_trial');
 add('TRIAL_PLUS_5','resistance',price===null?null:price*1.05,'indicative_trial');
 add('PREVIOUS_CLOSE','support',previous.close,'previous_day');
 add('PREVIOUS_LOW','support',previous.low,'previous_day');
 add('TRIAL_MINUS_2','support',price===null?null:price*.98,'indicative_trial');
 add('TRIAL_MINUS_5','support',price===null?null:price*.95,'indicative_trial');
 return {contract:'premarket_trial_price_levels_v1',status:price===null?'waiting_trial':'ready',trial_price:price,trial_at:trial?.timestamp||null,trial_source:trial?.source||null,trial_derived_complete:price!==null,all_references_complete:rows.every(r=>r.status==='ready'),levels:rows,requires_scenario_qualification:false,order_allowed:false,actual_open_substituted:false};
}
module.exports={calculate};
