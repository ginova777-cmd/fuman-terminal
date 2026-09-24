'use strict';
// Input is the source adapter's validated, preceding 20-minute window.
// This calculation does not certify historical baselines or emit events.
function summarize(rows, numerator, denominator) {
 const values=[];let zeros=0,invalid=0;
 for(const row of rows){
  const n=row?.[numerator],d=row?.[denominator];
  if(typeof n!=='number'||!Number.isFinite(n)||n<0||typeof d!=='number'||!Number.isFinite(d)||d<0){invalid++;continue;}
  if(d===0){zeros++;continue;}
  const value=n/d;if(!Number.isFinite(value)){invalid++;continue;}values.push(value);
 }
 values.sort((a,b)=>a-b);
 const count=values.length,mid=Math.floor(count/2);
 const baseline=count<10?null:count%2?values[mid]:values[mid-1]/2+values[mid]/2;
 return {sample_count:count,zero_denominator_count:zeros,invalid_count:invalid,baseline,
  status:invalid?'DATA_GAP':count<10?'INSUFFICIENT_SAMPLE':baseline<=0?'BASELINE_ZERO':'READY'};
}
function calculate(rows){
 if(!Array.isArray(rows)||rows.length>20)throw Error('INVALID_ROLLING_WINDOW');
 return {method:'ROLLING_20M_MEDIAN',minimum_samples:10,
  outside:summarize(rows,'outside_1m','inside_1m'),inside:summarize(rows,'inside_1m','outside_1m')};
}
module.exports={calculate};
