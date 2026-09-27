'use strict';
// Original user cases, never provider-verified market snapshots.
module.exports=[
 {stock_id:'3450',name:'聯鈞',source:'user_provided_case',base_date:'2026-09-23',trade_date:'2026-09-24',previous:{open:533,high:549,low:517,close:520},trial:{price:516,verified:false},plan_cost:529,daily_trend:{kd:'down',rsi:'down',macd:'down'},institutions_reported:{foreign:-609,trust:-63,dealer_total:-59},case_target_drop_pct:.02,user_expected_action:'LIMIT_DOWN_SHORT',expected_candidate:'B_BREAK_LOW_CONTINUATION',reported_observation_levels:[506,516]},
 {stock_id:'2368',name:'金像電',source:'user_provided_case',base_date:'2026-09-23',trade_date:'2026-09-24',previous:{open:1085,high:1140,low:1030,close:1140},trial:{price:1135,verified:false},plan_cost:1105,daily_trend:{kd:'up',rsi:'up',macd:'up'},institutions_reported:{foreign:-554,trust:505,dealer_total:200},foreign_consecutive_sell_days_reported:4,case_target_drop_pct:.04,user_expected_action:'LIMIT_DOWN_SHORT',expected_candidate:'A_DISTRIBUTION_DIVERGENCE',reported_observation_levels:[1090,1111]}
];
