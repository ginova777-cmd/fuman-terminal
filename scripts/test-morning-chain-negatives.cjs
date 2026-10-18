'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]),runtime=path.join(out,'runtime');
assert(out.startsWith(path.join(root,'outputs/morning-contract-20261018')+path.sep));
const dir=path.join(runtime,'data/opening-report-stages/us_0820'),day='20261016';
const cases=[
 ['wrong_render_run',`rendered/${day}/opening-report-rendered.json`,x=>x.run_id='wrong-run'],
 ['missing_render_surface',`rendered/${day}/opening-report-rendered.json`,x=>x.results.pop()],
 ['wrong_persistence_run',`scan-receipts/opening-report-0830-mother-pool-persistence-ack-${day}.json`,x=>x.report_run_id='wrong-run'],
 ['one_writer_refresh',`scan-receipts/opening-report-0830-mother-pool-persistence-ack-${day}.json`,x=>{x.writer_refreshes_observed=1;x.writer_refresh_timestamps=x.writer_refresh_timestamps.slice(0,1);}],
 ['bad_content_hash',`opening-report-0830-final-receipt-${day}.json`,x=>x.delivery_content_hash='wrong-hash']
],results=[];
for(const [name,relative,mutate] of cases){
 const file=path.join(dir,relative),bytes=fs.readFileSync(file),value=JSON.parse(bytes);mutate(value);
 try{
  fs.writeFileSync(file,JSON.stringify(value));
  const result=cp.spawnSync(process.execPath,['--require',path.join(__dirname,'morning-isolated-transport.cjs'),path.join(__dirname,'verify-opening-report-morning-contract.js'),'--require-current','--trade-date=2026-10-16','--output='+path.join(out,'negative-'+name+'.json')],{cwd:root,env:{...process.env,FUMAN_RUNTIME_DIR:runtime,FUMAN_MORNING_STAGE:'us_0820'},encoding:'utf8',timeout:30000});
  assert.equal(result.status,1,name);const receipt=JSON.parse(result.stdout);assert.equal(receipt.complete,false);assert(receipt.failed_checks.length>0);
  results.push({name,passed:true,failed_checks:receipt.failed_checks,original_sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 }finally{fs.writeFileSync(file,bytes);assert(fs.readFileSync(file).equals(bytes));}
}
fs.writeFileSync(path.join(out,'chain-negatives.json'),JSON.stringify({scope:'isolated_negative_mutations_only',complete:true,results,original_inputs_restored:true},null,2));console.log(JSON.stringify({complete:true,cases:results.length}));
