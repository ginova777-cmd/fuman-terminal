#!/usr/bin/env node
"use strict";
const assert=require("assert/strict"),{resolveBranches,MACD_PARAMETERS}=require("./daytrade-intraday-5m-v4");
const cases=[[[true,false,false,false,false,false],true,"CONFIRMED_STRONG_5M"],[[false,true,false,false,false,false],true,"CONFIRMED_STRONG_5M"],[[false,false,true,false,false,false],true,"CONFIRMED_STRONG_5M"],[[false,false,false,true,false,false],true,"CONFIRMED_STRONG_5M"],[[false,false,false,false,true,false],true,"CONFIRMED_STRONG_5M"],[[false,false,false,false,false,true],true,"CONFIRMED_STRONG_5M"],[[false,false,false,false,false,false],true,"WAIT_5M_CONFIRMATION"],[[false,false,null,false,false,false],true,"DATA_GAP_5M"],[[true,false,false,false,false,false],false,"DATA_GAP_5M"],[[false,false,false,false,false,false],false,"DATA_GAP_5M"]];
for(const [values,eligible,expected] of cases)assert.equal(resolveBranches(values,eligible).status,expected);
assert.deepEqual(MACD_PARAMETERS,{fast:3,slow:9,signal:3,histogram:"dif_minus_dea"});
const zeroCrossOnly=resolveBranches([false,false,false,false,false,false],true);assert.equal(zeroCrossOnly.status,"WAIT_5M_CONFIRMATION");
console.log(JSON.stringify({contract:"daytrade_intraday_5m_v4_unit_contract",status:"complete",complete:true,cases:cases.length+1,macd_parameters:MACD_PARAMETERS,zero_cross_is_not_golden_cross:true,exit_code:0},null,2));
