'use strict';
const assert=require('node:assert/strict');const {batches}=require('../lib/daytrade-write-batches');
const rows=Array.from({length:137},(_,i)=>({symbol:String(i),payload:{name:'台灣股票',identity:'same-round',detail:'x'.repeat(i%3?16000:9000)}}));
const original=JSON.stringify(rows);const chunks=[...batches(rows,{maxRows:50,maxBytes:512*1024})];
assert.deepEqual(chunks.flatMap(x=>x.chunk),rows);assert.equal(JSON.stringify(rows),original);
let offset=0;for(const c of chunks){assert.equal(c.offset,offset);assert(c.chunk.length<=50);assert(Buffer.byteLength(c.body)<=512*1024);offset+=c.chunk.length;}
assert.equal([...batches([],{maxRows:50})].length,0);
assert.throws(()=>[...batches([{x:'x'.repeat(100)}],{maxRows:50,maxBytes:10})],/SINGLE_ROW/);
const two=[{x:'中'},{x:'文'}],size=Buffer.byteLength(JSON.stringify(two));assert.equal([...batches(two,{maxRows:50,maxBytes:size})].length,1);assert.equal([...batches(two,{maxRows:50,maxBytes:size-1})].length,2);
const fs=require('fs');const source=fs.readFileSync(require.resolve('./run-daytrade-source-writer'),'utf8');assert(source.includes("maxRows:tracePriority?Math.min(batchSize,50):batchSize,maxBytes:tracePriority?512*1024:(options.maxBatchBytes ?? Infinity)"));
console.log(JSON.stringify({ok:true,rows:rows.length,batches:chunks.length,max_bytes:Math.max(...chunks.map(c=>Buffer.byteLength(c.body))),tests:['exact ordered set','all fields retained','UTF8 byte boundary','row limit','oversize fails closed','writer wiring']}));
