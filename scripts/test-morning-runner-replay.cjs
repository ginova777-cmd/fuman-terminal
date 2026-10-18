'use strict';
// Historical evidence replay exercises real runner logic, never natural completion.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const stage=process.argv[2],out=path.resolve(process.argv[3]||'');
assert(['us_0820','asia_0850'].includes(stage));assert(out.includes('morning-contract-20261018'));
const date='2026-10-16',day='20261016',runtime=path.join(out,'runtime');
process.env.FUMAN_RUNTIME_DIR=runtime;process.env.FUMAN_RUNTIME_ROOT=runtime;process.env.FUMAN_STATE_DIR=path.join(runtime,'state');process.env.FUMAN_MORNING_STAGE=stage;
const sourceRoot='C:/fuman-runtime/data/opening-report-stages';
let copies=0;const manifest=[];
function cloneEvidence(value){
  if(Array.isArray(value))return value.map(cloneEvidence);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,cloneEvidence(v)]));
  if(typeof value==='string'&&value.replace(/\\/g,'/').startsWith(sourceRoot+'/')&&fs.existsSync(value)&&fs.statSync(value).isFile()) {
    const bytes=fs.readFileSync(value);assert(bytes.length<5000000);assert(++copies<150);
    const hash=crypto.createHash('sha256').update(bytes).digest('hex'),dest=path.join(runtime,'raw',hash+path.extname(value));
    fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);manifest.push({source:value,copy:dest,sha256:hash});return dest;
  }return value;
}
for(const id of ['us_0820','asia_0850'])for(const name of ['opening-report-0830-overseas-leaders','opening-report-0830-market-snapshot','opening-report-0830-preflight-receipt']){
  const file=path.join(sourceRoot,id,`${name}-${day}.json`),dest=path.join(runtime,'data/opening-report-stages',id,`${name}-${day}.json`);
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(cloneEvidence(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')))));
}
const dir=path.join(runtime,'data/opening-report-stages',stage),source=JSON.parse(fs.readFileSync(path.join(dir,`opening-report-0830-overseas-leaders-${day}.json`)));
// Only external transports are replaced: source parsing/ranking/A/B/runner remain real.
const snapshotFile=key=>path.join(runtime,'isolated-db',key+'.json');
const snap=require.resolve('../lib/supabase-snapshots');require.cache[snap]={id:snap,filename:snap,loaded:true,exports:{
  upsertSnapshot:async(key,payload)=>{const file=snapshotFile(key);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({payload}));return {ok:true,key,isolated_transport:true};},
  readSnapshot:async key=>JSON.parse(fs.readFileSync(snapshotFile(key),'utf8'))
}};
const calendar=require.resolve('./twse-trading-day');require.cache[calendar]={id:calendar,filename:calendar,loaded:true,exports:{isTwseTradingDay:async()=>({isTradingDay:true,scope:'isolated_historical_fixture'})}};
const cp=require('child_process'),originalSpawn=cp.spawnSync;
cp.spawnSync=(command,args)=>{
  if(args?.[0]?.endsWith('apply-opening-report-0830-priority-bias-bridge.js')||args?.[0]?.endsWith('verify-opening-report-0830-mother-pool-handoff-ack.js'))return {status:1,stdout:JSON.stringify({ok:false,complete:false,first_blocker:'isolated_mother_unavailable'}),stderr:''};
  throw Error('ISOLATION_UNEXPECTED_PROCESS:'+command);
};
global.fetch=async()=>{throw Error('ISOLATION_EXTERNAL_NETWORK_FORBIDDEN');};
process.argv=[process.execPath,'runner',`--date=${date}`,`--run-id=${source.run_id}`];
(async()=>{
  await require('./run-opening-report-0830-production').main();
  const final=JSON.parse(fs.readFileSync(path.join(dir,`opening-report-0830-final-receipt-${day}.json`),'utf8'));
  const persisted=JSON.parse(fs.readFileSync(snapshotFile('opening_report_0830_terminal_briefing_'+stage),'utf8')).payload;
  assert.equal(final.content_ready,true);assert.equal(final.complete,false);assert.equal(final.mother_pool_handoff_ack_ok,false);
  assert.equal(require('../lib/morning-content-report-state.cjs').reportStateAccepted(final,true),true);
  assert.equal(require('../lib/morning-content-report-state.cjs').reportStateAccepted(final,false),false);
  assert.equal(persisted.run_id,source.run_id);assert.deepEqual(persisted.display_top3,final.display_top3);
  assert.equal(final.line_delivered,false);assert.equal(final.notification_accepted,true);
  const result={scope:'isolated_historical_runner_replay',stage,run_id:source.run_id,complete:true,natural:false,formal_db_access:false,mother_pool:'isolated_failure_fixture',content_ready:final.content_ready,formal_delivery_complete:final.complete,display_top3:final.display_top3,manifest};
  fs.writeFileSync(path.join(out,stage+'-runner-replay.json'),JSON.stringify(result,null,2));process.exitCode=0;
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{cp.spawnSync=originalSpawn;});
