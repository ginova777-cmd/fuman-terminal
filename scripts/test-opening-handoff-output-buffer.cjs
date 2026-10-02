'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'handoff-buffer-'));
const child=path.join(dir,'child.cjs');
const source=fs.readFileSync(path.join(__dirname,'run-opening-report-0830-production.js'),'utf8');
const start=source.indexOf('function runMotherPoolHandoffAck('),end=source.indexOf('\nfunction splitLineTargets(',start);
assert(start>=0&&end>start);
function run(childSource){
 fs.writeFileSync(child,childSource);
 const ctx={spawnSync,process:{execPath:process.execPath},HANDOFF_ACK_SCRIPT:child,RECEIPT_DIR:dir,readJson:()=>null,hasFlag:()=>false,path,__dirname};
 vm.runInNewContext(source.slice(start,end)+';result=runMotherPoolHandoffAck("2026-10-02","test-run","isolated",false)',ctx);
 return ctx.result;
}
let r=run('console.log(JSON.stringify({ok:true,complete:true,source_evidence:{fixed_writer_batch_verified:false,raw:"x".repeat(1200000)}}))');
assert.equal(r.exitCode,0);assert.equal(r.receipt.ok,true);assert.equal(r.receipt.source_evidence.raw.length,1200000);assert.equal(r.receipt.source_evidence.fixed_writer_batch_verified,false);
r=run('console.log(JSON.stringify({ok:true,raw:"x".repeat(5000000)}))');
assert.equal(r.receipt.complete,false);assert.equal(r.receipt.first_blocker,'mother_pool_handoff_ack_output_limit_exceeded');
r=run('console.log(JSON.stringify({ok:false,complete:false,first_blocker:"real_source_failure"}));process.exitCode=1');
assert.equal(r.exitCode,1);assert.equal(r.receipt.first_blocker,'real_source_failure');
r=run('console.log("broken JSON")');assert.equal(r.receipt,null);
console.log('PASS actual parent/child: >1 MiB intact, 4 MiB cap fails closed, child source failure and malformed JSON retained; fixed batch flag not promoted');
