"use strict";
const {CONTRACT,PARAMETERS,MIN_BARS}=require('./institution-daily-indicators.cjs');
function checkCoverage(coverage){
 return coverage?.indicatorContract===CONTRACT;
}
function checkTrend(trend){
 if(trend?.indicatorContract!==CONTRACT)return false;
 for(const frame of ['daily','hourly60']){
  const e=trend[frame];
  if(frame==='daily'&&!e?.available)return false;
  if(!e?.available)continue; // Optional missing hourly evidence remains optional.
  if(e.contract!==CONTRACT||e.parameters?.rsiFast!==5||e.parameters?.rsiSlow!==15||e.parameters?.rsiMethod!==PARAMETERS.rsiMethod)return false;
  if(e.rsiEvidence?.contract_version!==CONTRACT||e.rsiEvidence?.fast_period!==5||e.rsiEvidence?.slow_period!==15||e.rsiEvidence?.warmup!==MIN_BARS)return false;
  if(e.barCount<MIN_BARS||!['rsi5','rsi15','rsi5Prev','rsi15Prev'].every(k=>Number.isFinite(e[k])))return false;
 }
 return true;
}
module.exports={CONTRACT,checkCoverage,checkTrend};
