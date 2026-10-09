'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const {Coordinator,digest}=require('../integration/coordinator.cjs'),{reclaim}=require('../integration/recover-dead-owner.cjs');
const {fixture}=require('../phase3/fixture.cjs'),fx=require('../phase4/fixtures.cjs');
function seed(n=3){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mp-resume-')),c=new Coordinator(dir),snapshot=fixture(n),items={};
 for(const {symbol}of snapshot.activeSymbols)items[symbol]={symbol,trade_date:snapshot.tradeDate,verified:true,data:fx.data(symbol,{date:snapshot.tradeDate,start:'12:37',count:22})};
 c.initialize({snapshot,items,proof:{mode:'OFFLINE_FROZEN_INPUT',sha256:digest({snapshot,items})}});
 const asOf=snapshot.tradeDate+'T13:00:00+08:00',events=snapshot.activeSymbols.map(({symbol})=>{const payload={symbol,market:'TSE',tradeDate:snapshot.tradeDate,candleTime:snapshot.tradeDate+'T12:40:00+08:00',candleSeenAt:asOf,source:'fugle-ws-candles',sourceChannel:'candles',candleOrigin:'websocket_candle',restRepairRow:false,intradayOddLot:false,synthetic:false,volumeStrategyUsable:true,open:105,high:107,low:104,close:106,volume:999};return {type:'CANDLE',symbol,payload,payload_sha256:digest(payload)};});
 const frame={epoch:snapshot.epoch,trade_date:snapshot.tradeDate,status:'OFFLINE_FIXED_SEGMENT',sequence:1,asOf,events,gate:fx.gate(c.baseline().binding.sha256,{date:snapshot.tradeDate,asOf})};
 fs.writeFileSync(path.join(dir,'input.json'),JSON.stringify(frame));return {dir,c,frame};}
async function resume(dir,maxSteps=4){let r,rounds=0;do{r=await new Coordinator(dir).recover({recovery:{maxSteps}});assert(++rounds<1000);}while(r.status==='RECOVERY_PAUSED');return {r,rounds};}
if(process.argv[2]==='child'){
 const [dir,stage]=process.argv.slice(3);const c=new Coordinator(dir),frame=JSON.parse(fs.readFileSync(path.join(dir,'input.json')));
 c.run(frame,{recovery:{maxSteps:5000,fault:s=>{if(s===stage)process.exit(78);}}}).then(()=>process.exit(2)).catch(e=>{console.error(e);process.exitCode=1;});
}else if(require.main===module)(async()=>{
 const tests=[],base=seed();await base.c.run(base.frame);const expected=digest(base.c.store.root());
 const small=seed();let r=await small.c.run(small.frame,{recovery:{maxSteps:1}});assert.equal(r.status,'RECOVERY_PAUSED');assert.equal(small.c.store.root(),null);
 const completed=await resume(small.dir);assert.equal(digest(completed.r.root),expected);assert.equal((await new Coordinator(small.dir).run(small.frame)).status,'REPLAY_DEDUP');tests.push('segmented R0-R6 equals original full root, one publish and dedup');
 for(const stage of ['R0','R1:1000','R2','R2:discovery','R3:1000','R4:1000','R5:0','R6:ROOT_COMMITTED']){
  const x=seed(),child=spawnSync(process.execPath,['--max-old-space-size=128',__filename,'child',x.dir,stage],{timeout:20000,encoding:'utf8'});assert.equal(child.status,78,child.stderr);
  assert.equal(x.c.store.root()!==null,stage==='R6:ROOT_COMMITTED');
  for(const name of ['coordinator.lock','owner.lock'])if(fs.existsSync(path.join(x.dir,name))){const lock=JSON.parse(fs.readFileSync(path.join(x.dir,name)));reclaim(x.dir,name,typeof lock==='number'?lock:lock.pid);}
  await resume(x.dir);assert.equal(digest(x.c.store.root()),expected);assert(!fs.existsSync(x.c.pending));tests.push('actual process death/restart '+stage);
 }
 const tamper=seed();await tamper.c.run(tamper.frame,{recovery:{maxSteps:2}});const b=tamper.c.baseline(),file=path.join(tamper.dir,'objects',b.symbols['1000']+'.json');fs.appendFileSync(file,' ');await assert.rejects(resume(tamper.dir),/OBJECT_HASH/);assert.equal(tamper.c.store.root(),null);tests.push('source hash drift refuses resumed publication');
 const stop=seed();r=await stop.c.run(stop.frame,{recovery:{maxSteps:5000,stop:()=>true}});assert.equal(r.status,'RECOVERY_PAUSED');assert.equal(stop.c.store.root(),null);await resume(stop.dir);assert.equal(digest(stop.c.store.root()),expected);tests.push('STOP retains checkpoint and original root');
 console.log(JSON.stringify({status:'PASS',tests,root_sha256:expected,peak_rss_kib:process.resourceUsage().maxRSS,scope:'synthetic real Phase2-3-4; process death not OS power loss'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={seed,resume};
