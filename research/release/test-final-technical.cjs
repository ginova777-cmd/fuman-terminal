'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const {OwnerControl,CataloguePublisher,atomic,load}=require('./technical-control.cjs');
const {DualFeedConsumer}=require('./dual-feed-consumer.cjs');
const {LiveTail}=require('./live-tail.cjs');
const {sha}=require('./producer-handoff.cjs');
const {fixture,tail,write}=require('./test-live-tail.cjs');
const {seed}=require('./test-recovery.cjs');
if(process.argv[2]==='crash-child'){const file=process.argv[3],stage=process.argv[4],rename=fs.renameSync;fs.renameSync=(a,b)=>{if(stage==='before')process.exit(79);rename(a,b);process.exit(79);};atomic(file,{value:2});process.exit(2);}
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'mp-final-tech-'));
const authorization=write(path.join(scratch,'authorization.json'),{contract:'owner-control-authorization-v1',scope:'ISOLATED_REVIEW',owner:'isolated-owner',host:'test-host',epoch:'fixture-epoch',release_sha:'a'.repeat(40)});
const owner={authorization,release_sha:'a'.repeat(40),owner:'isolated-owner',host:'test-host',nonce:'nonce-1',epoch:'fixture-epoch',pid:process.pid,started_at:new Date().toISOString()};
function ctl(dir){const c=new OwnerControl(dir,owner,()=> 'UNKNOWN');c.acquire();return c;}
function quoteFixture(){
 const previous=JSON.parse(fs.readFileSync('C:/Users/ginov/Documents/Codex/2026-09-30/new-chat/outputs/phase234-live-tail-20261009/live-tail-tests.json'));
 const d=fs.readdirSync(previous.scratch).map(x=>path.join(previous.scratch,x)).find(x=>fs.existsSync(path.join(x,'qcat.json')));
 if(!d)throw Error('SAVED_QUOTE_FIXTURE_MISSING');
 const ref=n=>({path:path.join(d,n),sha256:sha(fs.readFileSync(path.join(d,n)))}),start=JSON.parse(fs.readFileSync(path.join(d,'qstart.json')));
 const handoff={contract:'producer-handoff-v1',scope:'ISOLATED_REVIEW',kind:'quote',epoch:start.epoch,trade_date:'2026-10-08',feed_root:start.feed.quote,deployment:ref('deployment.json'),start:ref('qstart.json'),recovery:ref('qrecovery.json'),boundary:ref('qboundary.json')};
 return {t:new LiveTail({directory:fs.mkdtempSync(path.join(scratch,'qcursor-')),handoff}),cat:path.join(d,'qcat.json')};
}
(async()=>{const tests=[],begin=Date.now();
 for(const stage of ['before','after']){const file=path.join(scratch,'crash-'+stage+'.json');atomic(file,{value:1});const c=require('child_process').spawnSync(process.execPath,[__filename,'crash-child',file,stage]);assert.equal(c.status,79);assert.equal(load(file).value,stage==='before'?1:2);tests.push('OS process exit '+stage+' atomic rename preserves valid published root');}
 const o=ctl(path.join(scratch,'owner'));assert.throws(()=>new OwnerControl(o.dir,owner,()=> 'UNKNOWN').acquire());assert.throws(()=>o.takeover(o.id,{...owner,nonce:'n2'}),/NOT_PROVEN/);assert(fs.existsSync(o.file));tests.push('unknown/live identity cannot reclaim lock');
 o.stop();assert(o.stopped());o.probe=()=> ({status:'CONFIRMED_DEAD_EXACT_IDENTITY',identity_hash:o.id,evidence_ref:'isolated-process-inspection-fixture'});const replacement=o.takeover(o.id,{...owner,nonce:'n2'});assert(!replacement.stopped());assert.throws(()=>o.check(),/CHANGED/);tests.push('exact dead owner takeover preserves retired evidence and fences old owner');
 const f=fixture(),t=tail(f),p=t.poll(f.catalogue),pub= new CataloguePublisher(path.join(scratch,'publisher'),ctl(path.join(scratch,'pub-owner')));
 const one={...f.cat,published_through:1,segments:[f.cat.segments[0]]};delete one.hash;one.hash=sha(one);
 pub.publish(one,p.page.proofs,{reader:t});assert.equal(pub.read().catalogue.published_through,1);
 for(const fault of ['BEFORE_RENAME','AFTER_RENAME']){assert.throws(()=>pub.publish(one,p.page.proofs,{fault,reader:t}),/CRASH/);assert.equal(pub.read().catalogue.published_through,1);}tests.push('catalogue atomic publish/restart before and after rename');
  const retentionFrame=path.join(scratch,'retention-frame.json'),retentionRoot=path.join(scratch,'retention-root.json');write(retentionFrame,{dual:{binding:{candle:t.identity.binding},cursors:{candle:p.page.next}}});const rp={sourceCursor:{intent_hash:sha(fs.readFileSync(retentionFrame))}};write(retentionRoot,{payload:rp,sha256:sha(JSON.stringify(rp))});const retention={root_file:retentionRoot,frame_file:retentionFrame,kind:'candle'};
 const rotate={...one,anchor:{sequence:1,commit_hash:p.page.next.commit_hash},segments:[]};delete rotate.hash;rotate.hash=sha(rotate);assert.throws(()=>pub.publish(rotate,[],{retainedThrough:0,reader:t}),/RETENTION/);pub.publish(rotate,[],{retainedThrough:1,reader:t,retention});assert(fs.existsSync(p.page.proofs[0].file));tests.push('rotation rejects unacked anchor and preserves all source files');
 const gap={...rotate,published_through:2};delete gap.hash;gap.hash=sha(gap);assert.throws(()=>pub.publish(gap,[],{retainedThrough:1,reader:t,retention}),/GAP/);tests.push('catalogue range gap rejected');
 const wrong=fixture(),wt=tail(wrong),wp=wt.poll(wrong.catalogue),wpb=new CataloguePublisher(path.join(scratch,'badpub'),ctl(path.join(scratch,'badowner')));await assert.rejects(Promise.resolve().then(()=>wpb.publish(wrong.cat,[],{reader:wt})),/PROOF_SET/);tests.push('missing complete segment proof set cannot publish');
 for(const phase of [2,3,4]){
  const c=fixture(),ct=tail(c),q=quoteFixture(),s=seed(),control=ctl(path.join(scratch,'dual-owner-'+phase));
  const env={MP_PHASE2_ENABLED:'1',...(phase>=3?{MP_PHASE3_ENABLED:'1'}:{}),...(phase===4?{MP_PHASE4_ENABLED:'1'}:{})},consumer=new DualFeedConsumer({directory:s.dir,env,control});
  const target=t=>{let cur=t.cursor();for(let i=0;i<2;i++){const view=Object.create(t);view.cursor=()=>cur;const page=view.poll(t===ct?c.catalogue:q.cat);cur=page.page.next;}return {sequence:cur.sequence,commit_hash:cur.commit_hash};};
  const seal={contract:'dual-feed-barrier-v1',owner:control.id,asOf:s.frame.asOf,trade_date:'2026-10-08',generation:1,gap:false,binding:{quote:q.t.identity.binding,candle:ct.identity.binding},targets:{quote:target(q.t),candle:target(ct)},catalogue_hashes:{quote:sha(fs.readFileSync(q.cat)),candle:sha(fs.readFileSync(c.catalogue))}};
  const b=path.join(s.dir,'barrier.json');atomic(b,seal);const args={quote:q.t,candle:ct,catalogues:{quote:q.cat,candle:c.catalogue},barrierFile:b,asOf:s.frame.asOf,gate:s.frame.gate};
  await assert.rejects(consumer.run({...args,fault:'AFTER_DUAL_COMMIT'}),/CRASH_AFTER_DUAL/);
  const result=await consumer.run(args);assert.equal(result.dual_ack,'REPLAY_DEDUP');
  const frame=s.c.store.get(s.c.store.root().sourceCursor.intent_hash);assert.equal(frame.dual.cursors.quote.sequence,2);assert.equal(frame.dual.cursors.candle.sequence,2);assert.equal(frame.events.filter(x=>x.type==='CANDLE').length,2);assert.equal(frame.events.filter(x=>x.type==='QUOTE').length,2);
  assert.equal(ct.cursor().sequence,0);assert.equal(q.t.cursor().sequence,0);
  atomic(b,{...seal,generation:2,targets:{...seal.targets,candle:{sequence:3,commit_hash:'x'}}});await assert.rejects(consumer.run(args),/CATALOGUE/);assert.equal(s.c.store.root().sequence,1);
  control.stop();assert.equal((await consumer.run(args)).status,'STOPPED');tests.push('Phase '+phase+' dual feed E2E / revision / atomic cursors / crash replay / faster feed blocked / STOP');
 }
 console.log(JSON.stringify({status:'PASS',tests,elapsed_ms:Date.now()-begin,peak_rss_kib:process.resourceUsage().maxRSS,scratch,formal:'FORMAL_BLOCKED',natural:'NATURAL_MARKET_PENDING'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
