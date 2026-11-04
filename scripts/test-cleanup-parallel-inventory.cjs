'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Worker}=require('node:worker_threads');const {filesParallel}=require('./cleanup-parallel-inventory.cjs');const P=require('./cleanup-item-observation');
const root=fs.mkdtempSync(path.resolve(__dirname,'../../parallel-inventory-'));
for(let i=0;i<257;i++)fs.writeFileSync(path.join(root,'file-'+i),Buffer.alloc(i===0?8000000:1000+i,i%256));
test('parallel full content hashes and members equal serial; overlapping roots deduplicate',async()=>{const expected=P.files([root]);assert.deepEqual(await filesParallel([root,path.join(root,'file-0')]),expected);});
test('parallel inventory rejects a linked tree',async()=>{const link=root+'-link';fs.symlinkSync(root,link,'junction');await assert.rejects(filesParallel([link]),/inventory_link/);});
test('missing optional root is empty, not worker success for missing required files',async()=>{assert.deepEqual(await filesParallel([root+'-absent']),[]);const v=await new Promise((resolve,reject)=>{const w=new Worker(require.resolve('./cleanup-parallel-inventory.cjs'),{workerData:{files:[root+'-absent']}});w.on('message',resolve);w.on('error',reject);});assert.equal(v.error,'item_inventory_worker_missing');});
test('protected-byte change still fails reconciliation after parallel read',async()=>{const before=await filesParallel([root]);fs.writeFileSync(path.join(root,'file-4'),'changed');const after=await filesParallel([root]);assert.throws(()=>P.reconcile({contract:'cleanup-item-observation-v1',id:'C07',runId:'isolated',inventoryComplete:true,readbackComplete:true,before,after,candidates:[]}),/protected_changed/);});
