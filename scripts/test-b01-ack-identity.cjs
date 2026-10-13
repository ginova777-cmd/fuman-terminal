'use strict';
// Artificial audit receipts, not natural-market acceptance. Child CLI is offline guarded.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const repo=path.resolve(__dirname,'..'),out=path.resolve(process.env.B01_TEST_OUTPUT||''),guard=process.env.B01_TEST_GUARD;
if(!guard||!process.env.B01_TEST_OUTPUT)throw Error('ISOLATED_OUTPUT_AND_GUARD_REQUIRED');
const {identityFields,reconcile}=require('../lib/mother-pool-module-write-set');
const verify=require('../lib/verify-mother-pool-module-round').createVerifier('B01').validRound;
const shared=require('../lib/daytrade-shared-evidence.cjs');
const rounds=[1,2].map(i=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/b01-ack/ack-round'+i+'.json'))));
// The audit fixtures deliberately contain OTHER_WRITER ACKs. Restore only that field for the positive control.
for(const r of rounds)r.writer_write_set.ack.writer_run_id=r.writer_run_id;
const cases=[{name:'positive',mutate:()=>{},pass:true}];
for(const field of identityFields){
 cases.push({name:'wrong-ack-'+field,mutate:r=>{r[0].writer_write_set.ack[field]=field==='snapshot_sequence'?999:'OTHER';},pass:false,code:'ACK_IDENTITY:'+field});
 cases.push({name:'missing-ack-'+field,mutate:r=>{delete r[0].writer_write_set.ack[field];},pass:false,code:'ACK_IDENTITY:'+field});
}
cases.push(
 {name:'wrong-module',mutate:r=>r[0].writer_write_set.ack.module_id='B02',pass:false,code:'ACK_MODULE_IDENTITY'},
 {name:'wrong-ack-hash',mutate:r=>r[0].writer_write_set.ack.plan_hash='0'.repeat(64),pass:false},
 {name:'uncommitted',mutate:r=>r[0].writer_write_set.ack.committed=false,pass:false},
 {name:'cross-round-ack',mutate:r=>r[0].writer_write_set.ack=structuredClone(r[1].writer_write_set.ack),pass:false},
 {name:'cross-round-second-ack',mutate:r=>r[1].writer_write_set.ack=structuredClone(r[0].writer_write_set.ack),pass:false},
 {name:'duplicate-round',mutate:r=>r[1]=structuredClone(r[0]),pass:false,roundsValid:true},
 {name:'missing-ack-proof',mutate:r=>delete r[0].writer_write_set.ack,pass:false},
 {name:'missing-write-set-proof',mutate:r=>delete r[0].writer_write_set,pass:false},
 {name:'missing-db-proof',mutate:r=>delete r[0].db_readback,pass:false},
 {name:'missing-anon-proof',mutate:r=>delete r[0].anon_readback,pass:false},
 {name:'original-audit-wrong-writer-both-rounds',mutate:r=>r.forEach(x=>x.writer_write_set.ack.writer_run_id='OTHER_WRITER'),pass:false}
);
fs.mkdirSync(out,{recursive:true});const results=[];
function cli(root,r,name,expected){
 const dir=path.join(out,name);fs.mkdirSync(dir,{recursive:true});
 const files=r.map((x,i)=>{const p=path.join(dir,'round'+(i+1)+'.json');fs.writeFileSync(p,JSON.stringify(x));return p;});
 const receipt=path.join(dir,'verifier.json');
 const p=cp.spawnSync(process.execPath,['--require',guard,path.join(root,'scripts/verify-daytrade-module-receipt.js'),'--module=B01','--round1='+files[0],'--round2='+files[1],'--out='+receipt,'--summary'],{cwd:dir,env:{...process.env,NODE_OPTIONS:'',FUMAN_RUNTIME:dir,FUMAN_RUNTIME_DIR:dir,A04_TEST_WRITE_ROOT:dir},encoding:'utf8',timeout:10000});
 fs.writeFileSync(path.join(dir,'stdout.txt'),p.stdout||'');fs.writeFileSync(path.join(dir,'stderr.txt'),p.stderr||'');
 assert.equal(p.status,expected?0:1,name+': '+p.stderr);
 const decoded=shared.read(receipt,dir);fs.writeFileSync(path.join(dir,'decoded.json'),JSON.stringify(decoded,null,2));
 assert.equal(decoded.complete,expected,name);assert.equal(decoded.exit_code,expected?0:1);
 return{exit:p.status,complete:decoded.complete,failed_checks:decoded.failed_checks,receipt:path.relative(out,receipt)};
}
for(const test of cases){
 const r=structuredClone(rounds);test.mutate(r);
 assert.equal(r.every(verify),test.roundsValid??test.pass,test.name+' validRound');
 if(test.code){const row=r[0];assert(reconcile(row.writer_write_set,row.db_readback.pages[0].rows,row.anon_readback.pages[0].rows,row,'B01').failed_checks.includes(test.code));}
 results.push({name:test.name,expected_complete:test.pass,...cli(repo,r,test.name,test.pass)});
}
if(process.env.B01_BASELINE_REPO){
 const root=path.resolve(process.env.B01_BASELINE_REPO),r=structuredClone(rounds);r.forEach(x=>x.writer_write_set.ack.writer_run_id='OTHER_WRITER');
 assert(require(path.join(root,'lib/verify-mother-pool-module-round')).createVerifier('B01').validRound(r[0]));
 results.push({name:'BASELINE_DEFECT_REPRODUCED',...cli(root,r,'baseline-wrong-writer',true),meaning:'Accepted invalid ACK before patch; not a healthy PASS'});
 // The original seven-field contract is already enforced by the persistence boundary.
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'offline artificial receipts; no DB calls, not natural acceptance',results},null,2));
console.log(JSON.stringify({ok:true,candidate_cases:cases.length,baseline_reproduced:Boolean(process.env.B01_BASELINE_REPO)}));
