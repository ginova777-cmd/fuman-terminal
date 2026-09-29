'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'module-summary-'));
const large='x'.repeat(2*1024*1024),inputs=[];
for(let i=1;i<=2;i++){
 const file=path.join(dir,'round'+i+'.json');
 fs.writeFileSync(file,JSON.stringify({module_id:'A03',trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w'+i,run_id:'r'+i,generation_id:'g'+i,snapshot_generation:'s'+i,mother_pool_run_id:'m'+i,observed_at:`2026-09-29T00:0${i}:00Z`,isolated_evidence:large}));inputs.push(file);
}
const out=path.join(dir,'result.json');
const p=spawnSync(process.execPath,[path.join(__dirname,'verify-daytrade-module-receipt.js'),'--summary','--module=A03','--round1='+inputs[0],'--round2='+inputs[1],'--out='+out],{encoding:'utf8',windowsHide:true,timeout:30000});
assert.equal(p.error,undefined);assert.equal(p.status,1,p.stderr);assert(Buffer.byteLength(p.stdout)<4096);
const summary=JSON.parse(p.stdout),receipt=JSON.parse(fs.readFileSync(out));
assert.equal(summary.complete,false);assert.equal(summary.status,'blocked');assert.equal(summary.out,out);assert.deepEqual(summary.failed_checks,receipt.failed_checks);
assert.equal(receipt.rounds_verified[0].isolated_evidence,large);assert.equal(receipt.rounds_verified[1].isolated_evidence,large);assert(fs.statSync(out).size>4*1024*1024);
console.log('PASS >4MB immutable evidence retained; bounded child stdout preserves actual rejection without ENOBUFS. Isolated, no DB.');
