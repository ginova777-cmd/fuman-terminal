'use strict';
// Test-only provider adapters. No production endpoint, Task or credential is used.
const fs=require('fs'),path=require('path'),vm=require('vm'),cp=require('child_process'),{createRequire}=require('module');
async function evaluate(name,runtime,overrides={}){
 const file=path.join(__dirname,name),native=createRequire(file),stdout=[],stderr=[];
 const proc={argv:[process.execPath,file],execPath:process.execPath,platform:process.platform,env:{FUMAN_RUNTIME_DIR:runtime,FUMAN_RUNTIME_ROOT:runtime},exitCode:0,exit(code){this.exitCode=code;throw Error('fixture_exit:'+code);}};
 const ctx={__dirname,require:n=>Object.hasOwn(overrides,n)?overrides[n]:native(n),module:{exports:{}},process:proc,console:{log:(...v)=>stdout.push(v.join(' ')),warn:(...v)=>stderr.push(v.join(' ')),error:(...v)=>stderr.push(v.join(' '))},Buffer,URL,AbortSignal,AbortController,setTimeout,clearTimeout,fetch:overrides.fetch};vm.createContext(ctx);
 try{await vm.runInContext(fs.readFileSync(file,'utf8'),ctx);}catch(error){if(!String(error.message).startsWith('fixture_exit:'))throw error;}
 return {status:proc.exitCode||0,stdout:stdout.join('\n'),stderr:stderr.join('\n')};
}
async function execute(stage,runtime){
 const cache={};
 cache['verify-vercel-cost-guard.js']=await evaluate('verify-vercel-cost-guard.js',runtime,{fs:{...fs,readFileSync:(file,...args)=>String(file).replaceAll('\\','/').endsWith('/.vercel/project.json')?JSON.stringify({projectName:'fuman-terminal'}):fs.readFileSync(file,...args)}});
 cache['verify-vercel-project-inventory.js']=await evaluate('verify-vercel-project-inventory.js',runtime,{'child_process':{spawnSync:()=>({status:0,stdout:JSON.stringify({projects:[{name:'fuman-terminal'}]}),stderr:''})}});
 const mirror=path.join(runtime,'cost-mirror');
 if(!fs.existsSync(mirror)){fs.mkdirSync(mirror);for(const args of [['init','-b','main'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','Isolated fixture']]){const r=cp.spawnSync('git',args,{cwd:mirror,encoding:'utf8',windowsHide:true});if(r.status)throw Error(r.stderr);}}
 cache['verify-production-mirror-guard.js']=cp.spawnSync(process.execPath,[path.join(__dirname,'verify-production-mirror-guard.js')],{cwd:mirror,env:{...process.env,FUMAN_PRODUCTION_MIRROR_ROOT:mirror,FUMAN_RELEASE_SHA:'',FUMAN_DEPLOY_SHA:''},encoding:'utf8',windowsHide:true});
 cache['verify-retired-artifacts-clean.js']=cp.spawnSync(process.execPath,[path.join(__dirname,'verify-retired-artifacts-clean.js')],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',windowsHide:true});
 const auditRows=['fugle_intraday_1m','fugle_preopen_snapshot_history'].map(table_name=>({table_name,has_before_after_audit:true,keep_policy:'keep 3 days',before_rows:10,after_rows:8,before_total_bytes:100,after_total_bytes:80,audit_payload:{auditContract:'cost-governance-before-after-v1'}}));
 cache['verify-cost-governance-audit.js']=await evaluate('verify-cost-governance-audit.js',runtime,{'../lib/server-supabase-key':{serverSupabaseKey:()=> 'isolated',serverSupabaseUrl:()=> 'https://isolation.invalid'},fetch:async url=>{if(!url.startsWith('https://isolation.invalid/rest/v1/v_fuman_cost_governance_audit_status?'))throw Error('unexpected fixture endpoint');return {ok:true,text:async()=>JSON.stringify(auditRows)};}});
 const tasks=[['Fuman API-Only Retired Artifact Cleanup 1535','17:10',false],['Fuman Supabase Vercel History Cleanup 1545','17:40',true],['Fuman Vercel Cost Health Monitor 2115','21:15',false],['Fuman Global Cost Janitor Scorecard 1555','18:10',true]].map(([name,time,disabled])=>({TaskName:'\\'+name,Status:disabled?'Disabled':'Ready',LastResult:0,LogonType:'S4U',TriggerTimes:[time]}));
 const calls=[];
 const spawnSync=(file,args)=>{calls.push({file,args});if(file==='powershell.exe')return {status:0,stdout:JSON.stringify(tasks),stderr:''};const name=args.map(a=>path.basename(a)).find(a=>Object.hasOwn(cache,a));if(!name)throw Error('unbound child (including any notification):'+JSON.stringify(args));return cache[name];};
 const result=await evaluate(stage==='cost'?'monitor-vercel-cost-health.js':'verify-global-cost-janitor-scorecard.js',runtime,{'child_process':{spawnSync}});
 fs.mkdirSync(path.join(runtime,'fixture-provider-evidence'),{recursive:true});fs.writeFileSync(path.join(runtime,'fixture-provider-evidence',stage+'.json'),JSON.stringify({scope:'isolated provider responses and actual verifier evaluations; not production acceptance',cache,calls,result},null,2));
 if(result.status!==0)throw Error(result.stderr+'\n'+result.stdout);
 return result;
}
module.exports={execute};
