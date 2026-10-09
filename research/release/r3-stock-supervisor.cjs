'use strict';
const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),{local}=require('./producer-handoff.cjs');
const cfg=JSON.parse(fs.readFileSync(local(process.argv[2])));if(cfg.scope!=='ISOLATED_REVIEW')throw Error('SCOPE');
local(cfg.entry);local(cfg.runtime);
const birth=()=>cp.execFileSync('pwsh',['-NoProfile','-Command',`(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().ToString('o')`],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();
const identity={pid:process.pid,creation_date:birth(),epoch:crypto.randomUUID(),entry_sha:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')};
let maintenance=false,ack=null,stopId=null;
const child=cp.fork(cfg.entry,[],{windowsHide:true,silent:true,execArgv:['--max-old-space-size=128','--require',local(cfg.guard)],env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,FUMAN_RUNTIME_DIR:cfg.runtime,FUMAN_CACHE_DIR:cfg.runtime+'/cache',FUMAN_STATE_DIR:cfg.runtime+'/state',FUGLE_COLLECTOR_ROLE:'daytrade',FUMAN_CHANGE_EVIDENCE_PHASE1:'0',FUMAN_SHADOW_TELEMETRY:'0'}});
let stderr='';child.stderr.on('data',b=>stderr=(stderr+b).slice(-4096));child.stdout.resume();
child.on('message',m=>{if(m.status==='READY')process.send({status:'READY',supervisor:identity,collector:m.identity,stop_challenge:m.stop_challenge});else if(m.status==='STOCK_SAVED'){ack=m;process.send(m);}else process.send(m);});
child.on('exit',(code,signal)=>{process.send?.({status:maintenance&&ack&&code===0?'SUPERVISOR_STOPPED':'BLOCKED',identity,collector_pid:child.pid,code,signal,request_id:stopId,error:ack?null:stderr},()=>process.exit(code===0&&ack?0:1));});
process.on('message',m=>{if(!['PREPARE_STOP','GRACEFUL_STOP'].includes(m?.command))return;try{for(const k of ['pid','creation_date','epoch','entry_sha'])if(m.supervisor?.[k]!==identity[k])throw Error('SUPERVISOR_IDENTITY');if(maintenance)throw Error('STOP_IN_PROGRESS');if(m.command==='GRACEFUL_STOP'){maintenance=true;stopId=m.request_id;}child.send(m);}catch(e){process.send({status:'BLOCKED',error:e.message});}});
// Deliberately no Kill, forced exit fallback, or automatic restart while fenced.
