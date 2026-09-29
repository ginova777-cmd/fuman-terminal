'use strict';
const trajectory=require('./mother-pool-trial-trajectory');
const CONTRACT='preopen_a13_natural_trial_v1';
function identityOk(row,date){return Array.isArray(row?.raw_trials)&&row.raw_trials.length>0&&row.raw_trials.every(x=>x?.payload?.trade_date===date&&x.payload.run_id==='preopen_snapshot_history_v2:'+date.replaceAll('-','')&&x.payload.generation_id===row.symbol+':'+x.payload.observed_at&&Number.isFinite(Date.parse(x.observed_at))&&Date.parse(x.payload.observed_at)===Date.parse(x.observed_at));}
function collect(input){const plan=trajectory.collect(input);return {...plan,module_id:'A13',rows:plan.rows.map(row=>({...row,source_contract:CONTRACT,...(identityOk(row,input.identity.trade_date)?{}:{status:'DATA_GAP',data_gap_reason:row.data_gap_reason?row.data_gap_reason+'|TRIAL_RUN_IDENTITY_INVALID':'TRIAL_RUN_IDENTITY_INVALID'})}))};}
function verify(row,round){try{return row.source_contract===CONTRACT&&identityOk(row,round.trade_date)&&trajectory.verify({...row,source_contract:'preopen_a17_trial_trajectory_v1'},round);}catch{return false;}}
module.exports={collect,verify};
