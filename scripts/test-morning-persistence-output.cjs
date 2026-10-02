'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'persistence-output-'));const child=path.join(dir,'child.cjs'),output=path.join(dir,'receipt.json');
const source=fs.readFileSync(path.join(__dirname,'verify-opening-report-0830-mother-pool-persistence-ack.js'),'utf8');
const start=source.indexOf('function runReadback('),end=source.indexOf('\nasync function main()',start);assert(start>=0&&end>start);
function run(body,spawn=spawnSync){fs.writeFileSync(child,body);const ctx={spawnSync:spawn,process:{execPath:process.execPath},HANDOFF_SCRIPT:child,ROOT:dir,readJson:p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}}};vm.runInNewContext(source.slice(start,end)+'; result=runReadback("2026-10-02","run","bridge",'+JSON.stringify(output)+')',ctx);return ctx.result;}
const save='require("fs").writeFileSync(process.argv.find(x=>x.startsWith("--output=")).slice(9),JSON.stringify({complete:true,raw:"x".repeat(1200000)}));';
let r=run(save+'process.stdout.write("x".repeat(5000000));');assert.equal(r.exitCode,0);assert.equal(r.receipt.raw.length,1200000);
r=run(save+'process.exitCode=1;');assert.equal(r.exitCode,1,'successful receipt cannot override failed child');
r=run(save,()=>({status:null,signal:'SIGTERM',error:{code:'ETIMEDOUT'}}));assert.equal(r.exitCode,1);assert.equal(r.stderr,'mother_pool_persistence_child_ETIMEDOUT');
r=run(save+'process.stderr.write("x".repeat(200000));');assert.equal(r.exitCode,1);assert.match(r.stderr,/ENOBUFS/);
console.log('PASS real large-output child; file readback preserved; child failure, timeout, stderr overflow fail closed');
