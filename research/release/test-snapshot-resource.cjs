'use strict';
const fs=require('fs'),assert=require('assert/strict'),{local}=require('./producer-handoff.cjs'),{digest}=require('./snapshot-digest.cjs');
const manifest=local(process.argv[2]),output=local(process.argv[3]);
const saved=JSON.parse(fs.readFileSync(manifest));
const rows=saved.records.map(item=>{local(item.target);const result=digest(item.target);assert.equal(result.sha256,item.sha256);assert.equal(result.bytes,item.bytes);return {kind:item.kind,path:item.target,...result};});
fs.writeFileSync(output,JSON.stringify({status:'PASS',scope:'FROZEN_SNAPSHOT_HASH_ONLY_NOT_SAVE_WORKER_REPLAY',source_manifest:manifest,rows},null,2));
console.log(JSON.stringify({status:'PASS',output}));
