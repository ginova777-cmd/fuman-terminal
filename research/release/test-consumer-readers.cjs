'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {seed}=require('./test-recovery.cjs');
const {ProductionAdapter}=require('./production-adapter.cjs');
const {ConsumerReader,recoverConsumerLock}=require('./consumer-readers.cjs');
const {ConsumerEntry}=require('./consumer-entry.cjs');
const {digest}=require('../integration/coordinator.cjs');
const env={MP_PHASE2_ENABLED:'1',MP_PHASE3_ENABLED:'1',MP_PHASE4_ENABLED:'1'};
if(process.argv[2]==='ack-child'){
 const config=JSON.parse(fs.readFileSync(process.argv[3])),r=new ConsumerReader(config),proof=r.read().proof,rename=fs.renameSync;
 fs.renameSync=(a,b)=>{if(process.argv[4]==='before')process.exit(79);rename(a,b);process.exit(79);};r.ack(proof);process.exit(2);
}else (async()=>{
 const tests=[],s=seed(),cursorDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'mp-readers-'));
 const sourceBinding={quote:'a'.repeat(64),candle:'b'.repeat(64)};
 s.frame.dual={binding:sourceBinding,cursors:{quote:{sequence:1,commit_hash:'c'.repeat(64)},candle:{sequence:1,commit_hash:'d'.repeat(64)}}};
 const config={scope:'ISOLATED_REVIEW',directory:s.dir,cursorDirectory,epoch:s.frame.epoch,trade_date:s.frame.trade_date,sourceBinding,env};
 const adapter=new ProductionAdapter({directory:s.dir,env,port:{scope:'ISOLATED',contract:'phase234-file-port-v1',version:'dual-feed-v1'}});
 await adapter.runIncremental(s.frame);
 const roles=['writer','membership','strategy3','telegram'],readers=roles.map(role=>new ConsumerReader({...config,id:role,role}));
 const results=await Promise.all(readers.map(async r=>r.read()));assert(results.every(r=>r.status==='READY'));
 const root=digest(s.c.store.root());readers[0].ack(results[0].proof);assert.equal(readers[1].cursor(),null);assert.equal(readers[0].read().status,'REPLAY_DEDUP');
 tests.push('parallel readers / role projections / independent cursor / replay');
 assert.throws(()=>readers[1].ack(results[1].proof,{fault:'BEFORE_ACK'}),/CRASH/);assert.equal(readers[1].cursor(),null);
 for(let i=1;i<4;i++)readers[i].ack(results[i].proof);assert.equal(digest(s.c.store.root()),root);tests.push('root committed before ACK fault and recovery; no root writer');
 let frame={...s.frame,sequence:2,events:[]};await adapter.runIncremental(frame);
 for(const r of readers){const x=r.read();assert.equal(x.proof.cursors.quote.sequence,1);r.ack(x.proof);}tests.push('legal zero increment preserves both source cursors');
 const event=structuredClone(s.frame.events[0]);event.payload.close=105;event.payload_sha256=digest(event.payload);
 frame={...frame,sequence:3,events:[event]};await adapter.runIncremental(frame);for(const r of readers)r.ack(r.read().proof);tests.push('old-minute revision consumed through existing lifecycle');
 for(const patch of [{epoch:'wrong'},{trade_date:'2099-01-01'},{sourceBinding:{quote:'x',candle:'y'}}])assert.throws(()=>new ConsumerReader({...config,id:'other',role:'writer',...patch}).read(),/IDENTITY/);
 tests.push('wrong epoch / date / source binding rejected');
 for(const name of [s.c.store.root().sourceCursor.intent_hash,s.c.baseline().symbols['1000']]){
  const file=path.join(s.dir,'objects',name+'.json'),original=fs.readFileSync(file);fs.renameSync(file,file+'.saved');
  try{assert.throws(()=>readers[0].read());}finally{fs.renameSync(file+'.saved',file);}
  fs.appendFileSync(file,' ');try{assert.throws(()=>readers[0].read());}finally{fs.writeFileSync(file,original);}
 }tests.push('missing frame / snapshot and byte hash corruption rejected');
 assert.throws(()=>new ConsumerReader({...config,id:'bad',role:'telegram',env:{MP_PHASE4_ENABLED:'1'}}),/PHASE/);
 const off=new ConsumerReader({...config,id:'off',role:'writer',env:{}});assert.equal(off.read().status,'OFF');assert.equal(off.cursor(),null);
 assert.equal(new ConsumerReader({...config,id:'stop',role:'writer',stop:()=>true}).read().status,'STOPPED');
 const ackBefore=fs.readFileSync(readers[0].file);assert.equal(readers[0].rollback().route,'LEGACY_READER');assert.equal(readers[0].read().status,'OFF');assert.deepEqual(fs.readFileSync(readers[0].file),ackBefore);
 const legacy={read:()=>({status:'LEGACY_FIXTURE'})};assert.equal(readers[0].readerFor(legacy),legacy);assert.equal(readers[0].readerFor(legacy).read().status,'LEGACY_FIXTURE');assert.equal(readers[1].readerFor(legacy),readers[1]);
 tests.push('dependency gate / OFF / STOP / rollback leaves ACK and legacy source intact');
 assert.throws(()=>new ConsumerEntry({...config,scope:'FORMAL'}),/NOT_APPROVED/);
 assert.throws(()=>new ConsumerEntry({...config,readers:[]}),/CONSUMER_SET/);
 assert.throws(()=>new ConsumerReader({...config,id:'overlap',role:'writer',cursorDirectory:s.dir}),/OVERLAP/);
 tests.push('formal scope / incomplete consumers / overlapping state rejected');
 frame={...frame,sequence:4,events:[]};await adapter.runIncremental(frame);
 const childConfig=path.join(cursorDirectory,'child-config.json');fs.writeFileSync(childConfig,JSON.stringify({...config,id:'membership',role:'membership'}));
 for(const stage of ['before','after']){
  const child=require('child_process').spawnSync(process.execPath,[__filename,'ack-child',childConfig,stage],{encoding:'utf8',timeout:30000});assert.equal(child.status,79,child.stderr);
  assert.equal(readers[1].cursor().sequence,stage==='before'?3:4);
  recoverConsumerLock(cursorDirectory,'membership.json.lock',child.pid);
 }
 assert.equal(readers[1].read().status,'REPLAY_DEDUP');
 const live=path.join(cursorDirectory,'consumer-entry.lock');fs.writeFileSync(live,JSON.stringify({pid:process.pid}));assert.throws(()=>recoverConsumerLock(cursorDirectory,'consumer-entry.lock',process.pid),/OWNER_ALIVE/);fs.unlinkSync(live);
 tests.push('actual child process death before / after ACK rename, explicit dead lock recovery; live owner protected');
 console.log(JSON.stringify({status:'PASS',tests,scope:'isolated synthetic frames; no network, DB, Telegram delivery or production runtime',source:s.dir,cursors:cursorDirectory}));
})().catch(e=>{console.error(e);process.exitCode=1;});
