'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const journal=require('../lib/daytrade-module-attempt-journal');
const {resumeInput}=require('../lib/mother-pool-resume-module-input');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'module-resume-restart-'));
 const input=require('../lib/mother-pool-identity-source').collect(require('./test-mother-identity-source').fixture());
 let expected,posts=0,remote={rounds:[],rows:[]};
 const adapter=()=>({validatePlan:async d=>{expected=d;},hasAttempt:async d=>journal.inspect(directory,d),saveAttempt:async d=>journal.begin(directory,d),saveEvidence:async()=>{},readCommitted:async()=>remote,persist:async()=>{posts++;throw Error('simulated process interruption');}});
 await assert.rejects(resumeInput(input,adapter()),/simulated process interruption/);
 assert.equal(posts,1);
 // A fresh adapter has no in-memory attempt state. The durable marker prevents
 // another POST even when the first write is not visible in the readback.
 await assert.rejects(resumeInput(input,adapter()),/PREVIOUS_ATTEMPT_UNCONFIRMED/);
 assert.equal(posts,1);
 remote={rounds:[{module_id:expected.module_id,trade_date:expected.trade_date,writer_run_id:expected.writer_run_id,document:expected,committed_at:expected.plan.created_at}],rows:expected.plan.rows.map(evidence=>({module_id:expected.module_id,trade_date:expected.trade_date,writer_run_id:expected.writer_run_id,symbol:evidence.symbol,evidence}))};
 const recovered=await resumeInput(input,adapter());assert.equal(recovered.ack.committed,true);assert.equal(posts,1);
 console.log('PASS interrupted write -> fresh adapter blocks duplicate POST -> exact same-round readback permits ACK');
})().catch(error=>{console.error(error);process.exitCode=1;});
