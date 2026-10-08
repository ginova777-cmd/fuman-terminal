'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {ProductionAdapter}=require('./production-adapter.cjs'),{seed}=require('./test-recovery.cjs');
const port={scope:'ISOLATED',contract:'phase234-file-port-v1',version:'v1'};
(async()=>{const tests=[],absent=path.join(os.tmpdir(),'mp-off-'+Date.now());assert.equal((await new ProductionAdapter({directory:absent}).run({})).status,'OFF');assert(!fs.existsSync(absent));tests.push('default OFF no files');
 for(const phase of [2,3,4]){const x=seed(),env={MP_PHASE2_ENABLED:'1',...(phase>=3?{MP_PHASE3_ENABLED:'1'}:{}),...(phase===4?{MP_PHASE4_ENABLED:'1'}:{})},a=new ProductionAdapter({directory:x.dir,env,port});
  const r=await a.run(x.frame,{maxSteps:5000});assert.equal(r.status,phase===4?'OFFLINE_COMMITTED':'ISOLATED_PHASE_READBACK_VERIFIED');assert.equal(!!x.c.store.root(),phase===4);
  const restart=await new ProductionAdapter({directory:x.dir,env,port}).run(x.frame,{maxSteps:5000});assert.equal(restart.status,phase===4?'REPLAY_DEDUP':'ISOLATED_PHASE_READBACK_VERIFIED');
  const files=fs.readdirSync(x.dir);assert.equal((await a.rollback().adapter.run(x.frame)).status,'OFF');assert.deepEqual(fs.readdirSync(x.dir),files);tests.push('phase '+phase+' independent persisted readback/restart/rollback');
  await assert.rejects(new ProductionAdapter({directory:x.dir,env,port:{...port,version:'v2'}}).run(x.frame),/REBASE/);
 }
 const x=seed();assert.equal((await new ProductionAdapter({directory:x.dir,env:{MP_PHASE2_ENABLED:'1'},port,stop:()=>true}).run(x.frame)).status,'STOPPED');
 await assert.rejects(new ProductionAdapter({directory:x.dir,env:{MP_PHASE2_ENABLED:'1'},port:{...port,scope:'PRODUCTION'}}).run(x.frame),/PORT_NOT_VERIFIED/);
 assert.throws(()=>new ProductionAdapter({directory:x.dir,env:{MP_PHASE4_ENABLED:'1'},port}),/DEPENDENCY/);tests.push('STOP/production refusal/dependency/source port drift');
 console.log(JSON.stringify({status:'PASS',tests,formal_connected:false,peak_rss_kib:process.resourceUsage().maxRSS}));
})().catch(e=>{console.error(e);process.exitCode=1});
