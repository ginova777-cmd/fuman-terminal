'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {hash}=require('../lib/mother-pool-module-write-set'),journal=require('../lib/daytrade-module-attempt-journal');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'module-attempt-'));
const plan={rows:[{symbol:'2330'}]},document={contract:'mother_pool_module_write_set_v1',module_id:'A01',trade_date:'2026-09-29',writer_run_id:'round-one',plan,plan_hash:hash(plan)};
assert.equal(journal.inspect(directory,document),false);journal.begin(directory,document);
// Reopening from disk models process restart, not an in-memory attempt flag.
assert.equal(journal.inspect(directory,JSON.parse(JSON.stringify(document))),true);
assert.throws(()=>journal.begin(directory,document),/EEXIST/);
const changed=structuredClone(document);changed.plan.rows[0].symbol='2317';changed.plan_hash=hash(changed.plan);
assert.throws(()=>journal.inspect(directory,changed),/DOCUMENT_MISMATCH/);
fs.writeFileSync(journal.fileFor(directory,document),'{');
assert.throws(()=>journal.inspect(directory,document),SyntaxError);
assert.throws(()=>journal.begin(directory,document),/EEXIST/);
assert.equal(journal.inspect(directory,{...document,writer_run_id:'round-two'}),false);
console.log('PASS durable attempt survives restart; duplicate, altered and truncated attempts fail closed; distinct round remains independent');
