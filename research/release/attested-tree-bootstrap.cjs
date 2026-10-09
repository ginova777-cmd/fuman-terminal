'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),M=require('module'),wt=require('worker_threads'),cp=require('child_process');
const {local}=require('./producer-handoff.cjs');
const h=b=>crypto.createHash('sha256').update(b).digest('hex');
const cfg=wt.isMainThread?JSON.parse(fs.readFileSync(local(process.argv[2]))):wt.workerData.attestation;
if(cfg?.scope!=='ISOLATED_REVIEW')throw Error('SCOPE');
const raw=fs.readFileSync(local(cfg.manifest)),man=JSON.parse(raw),root=local(man.root);
if(h(raw)!==cfg.manifest_hash||man.node_version!==process.version||h(fs.readFileSync(process.execPath))!==man.node_hash)throw Error('MANIFEST_NODE_DRIFT');
if(cfg.isolatedRuntime){
 const runtime=local(cfg.isolatedRuntime);process.env.FUMAN_RUNTIME_DIR=runtime;process.env.FUMAN_CACHE_DIR=path.join(runtime,'cache');process.env.FUMAN_STATE_DIR=path.join(runtime,'state');process.env.FUGLE_COLLECTOR_ROLE='daytrade';process.env.FUMAN_CHANGE_EVIDENCE_PHASE1='0';process.env.FUMAN_SHADOW_TELEMETRY='0';
 const read=fs.readFileSync;fs.readFileSync=function(file,...args){if(typeof file!=='number'){const full=path.resolve(String(file));const allowed=[root,__dirname,runtime].some(r=>full===r||full.startsWith(r+path.sep))||full===process.execPath;if(!allowed)throw Error('ISOLATED_READ_OUTSIDE_ROOT');}return read.call(fs,file,...args);};
 globalThis.fetch=async()=>{throw Error('ISOLATED_NETWORK_BLOCKED');};globalThis.WebSocket=class{constructor(){throw Error('ISOLATED_NETWORK_BLOCKED');}};
}
if(cfg.applicationArgs)process.argv=[process.execPath,cfg.entrypoint,...cfg.applicationArgs];
let sequence=0,count=0;const send=e=>{const x={_mpAttest:true,challenge:cfg.challenge,context:cfg.context,parent_context:cfg.parent_context||null,pid:process.pid,parent_pid:process.ppid,thread_id:wt.threadId,manifest_hash:cfg.manifest_hash,sequence:++sequence,...e};if(wt.isMainThread)process.send(x);else wt.parentPort.postMessage(x);};
function code(file){local(file);const rel=path.relative(root,file).replaceAll('\\','/');if(rel.startsWith('..')||path.isAbsolute(rel)||!man.files[rel]||++count>2048)throw Error('MODULE_SCOPE_LIMIT');const b=fs.readFileSync(file);if(b.length>4*1048576||h(b)!==man.files[rel])throw Error('MODULE_HASH_LIMIT');return {b,rel};}
for(const ext of ['.js','.cjs'])M._extensions[ext]=(m,f)=>{const {b,rel}=code(f);m._compile(b.toString('utf8'),f);send({event:'LOADED',path:rel,sha256:h(b),bytes:b.length});};
M._extensions['.json']=(m,f)=>{const {b,rel}=code(f);m.exports=JSON.parse(b.toString('utf8'));send({event:'LOADED',path:rel,sha256:h(b),bytes:b.length});};
M._extensions['.node']=()=>{throw Error('NATIVE_BLOCKED');};
M.registerHooks({load(url,ctx,next){if(ctx.format==='module'||url.endsWith('.mjs')||url.startsWith('data:'))throw Error('ESM_BLOCKED');return next(url,ctx);}});
function forward(message){if(message?._mpAttest){if(wt.isMainThread)process.send(message);else wt.parentPort.postMessage(message);return true;}return false;}
function next(entry,kind){local(entry);code(entry);const context=crypto.randomUUID();send({event:'SPAWN',child_context:context,kind,entrypoint:entry});return {...cfg,entrypoint:entry,context,parent_context:cfg.context};}
class TrackedWorker extends wt.Worker{constructor(entry,opts={}){if(opts.eval||opts.execArgv?.length||opts.env)throw Error('WORKER_OPTIONS_BLOCKED');const c=next(entry,'worker');super(__filename,{...opts,workerData:{attestation:c,application:opts.workerData},resourceLimits:{...opts.resourceLimits,maxOldGenerationSizeMb:Math.min(opts.resourceLimits?.maxOldGenerationSizeMb||128,128)}});}emit(event,...args){if(event==='message'&&forward(args[0]))return true;return super.emit(event,...args);}}
const childPort={fork(entry,args=[],opts={}){if(opts.execArgv?.length||opts.env||opts.detached)throw Error('CHILD_OPTIONS_BLOCKED');const c={...next(entry,'child'),applicationArgs:args},file=local(path.join(cfg.config_dir,c.context+'.json'));fs.writeFileSync(file,JSON.stringify(c),{flag:'wx'});const child=cp.fork(__filename,[file],{...opts,execArgv:['--max-old-space-size=128','--disallow-code-generation-from-strings'],windowsHide:true});const emit=child.emit;child.emit=function(event,...args){if(event==='message'&&forward(args[0]))return true;return emit.call(this,event,...args);};child.on('message',()=>{});return child;}};
const original=M._load;M._load=function(request,...rest){const key=request.replace(/^node:/,'');if(key==='worker_threads')return {...wt,Worker:TrackedWorker,workerData:wt.isMainThread?null:wt.workerData.application};if(key==='child_process')return new Proxy(childPort,{get(t,k){if(k in t)return t[k];throw Error('CHILD_EXECUTION_BLOCKED');}});if(cfg.isolatedRuntime&&['net','tls','http','https','http2','dgram','undici'].includes(key))throw Error('ISOLATED_NETWORK_BLOCKED');if(key==='vm'||key==='module')throw Error('DYNAMIC_EXECUTION_BLOCKED');return original.call(this,request,...rest);};
try{send({event:'START',entrypoint:cfg.entrypoint,node_version:process.version,node_hash:man.node_hash});require(local(cfg.entrypoint));send({event:'ENTRY_READY'});}catch(e){send({event:'BLOCKED',reason:e.message});throw e;}
