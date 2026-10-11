'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..');
const authority=JSON.parse(fs.readFileSync(path.join(root,'data/contracts/release_root_authority_v1.json'),'utf8'));
const files=['verify-formal-strategy-schedule-authority.js','verify-fuman-schedule-registry-live-alignment.js','verify-scorecard88-fixed-collection-contract.js'];
const tests=[];
function run(file,mode){
 const f=path.join(__dirname,file),source=fs.readFileSync(f,'utf8'),req=createRequire(f),calls=[];
 let stdout='',thrown=null;const start=performance.now();
 const proc={execPath:process.execPath,argv:['node',f],env:{},exitCode:0,exit(code){this.exitCode=code;throw {exit:true};}};
 const fake={spawnSync(exe,args){calls.push({exe,args});
  if(args.some(x=>String(x).endsWith('verify-release-root-authority.js')))return {status:0,stdout:JSON.stringify({ok:true,productionClean:true,productionHead:mode==='bad-sha'?'wrong':authority.approvedProductionSha}),stderr:''};
  if(mode==='denied')return {status:1,stdout:'',stderr:'Access is denied'};
  if(mode==='empty')return {status:0,stdout:'',stderr:''};
  if(mode==='invalid')return {status:0,stdout:'broken payload',stderr:''};
  if(exe==='schtasks'){
   const name=args[args.indexOf('/TN')+1],time=name.includes('Strategy2')?'12:40':name.includes('Strategy3')?'13:15':name.includes('Strategy4')?'17:00':'21:40';
   const enabled=!name.includes('Strategy2')||mode==='paused-enabled';
   return {status:0,stderr:'',stdout:`<Task><Enabled>${enabled}</Enabled><LogonType>S4U</LogonType><Arguments>run-scorecard88-terminal-collector.ps1 -Slot "${mode==='bad-time'?'00:00':time}"</Arguments><StartBoundary>2026-10-12T${time}:00</StartBoundary></Task>`};
  }
  let rows;
  if(file===files[0]){
   const literal=source.slice(source.indexOf('const expected =')+16,source.indexOf('\n];',source.indexOf('const expected ='))+2);
   rows=vm.runInNewContext(literal).map(([name,marker,times])=>({name,state:name.includes('Strategy2')&&mode!=='paused-enabled'?'Disabled':'Ready',execute:marker.endsWith('.js')?'C:/Program Files/nodejs/node.exe':'C:/Program Files/PowerShell/7/pwsh.exe',arguments:`${marker.endsWith('.js')?'':'-File '}"${authority.productionRoot}\\${marker.includes('.')?marker:marker+'.ps1'}"`,workingDirectory:authority.productionRoot,logonType:'S4U',triggers:times.map(t=>({startBoundary:`2026-10-12T${t}:00`}))}));
   if(mode==='missing')rows=rows.filter(x=>!x.name.includes('Complete Scan 1300'));
   if(mode==='bad-root')rows.find(x=>x.name.includes('Complete Scan 1300')).workingDirectory='C:/unauthorized';
  }else{
   const registry=JSON.parse(fs.readFileSync(path.join(root,'scripts/fuman-schedule-registry.json'),'utf8'));
   rows=registry.policy.activeTasks.map(name=>({name,state:'Ready',arguments:'',triggers:registry.tasks.find(d=>(d.displayName||String(d.taskName||'').replace(/^\\+/,''))===name)?.expectedTriggers||[]}));
   if(mode==='missing')rows.pop();
  }
  return {status:0,stdout:JSON.stringify(rows),stderr:''};
 }};
 try{vm.runInNewContext(source,{require:x=>x==='child_process'?fake:x==='../lib/schedule-query-evidence.cjs'?{...req(x),rootPolicy:(c,g)=>req(x).rootPolicy(c,g,p=>path.win32.normalize(p))}:req(x),__dirname,__filename:f,process:proc,console:{log:x=>stdout+=x},Buffer},{timeout:10000});}catch(e){if(!e.exit){thrown=e.message;proc.exitCode=1;}}
 let report=null;try{report=JSON.parse(stdout);}catch{}
 return {file,mode,elapsedMs:performance.now()-start,exitCode:proc.exitCode,report,thrown,childCalls:calls.length};
}
for(const file of files){
 if(process.argv[2] && process.argv[2]!==file)continue;
 for(const mode of ['success','denied','empty','invalid',...(file===files[0]?['bad-sha','bad-root','missing','paused-enabled']:file===files[1]?['missing']:['bad-time','paused-enabled'])]){
  if(process.argv[3] && process.argv[3]!==mode)continue;
  const r=run(file,mode);let error=null;
  try{
   if(mode==='success'){assert.equal(r.exitCode,0,JSON.stringify(r));assert.equal(r.report.ok,true);}
   else{assert.notEqual(r.exitCode,0);if(['denied','empty','invalid'].includes(mode)){const issues=JSON.stringify(r.report?.issues||r.thrown);assert.match(issues,/SCHEDULE_QUERY/);assert(!/task_missing|missing_live|missing_or_disabled/.test(issues));}}
  }catch(e){error=e.message;}
  tests.push({...r,passed:error===null,assertionError:error});
 }
}
const result={scope:'isolated_actual_entry_vm_mock_queries_not_live_timing',tests,ok:tests.every(x=>x.passed)};
console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
