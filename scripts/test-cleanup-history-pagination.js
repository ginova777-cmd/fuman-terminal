"use strict";
const assert=require('assert');const {allCursorPages}=require('./cleanup-history-pagination');
(async()=>{
 const seen=[];const r=await allCursorPages(async c=>{seen.push(c);return c?{deployments:[{uid:'older'}],pagination:{next:null}}:{deployments:[{uid:'newest'}],pagination:{next:100}};});
 assert.equal(r.rows.length,2);assert.equal(r.pageCount,2);assert.deepEqual(seen,[undefined,100]);
 await assert.rejects(()=>allCursorPages(async()=>({deployments:[]})),/pagination_missing/);
 await assert.rejects(()=>allCursorPages(async()=>({deployments:[{uid:'duplicate'}],pagination:{next:1}})),/duplicate/);
 await assert.rejects(()=>allCursorPages(async()=>({deployments:[{uid:'one'}],pagination:{next:1}}),1),/bound_reached/);
 console.log('PASS full deployment pagination; missing metadata, duplicate rows and truncation rejected');
})().catch(e=>{console.error(e);process.exitCode=1;});
