'use strict';
const stages=require('./opening-report-stage-contract');
const map=require('../scripts/opening-report-0830-industry-map-contract').OPENING_REPORT_0830_INDUSTRY_MAP;
function completeZeroSource(e,{stage,checked}){
 if(e.aggregate?.priority_observation_mode!=='positive_industry_top3'||!Array.isArray(e.all_industry_payloads)||e.all_industry_payloads.length!==map.length)return false;
 return map.every(m=>{
  const p=e.all_industry_payloads.find(p=>p.industry===m.industry),d=p?.overseas_leader_detection;
  const expected=m.overseas_leaders.filter(l=>stages.allowed(l.yahoo_symbol,stage)).map(l=>l.yahoo_symbol).sort();
  if(!d||d.industry!==m.industry||!Array.isArray(d.leaders)||d.leader_count!==expected.length||d.valid_count!==expected.length||d.unavailable_count!==0)return false;
  const rows=d.leaders;if(JSON.stringify(rows.map(r=>r.yahoo_symbol).sort())!==JSON.stringify(expected))return false;
  if(!expected.length)return d.detection_enabled===false&&d.average_percent===null&&p.overseas_return_1d_pct===null;
  if(d.detection_enabled!==true||!rows.every(r=>r.ok===true&&typeof r.percent==='number'&&Number.isFinite(r.percent)&&r.source&&Number.isFinite(Date.parse(r.source_time))&&Date.parse(r.source_time)<=checked&&r.source_gap!==true))return false;
  const average=Number((rows.reduce((sum,r)=>sum+r.percent,0)/rows.length).toFixed(2));
  return average<=0&&d.average_percent===average&&p.overseas_return_1d_pct===average;
 });
}
module.exports={completeZeroSource};
