'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {build}=require('../lib/tom-manifest.cjs');
function read(file,max=262144){const b=fs.readFileSync(file);if(b.length>max)throw Error('input_budget_exceeded');return {value:JSON.parse(b.toString('utf8').replace(/^\uFEFF/,'')),sha256:crypto.createHash('sha256').update(b).digest('hex')};}
function main(){
 const runtime=path.resolve(process.argv[2]||'C:/fuman-runtime'),policy=read(path.join(runtime,'config/tom-manifest-policy.json'));
 const now=new Date().toISOString(),year=new Intl.DateTimeFormat('en',{timeZone:'Asia/Taipei',year:'numeric'}).format(new Date(now));
 const calendar=read(path.join(runtime,'state',`twse-holiday-schedule-${year}.json`));
 // Overrides need an explicitly reviewed adapter; never silently ignore formal closure overrides.
 for(const file of [process.env.FUMAN_MARKET_CALENDAR_OVERRIDE_FILE,path.join(runtime,'data/market-calendar-overrides.json'),path.resolve(__dirname,'../data/market-calendar-overrides.json')].filter(Boolean))if(fs.existsSync(file))throw Error('calendar_override_requires_review:'+file);
 const command="$ErrorActionPreference='Stop'; @(Get-ScheduledTask | Where-Object {$_.TaskName -like 'Fuman*'} | ForEach-Object {[pscustomobject]@{name=$_.TaskName;state=[string]$_.State;actions=@($_.Actions|Select-Object Execute,Arguments,WorkingDirectory);triggers=@($_.Triggers|Select-Object StartBoundary,Enabled,DaysOfWeek)}}) | ConvertTo-Json -Depth 6 -Compress";
 const raw=cp.execFileSync('pwsh.exe',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:1048576});
 const result=build({now,calendar:calendar.value,tasks:JSON.parse(raw),policy:policy.value,runtimeRoot:runtime});
 result.evidence={policySha256:policy.sha256,calendarSha256:calendar.sha256,schedulerSha256:crypto.createHash('sha256').update(raw).digest('hex'),observedAt:now};
 console.log(JSON.stringify(result));
}
if(require.main===module)main();
