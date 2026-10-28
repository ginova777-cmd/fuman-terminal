'use strict';
function eligible(scan){
 const e=scan?.naturalSlotEvidence,start=Date.parse(scan?.startedAt),last=Date.parse(e?.lastRunTime);
 if(scan?.executionMode!=='natural'||!e||e.taskName!=='Fuman Strategy4 Cache 1600'||e.state!=='Running'||e.enabled!==true||!Number.isFinite(start)||!Number.isFinite(last)||Math.abs(start-last)>90000)return false;
 const local=new Date(last+8*3600000).toISOString();
 return local.slice(0,10)===scan.tradeDate&&local.slice(11,16)==='16:00'&&String(e.runnerPath||'').replace(/\\/g,'/').toLowerCase()==='c:/fuman-release-owner/prod81/run-strategy4.ps1';
}
module.exports={eligible};
