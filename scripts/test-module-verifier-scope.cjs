'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'module-scope-'));
const dir=path.join(root,'data','scan-receipts','modules');fs.mkdirSync(dir,{recursive:true});
// A large unrelated file must not be opened by the selected-module verifier.
fs.writeFileSync(path.join(dir,'b02-20261001-large.json'),' '.repeat(17*1024*1024));
fs.writeFileSync(path.join(dir,'a01-20260930-old.json'),' '.repeat(17*1024*1024));
const run=args=>spawnSync(process.execPath,[path.join(__dirname,'run-daytrade-module-verifiers.js'),...args],{encoding:'utf8',timeout:10000,env:{...process.env,FUMAN_RUNTIME:root,TRADE_DATE:'2026-10-01'}});
let p=run(['--modules=A01']);assert.equal(p.status,2,p.stderr);let data=JSON.parse(p.stdout);
assert.equal(data.complete,false);assert.equal(data.overall_acceptance,'NOT_EVALUATED');assert.equal(data.results.length,1);assert.equal(data.results[0].module_id,'A01');assert.deepEqual(data.read_errors,[]);
fs.writeFileSync(path.join(dir,'a01-20261001-large.json'),' '.repeat(17*1024*1024));
p=run(['--modules=A01']);data=JSON.parse(p.stdout);assert.equal(data.read_errors[0].reason,'RECEIPT_SIZE_LIMIT');assert.equal(data.selected_modules_passed,false);
assert.notEqual(run(['--modules=B15']).status,0);
console.log(JSON.stringify({ok:true,tests:['unrelated_and_old_files_excluded','one_module_only','size_limit_visible','subset_never_global_complete','retired_module_rejected'],fixture:root}));
