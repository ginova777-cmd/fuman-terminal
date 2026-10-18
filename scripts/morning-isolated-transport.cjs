'use strict';
// Test preload only. Production entry points never import this module.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),Module=require('module'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),runtime=path.resolve(process.env.FUMAN_RUNTIME_DIR||'');
assert(runtime.startsWith(path.join(root,'outputs','morning-contract-20261018')+path.sep),'ISOLATED_RUNTIME_REQUIRED');
const out=path.dirname(runtime),origin=JSON.parse(fs.readFileSync(path.join(out,'route-origin.json'),'utf8')).base_url;
assert.equal(new URL(origin).hostname,'127.0.0.1');
for(const key of Object.keys(process.env))if(/SUPABASE|TOKEN|PASSWORD|SECRET/.test(key))delete process.env[key];
global.fetch=async()=>{throw Error('ISOLATED_EXTERNAL_FETCH_FORBIDDEN');};
const file=require.resolve('../lib/supabase-snapshots');require.cache[file]={id:file,filename:file,loaded:true,exports:{readSnapshot:async key=>JSON.parse(fs.readFileSync(path.join(runtime,'isolated-db',key+'.json'),'utf8')),upsertSnapshot:async(key,payload)=>{fs.writeFileSync(path.join(runtime,'isolated-db',key+'.json'),JSON.stringify({payload}));return {ok:true,isolated_transport:true};}}};
const calendar=require.resolve('./twse-trading-day');require.cache[calendar]={id:calendar,filename:calendar,loaded:true,exports:{isTwseTradingDay:async()=>({isTradingDay:true,scope:'isolated_historical_calendar'})}};
const cp=require('child_process'),spawn=cp.spawnSync;
cp.spawnSync=function(command,args,options){
  if(args?.[0]?.endsWith('apply-opening-report-0830-priority-bias-bridge.js')){
    assert.equal(options.timeout,30000);if(process.env.FUMAN_ISOLATED_MOTHER==='ready')return {status:0,stdout:'{"scope":"isolated_bridge_fixture"}',stderr:''};return {status:null,error:{code:'ETIMEDOUT'},signal:'SIGTERM',stdout:'',stderr:'isolated Mother Pool timeout'};
  }
  if(args?.[0]?.endsWith('verify-opening-report-0830-mother-pool-handoff-ack.js')&&!args.includes('--fixture')){
    if(process.env.FUMAN_ISOLATED_MOTHER==='ready')return {status:0,stdout:JSON.stringify(require('./morning-mother-receipt-fixture.cjs').handoff(runtime)),stderr:''};
    return {status:1,stdout:JSON.stringify({ok:false,complete:false,first_blocker:'isolated_mother_unavailable'}),stderr:''};
  }
  return spawn.call(cp,command,args,options);
};
const load=Module._extensions['.js'];
Module._extensions['.js']=function(module,filename){
  if(['verify-opening-report-morning-contract.js','verify-opening-report-two-stage.js'].includes(path.basename(filename))&&path.dirname(filename)===__dirname){
    const source=fs.readFileSync(filename,'utf8');
    // Bind only the expected deployment origin to the actual loopback test server.
    // Preserve all identity, source, row, hash, capture, DB and business checks.
    const compiled=source.replaceAll('https://fuman-terminal.vercel.app',origin);
    fs.appendFileSync(path.join(out,'isolated-origin-bindings.jsonl'),JSON.stringify({file:filename,source_sha256:crypto.createHash('sha256').update(source).digest('hex'),expected_origin:origin,scope:'test_transport_binding_not_formal_verification'})+'\n');
    return module._compile(compiled,filename);
  }
  return load(module,filename);
};
