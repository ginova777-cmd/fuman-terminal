'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=fs.mkdtempSync(path.resolve(__dirname,'../../reference-walk-'));process.env.FUMAN_RUNTIME_DIR=root;
fs.mkdirSync(path.join(root,'data','a','b','c'),{recursive:true});const file=path.join(root,'data','a','b','c','evidence.json');fs.writeFileSync(file,JSON.stringify({runId:'run-verified',artifact:'C:/protected/original.json'}));
const {referenceInventory}=require('./cleanup-extended-retention');
test('single traversal retains nested source hashes and references',async()=>{const r=await referenceInventory(false);assert.deepEqual(r.ids,['run-verified']);assert.equal(r.contains('C:/protected/original.json'),true);assert.equal(r.files.length,1);assert.equal(r.files[0].file,file);});
test('single traversal still refuses nested junction before reading outside',async()=>{const outside=fs.mkdtempSync(path.resolve(__dirname,'../../outside-reference-'));fs.symlinkSync(outside,path.join(root,'data','a','escape'),'junction');await assert.rejects(referenceInventory(false),/outside_root_or_link/);});
