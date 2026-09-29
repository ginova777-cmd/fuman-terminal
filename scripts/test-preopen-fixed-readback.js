'use strict';
const assert=require('node:assert/strict'),{read}=require('../lib/daytrade-preopen-fixed-readback');
const identity={trade_date:'2026-09-29',canonical_run_id:'c',writer_run_id:'w',generation_id:'g'};
const rows=Array.from({length:501},(_,i)=>({...identity,symbol:String(i)}));
async function run(change){return read({identity,request:async query=>{const q=new URLSearchParams(query);for(const k of Object.keys(identity))assert.equal(q.get(k),'eq.'+identity[k]);assert.equal(q.get('limit'),'500');const start=Number(q.get('offset')),page={status:200,rows:rows.slice(start,start+500),contentRange:`${start}-${Math.min(start+499,500)}/501`};if(change)change(page,start);return page;}});}
(async()=>{assert.equal((await run()).rows.length,501);for(const change of [p=>p.status=503,p=>p.contentRange='0-499/*',p=>p.rows=[],p=>p.rows[0]={...p.rows[0],writer_run_id:'other'},(p,start)=>{if(start)p.rows[0]={...p.rows[0],symbol:'0'};}])await assert.rejects(run(change));console.log('PASS fixed identity 500-page readback; HTTP/range/empty/mixed/duplicate rejected');})().catch(e=>{console.error(e);process.exitCode=1;});
