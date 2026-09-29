'use strict';
const stages=require('./opening-report-stage-contract');
function validIndustrySource(p,{stage,checked}){
 const d=p?.overseas_leader_detection,rows=d?.leaders;
 if(!Array.isArray(rows)||!rows.length||d.industry!==p.industry||d.leader_count!==rows.length||new Set(rows.map(r=>r.yahoo_symbol)).size!==rows.length)return false;
 if(!rows.every(r=>typeof r.yahoo_symbol==='string'&&r.yahoo_symbol&&stages.allowed(r.yahoo_symbol,stage)))return false;
 const valid=rows.filter(r=>r.ok===true&&r.percent!==null&&r.percent!==''&&Number.isFinite(Number(r.percent)));
 if(!valid.length||d.valid_count!==valid.length||d.unavailable_count!==rows.filter(r=>r.ok!==true).length)return false;
 if(!valid.every(r=>typeof r.source==='string'&&r.source&&Number.isFinite(Date.parse(r.source_time))&&Date.parse(r.source_time)<=checked&&r.source_gap!==true))return false;
 const average=Number((valid.reduce((s,r)=>s+Number(r.percent),0)/valid.length).toFixed(2));
 return average>0&&d.average_percent===average&&p.overseas_return_1d_pct===average;
}
module.exports={validIndustrySource};
